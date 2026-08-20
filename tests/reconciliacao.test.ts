/**
 * A reconciliacao: onde o banco discorda de si mesmo.
 *
 * ============================================================
 * POR QUE A DETECCAO E TESTADA COM RETRATO FABRICADO
 * ============================================================
 * Produzir de verdade um "job concluido sem mensagem" exigiria matar um
 * worker no instante exato entre duas escritas. Um teste que tenta isso
 * ou e lento e intermitente, ou nao reproduz o caso.
 *
 * Como a deteccao e pura — entra retrato, sai lista —, cada tipo de
 * inconsistencia e montado a mao aqui. Sao exatamente os cenarios que
 * ja aconteceram em uso real.
 */
import { describe, it, expect } from 'vitest';
import {
  detectarInconsistencias,
  resumirInconsistencias,
  MINUTOS_ATE_SUSPEITA,
  type RetratoParaConferir,
  type OrdemParaConferir,
  type MensagemParaConferir,
  type PosicaoParaConferir,
} from '../packages/domain/src/index.js';

const AGORA = new Date('2026-08-20T12:00:00.000Z');
const HA_MUITO = new Date(AGORA.getTime() - (MINUTOS_ATE_SUSPEITA + 5) * 60_000);
const AGORINHA = new Date(AGORA.getTime() - 60_000);

function ordem(over: Partial<OrdemParaConferir> = {}): OrdemParaConferir {
  return {
    id: 'o1',
    leadId: 'lead1',
    campaignId: 'camp1',
    etapaOrdem: 1,
    status: 'ENVIADA',
    erro: null,
    dryRun: false,
    atualizadoEm: AGORINHA,
    messageId: 'msg1',
    ...over,
  };
}

function mensagem(over: Partial<MensagemParaConferir> = {}): MensagemParaConferir {
  return {
    id: 'msg1',
    leadId: 'lead1',
    campaignId: 'camp1',
    etapaOrdem: 1,
    direcao: 'ENVIADA',
    status: 'ENVIADA',
    whatsappMessageId: 'wa1',
    ...over,
  };
}

function posicao(over: Partial<PosicaoParaConferir> = {}): PosicaoParaConferir {
  return {
    leadId: 'lead1',
    campaignId: 'camp1',
    etapaAtualOrdem: 1,
    status: 'AGUARDANDO_RESPOSTA',
    aguardandoLiberacao: false,
    leadEmOptOut: false,
    temTarefaAberta: false,
    temAvisoPendente: false,
    ...over,
  };
}

function retrato(over: Partial<RetratoParaConferir> = {}): RetratoParaConferir {
  return { agora: AGORA, ordens: [], mensagens: [], posicoes: [], ...over };
}

function tipos(r: RetratoParaConferir): string[] {
  return detectarInconsistencias(r).map((i) => i.tipo);
}

// =============================================================================

describe('um sistema saudavel nao gera achado nenhum', () => {
  it('etapa enviada, mensagem registrada, lead na etapa certa', () => {
    const r = retrato({
      ordens: [ordem()],
      mensagens: [mensagem()],
      posicoes: [posicao()],
    });
    expect(detectarInconsistencias(r)).toEqual([]);
  });

  it('retrato vazio tambem nao inventa problema', () => {
    expect(detectarInconsistencias(retrato())).toEqual([]);
  });
});

describe('presas em PROCESSANDO', () => {
  it('envio REAL preso ha muito tempo e CRITICA', () => {
    const r = retrato({
      ordens: [ordem({ status: 'PROCESSANDO', atualizadoEm: HA_MUITO, messageId: null })],
    });
    const a = detectarInconsistencias(r).find((i) => i.tipo === 'ORFA_EM_PROCESSAMENTO')!;
    expect(a.gravidade).toBe('CRITICA');
    // A sugestao NUNCA pode ser "reenvie": a mensagem pode ter saido.
    expect(a.sugestao).toMatch(/CONFIRA A CONVERSA/i);
    expect(a.sugestao).not.toMatch(/reenvi/i);
  });

  it('simulacao presa e so INFO — o despachante resolve sozinho', () => {
    const r = retrato({
      ordens: [
        ordem({ status: 'PROCESSANDO', atualizadoEm: HA_MUITO, dryRun: true, messageId: null }),
      ],
    });
    const a = detectarInconsistencias(r).find((i) => i.tipo === 'ORFA_EM_PROCESSAMENTO')!;
    expect(a.gravidade).toBe('INFO');
  });

  // Um envio lento nao pode ser confundido com um worker morto.
  it('reservada agorinha nao e problema', () => {
    const r = retrato({
      ordens: [ordem({ status: 'PROCESSANDO', atualizadoEm: AGORINHA, messageId: null })],
    });
    expect(tipos(r)).not.toContain('ORFA_EM_PROCESSAMENTO');
  });
});

describe('o caso que quebrou a cadencia de verdade', () => {
  // Transporte OK, pos-processamento falhou. Foi isto que deixou o lead
  // parado na etapa 1 com a mensagem 2 ja entregue no WhatsApp.
  it('ENVIADA com erro registrado aparece como pos-processamento falho', () => {
    const r = retrato({
      ordens: [
        ordem({
          status: 'ENVIADA',
          erro: 'Enviada, mas o pós-processamento falhou: unique constraint',
        }),
      ],
    });
    const a = detectarInconsistencias(r).find((i) => i.tipo === 'POS_PROCESSAMENTO_FALHOU')!;
    expect(a.gravidade).toBe('ATENCAO');
    expect(a.descricao).toMatch(/saiu, mas o pos-processamento falhou/i);
  });

  it('lead marcado numa etapa anterior a que ja foi enviada', () => {
    const r = retrato({
      ordens: [ordem({ id: 'o1', etapaOrdem: 1 }), ordem({ id: 'o2', etapaOrdem: 2, messageId: 'm2' })],
      posicoes: [posicao({ etapaAtualOrdem: 1 })],
    });
    const a = detectarInconsistencias(r).find((i) => i.tipo === 'ETAPA_ATUAL_INCORRETA')!;
    expect(a.descricao).toMatch(/etapa 1.*etapa 2 ja foi enviada/i);
    // Corrigir isto nao reenvia nada, entao a sugestao pode ser direta.
    expect(a.sugestao).toMatch(/seguro/i);
  });

  it('lead na etapa certa nao gera achado', () => {
    const r = retrato({
      ordens: [ordem({ etapaOrdem: 1 })],
      posicoes: [posicao({ etapaAtualOrdem: 1 })],
    });
    expect(tipos(r)).not.toContain('ETAPA_ATUAL_INCORRETA');
  });
});

describe('duplicacao', () => {
  it('duas ordens ativas para a mesma etapa e CRITICA', () => {
    const r = retrato({
      ordens: [ordem({ id: 'o1' }), ordem({ id: 'o2' })],
    });
    const a = detectarInconsistencias(r).find((i) => i.tipo === 'ETAPA_DUPLICADA')!;
    expect(a.gravidade).toBe('CRITICA');
    expect(a.ids).toEqual(['o1', 'o2']);
  });

  // Cancelada nao conta: reenfileirar depois de pausar cria uma linha
  // nova de propósito, e a antiga fica no historico.
  it('uma cancelada e uma ativa nao sao duplicata', () => {
    const r = retrato({
      ordens: [ordem({ id: 'o1', status: 'CANCELADA' }), ordem({ id: 'o2' })],
    });
    expect(tipos(r)).not.toContain('ETAPA_DUPLICADA');
  });

  it('duas mensagens com o mesmo id do WhatsApp e CRITICA', () => {
    const r = retrato({
      mensagens: [mensagem({ id: 'm1' }), mensagem({ id: 'm2' })],
    });
    const a = detectarInconsistencias(r).find((i) => i.tipo === 'MENSAGEM_DUPLICADA')!;
    expect(a.gravidade).toBe('CRITICA');
  });

  it('mensagens sem id do WhatsApp nao colidem entre si', () => {
    const r = retrato({
      mensagens: [
        mensagem({ id: 'm1', whatsappMessageId: null }),
        mensagem({ id: 'm2', whatsappMessageId: null }),
      ],
    });
    expect(tipos(r)).not.toContain('MENSAGEM_DUPLICADA');
  });
});

describe('opt-out', () => {
  // O pior caso possivel: alguem pediu para parar e uma mensagem sai
  // depois. Sempre CRITICA, sem excecao.
  it('lead em opt-out com mensagem na fila e sempre CRITICA', () => {
    const r = retrato({
      ordens: [ordem({ status: 'AGENDADA', messageId: null })],
      posicoes: [posicao({ leadEmOptOut: true })],
    });
    const a = detectarInconsistencias(r).find(
      (i) => i.tipo === 'ENVIO_PENDENTE_APOS_OPT_OUT'
    )!;
    expect(a.gravidade).toBe('CRITICA');
    expect(a.ids).toHaveLength(1);
  });

  it('lead em opt-out sem nada pendente nao gera achado', () => {
    const r = retrato({
      ordens: [ordem({ status: 'ENVIADA' })],
      posicoes: [posicao({ leadEmOptOut: true })],
    });
    expect(tipos(r)).not.toContain('ENVIO_PENDENTE_APOS_OPT_OUT');
  });

  it('cancelada nao conta como pendente', () => {
    const r = retrato({
      ordens: [ordem({ status: 'CANCELADA', messageId: null })],
      posicoes: [posicao({ leadEmOptOut: true })],
    });
    expect(tipos(r)).not.toContain('ENVIO_PENDENTE_APOS_OPT_OUT');
  });
});

describe('lead esquecido', () => {
  // Congelado, sem tarefa e sem aviso: ele nao aparece em lugar nenhum
  // que voce olhe no dia a dia.
  it('parado esperando liberacao sem tarefa nem aviso', () => {
    const r = retrato({
      posicoes: [posicao({ aguardandoLiberacao: true })],
    });
    expect(tipos(r)).toContain('INTERVENCAO_SEM_AVISO');
  });

  it('com tarefa aberta, esta tudo certo', () => {
    const r = retrato({
      posicoes: [posicao({ aguardandoLiberacao: true, temTarefaAberta: true })],
    });
    expect(tipos(r)).not.toContain('INTERVENCAO_SEM_AVISO');
  });

  it('com aviso pendente, tambem', () => {
    const r = retrato({
      posicoes: [posicao({ aguardandoLiberacao: true, temAvisoPendente: true })],
    });
    expect(tipos(r)).not.toContain('INTERVENCAO_SEM_AVISO');
  });
});

describe('envio sem rastro na conversa', () => {
  it('ordem ENVIADA sem messageId', () => {
    const r = retrato({ ordens: [ordem({ messageId: null })] });
    const a = detectarInconsistencias(r).find((i) => i.tipo === 'ENVIO_SEM_MENSAGEM')!;
    // De novo: nunca sugerir reenvio quando ha duvida sobre o transporte.
    expect(a.sugestao).toMatch(/NAO reenvie/i);
  });
});

describe('resumirInconsistencias', () => {
  it('conta por gravidade', () => {
    const r = retrato({
      // Etapas DIFERENTES de proposito: com a mesma, elas virariam
      // tambem um ETAPA_DUPLICADA e o teste mediria outra coisa.
      ordens: [
        ordem({ id: 'o1', etapaOrdem: 1, status: 'PROCESSANDO', atualizadoEm: HA_MUITO, messageId: null }),
        ordem({ id: 'o2', etapaOrdem: 2, erro: 'pos-processamento' }),
      ],
    });
    const resumo = resumirInconsistencias(detectarInconsistencias(r));
    expect(resumo.CRITICA).toBe(1);
    expect(resumo.ATENCAO).toBe(1);
  });
});

describe('a deteccao e pura', () => {
  it('a mesma entrada produz exatamente o mesmo resultado', () => {
    const r = retrato({
      ordens: [ordem({ status: 'PROCESSANDO', atualizadoEm: HA_MUITO, messageId: null })],
      posicoes: [posicao({ leadEmOptOut: true })],
    });
    expect(detectarInconsistencias(r)).toEqual(detectarInconsistencias(r));
  });
});
