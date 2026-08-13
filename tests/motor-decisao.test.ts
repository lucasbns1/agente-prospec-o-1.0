/**
 * Testes de DECISAO e SEGURANCA.
 *
 * A classificacao diz "o que o lead falou". Estes testes cobrem "o que
 * o sistema faz" — e e aqui que moram as garantias que nao podem
 * falhar nunca:
 *
 *   1. opt-out e inviolavel;
 *   2. DESCONHECIDO nunca responde e nunca avanca;
 *   3. sem template, nao se inventa resposta;
 *   4. na duvida, intervencao humana.
 */
import { describe, expect, it } from 'vitest';
import {
  decidirAcao,
  decidirMidia,
  escolherTemplate,
  type EstadoLead,
  type RegraCategoria,
  type TemplateDisponivel,
  type EfeitoDecisao,
} from '../packages/domain/src/rules/decisao.js';
import {
  classificarResposta,
  PRECEDENCIA_PADRAO,
  type TermoRegra,
} from '../packages/domain/src/rules/motor.js';
import { DICIONARIO_PADRAO } from '../packages/domain/src/rules/dicionario-padrao.js';

const TERMOS: TermoRegra[] = DICIONARIO_PADRAO.map((d, i) => ({
  id: `t${i}`, categoria: d.categoria, termo: d.termo, matchTipo: d.matchTipo,
  peso: d.peso, subtipo: d.subtipo, ativo: true, campaignStepId: null,
}));

const classificar = (texto: string) =>
  classificarResposta(texto, { termos: TERMOS, precedencia: PRECEDENCIA_PADRAO });

const LEAD: EstadoLead = {
  leadId: 'lead-1',
  nome: 'Maria Silva',
  optOut: false,
  temperatura: 'FRIO',
  temProximaEtapa: true,
};

const REGRAS: RegraCategoria[] = [
  { categoria: 'POSITIVO', acao: 'AVANCAR', novaTemperatura: 'MORNO' },
  { categoria: 'PRECO', acao: 'RESPONDER', novaTemperatura: 'QUENTE' },
  { categoria: 'DUVIDA', acao: 'RESPONDER' },
  { categoria: 'NEGATIVO', acao: 'PARAR', novaTemperatura: 'FRIO' },
  { categoria: 'FALAR_DEPOIS', acao: 'SNOOZE', snoozeHoras: 72 },
  { categoria: 'INTERESSE', acao: 'AGUARDAR' },
];

const TEMPLATES: TemplateDisponivel[] = [
  { templateId: 'template_preco_01', categoria: 'PRECO', subtipo: null, campaignStepId: null, ativo: true },
  { templateId: 'template_duvida_01', categoria: 'DUVIDA', subtipo: null, campaignStepId: null, ativo: true },
];

const decidir = (
  texto: string,
  lead: Partial<EstadoLead> = {},
  regras = REGRAS,
  templates = TEMPLATES
) =>
  decidirAcao(classificar(texto), { ...LEAD, ...lead }, { regras, templates });

const tipos = (efeitos: EfeitoDecisao[]) => efeitos.map((e) => e.tipo);

// =============================================================================
// OPT-OUT INVIOLAVEL
// =============================================================================
describe('opt-out e inviolavel', () => {
  it.each([
    'pare',
    'não quero receber mais mensagens',
    'remove meu número',
    'me tira da lista',
    'não me mande mais',
    'já falei que não',
    'vou denunciar',
  ])('"%s" para tudo e registra opt-out', (texto) => {
    const d = decidir(texto);

    expect(d.acao).toBe('OPT_OUT');
    expect(d.bloqueiaEnvio).toBe(true);
    expect(d.templateId).toBeNull();
    expect(tipos(d.efeitos)).toContain('REGISTRAR_OPT_OUT');
    expect(tipos(d.efeitos)).toContain('CANCELAR_JOBS_PENDENTES');
    expect(tipos(d.efeitos)).toContain('PARAR_SEQUENCIA');
    // Nenhum efeito de envio, em nenhuma hipotese.
    expect(tipos(d.efeitos)).not.toContain('ENVIAR_TEMPLATE');
    expect(tipos(d.efeitos)).not.toContain('AVANCAR_ETAPA');
  });

  it('nenhuma regra configurada consegue sobrepor o opt-out', () => {
    // Alguem configurou, por engano ou nao, opt-out para responder.
    const regrasPerigosas: RegraCategoria[] = [
      { categoria: 'OPT_OUT', acao: 'RESPONDER', templateId: 'template_qualquer' },
    ];
    const d = decidir('remove meu número', {}, regrasPerigosas);

    expect(d.acao).toBe('OPT_OUT');
    expect(d.templateId).toBeNull();
    expect(tipos(d.efeitos)).not.toContain('ENVIAR_TEMPLATE');
  });

  it('lead JA em opt-out nao recebe nada, aconteca o que acontecer', () => {
    for (const texto of ['sim', 'quanto custa', 'pode mandar', 'quero contratar']) {
      const d = decidir(texto, { optOut: true });
      expect(d.bloqueiaEnvio, texto).toBe(true);
      expect(d.templateId, texto).toBeNull();
      expect(tipos(d.efeitos), texto).not.toContain('ENVIAR_TEMPLATE');
      expect(tipos(d.efeitos), texto).not.toContain('AVANCAR_ETAPA');
    }
  });

  it('opt-out esfria o lead e muda o status', () => {
    const d = decidir('pare');
    const status = d.efeitos.find((e) => e.tipo === 'ALTERAR_STATUS');
    expect(status).toMatchObject({ para: 'OPT_OUT' });
    const temp = d.efeitos.find((e) => e.tipo === 'ALTERAR_TEMPERATURA');
    expect(temp).toMatchObject({ para: 'FRIO' });
  });
});

// =============================================================================
// DESCONHECIDO NUNCA RESPONDE
// =============================================================================
describe('DESCONHECIDO nunca responde e nunca avanca', () => {
  it.each(['xyz abc', 'kkkkk', '😂', 'asdfgh', 'ótimo, mais uma mensagem...'])(
    '"%s" vira intervencao',
    (texto) => {
      const d = decidir(texto);

      expect(d.acao).toBe('INTERVENCAO');
      expect(d.bloqueiaEnvio).toBe(true);
      expect(d.templateId).toBeNull();
      expect(tipos(d.efeitos)).not.toContain('ENVIAR_TEMPLATE');
      expect(tipos(d.efeitos)).not.toContain('AVANCAR_ETAPA');
      expect(tipos(d.efeitos)).toContain('CRIAR_INTERVENCAO');
      expect(tipos(d.efeitos)).toContain('CRIAR_TAREFA');
    }
  );

  it('coloca o lead em AGUARDANDO_INTERVENCAO', () => {
    const d = decidir('xyz abc');
    const status = d.efeitos.find((e) => e.tipo === 'ALTERAR_STATUS');
    expect(status).toMatchObject({ para: 'AGUARDANDO_INTERVENCAO' });
  });

  it('a intervencao carrega o texto que o lead mandou', () => {
    const d = decidir('quero um unicornio roxo');
    const iv = d.efeitos.find((e) => e.tipo === 'CRIAR_INTERVENCAO');
    expect(iv).toBeDefined();
    expect(JSON.stringify(iv)).toMatch(/unicornio/);
  });

  it('o motivo da intervencao e RESPOSTA_DESCONHECIDA', () => {
    const d = decidir('asdfgh');
    const iv = d.efeitos.find((e) => e.tipo === 'CRIAR_INTERVENCAO');
    expect(iv).toMatchObject({ motivo: 'RESPOSTA_DESCONHECIDA' });
  });
});

// =============================================================================
// FALLBACK DE TEMPLATE
// =============================================================================
describe('sem template, nao se inventa resposta (requisito 51)', () => {
  it('RESPONDER sem template vira intervencao com missing_template', () => {
    const d = decidir('quanto custa', {}, REGRAS, []); // nenhum template

    expect(d.acao).toBe('INTERVENCAO');
    expect(d.templateId).toBeNull();
    expect(d.bloqueiaEnvio).toBe(true);
    expect(d.resumo).toMatch(/missing_template/);

    const iv = d.efeitos.find((e) => e.tipo === 'CRIAR_INTERVENCAO');
    expect(iv).toMatchObject({ motivo: 'MISSING_TEMPLATE' });
  });

  it('template desativado conta como ausente', () => {
    const desativado: TemplateDisponivel[] = [
      { templateId: 'x', categoria: 'PRECO', subtipo: null, campaignStepId: null, ativo: false },
    ];
    const d = decidir('quanto custa', {}, REGRAS, desativado);
    expect(d.acao).toBe('INTERVENCAO');
  });

  it('com template, responde e devolve o templateId', () => {
    const d = decidir('quanto custa');
    expect(d.acao).toBe('RESPONDER');
    expect(d.templateId).toBe('template_preco_01');
    expect(tipos(d.efeitos)).toContain('ENVIAR_TEMPLATE');
  });

  it('o motor NUNCA devolve texto de mensagem — so o id (requisito 49)', () => {
    const d = decidir('quanto custa');
    const serializado = JSON.stringify(d);
    // Nada que pareca uma frase de venda pode sair daqui.
    expect(serializado).not.toMatch(/nosso preco e/i);
    expect(serializado).not.toMatch(/R\$/);
    expect(d.templateId).toMatch(/^template_/);
  });
});

describe('escolherTemplate — especificidade', () => {
  const templates: TemplateDisponivel[] = [
    { templateId: 'geral', categoria: 'PRECO', subtipo: null, campaignStepId: null, ativo: true },
    { templateId: 'desconto', categoria: 'PRECO', subtipo: 'desconto', campaignStepId: null, ativo: true },
    { templateId: 'etapa3', categoria: 'PRECO', subtipo: null, campaignStepId: 'e3', ativo: true },
  ];

  it('prefere o template da etapa', () => {
    expect(escolherTemplate('PRECO', null, 'e3', templates)).toBe('etapa3');
  });

  it('prefere o subtipo quando nao ha template de etapa', () => {
    expect(escolherTemplate('PRECO', 'desconto', null, templates)).toBe('desconto');
  });

  it('cai no geral', () => {
    expect(escolherTemplate('PRECO', 'outro_subtipo', null, templates)).toBe('geral');
  });

  it('devolve null quando a categoria nao tem template', () => {
    expect(escolherTemplate('DUVIDA', null, null, templates)).toBeNull();
  });
});

// =============================================================================
// CATEGORIA SEM REGRA
// =============================================================================
describe('categoria sem regra configurada', () => {
  it('vira intervencao em vez de acao improvisada', () => {
    const d = decidir('quanto custa', {}, []); // nenhuma regra
    expect(d.acao).toBe('INTERVENCAO');
    const iv = d.efeitos.find((e) => e.tipo === 'CRIAR_INTERVENCAO');
    expect(iv).toMatchObject({ motivo: 'SEM_REGRA_CONFIGURADA' });
  });

  it('regra desativada conta como ausente', () => {
    const d = decidir('quanto custa', {}, [
      { categoria: 'PRECO', acao: 'RESPONDER', ativo: false },
    ]);
    expect(d.acao).toBe('INTERVENCAO');
  });
});

// =============================================================================
// SNOOZE
// =============================================================================
describe('snooze', () => {
  it('FALAR_DEPOIS agenda a retomada', () => {
    const agora = new Date('2026-01-10T10:00:00.000Z');
    const d = decidirAcao(classificar('me chama amanhã'), LEAD, {
      regras: REGRAS, templates: TEMPLATES, agora,
    });

    expect(d.acao).toBe('SNOOZE');
    expect(d.bloqueiaEnvio).toBe(true);

    const snooze = d.efeitos.find((e) => e.tipo === 'AGENDAR_SNOOZE');
    expect(snooze).toBeDefined();
    expect((snooze as { retomarEm: Date }).retomarEm.toISOString())
      .toBe('2026-01-13T10:00:00.000Z'); // +72h
  });

  it('usa o padrao quando a regra nao define horas', () => {
    const agora = new Date('2026-01-10T10:00:00.000Z');
    const d = decidirAcao(classificar('me chama depois'), LEAD, {
      regras: [{ categoria: 'FALAR_DEPOIS', acao: 'SNOOZE' }],
      templates: TEMPLATES, agora, snoozeHorasPadrao: 24,
    });
    const snooze = d.efeitos.find((e) => e.tipo === 'AGENDAR_SNOOZE');
    expect(snooze).toMatchObject({ horas: 24 });
  });

  it('coloca o lead em AGENDADO', () => {
    const d = decidir('me chama amanhã');
    const status = d.efeitos.find((e) => e.tipo === 'ALTERAR_STATUS');
    expect(status).toMatchObject({ para: 'AGENDADO' });
  });

  it('snooze nao envia nada', () => {
    const d = decidir('me chama amanhã');
    expect(tipos(d.efeitos)).not.toContain('ENVIAR_TEMPLATE');
  });

  it('registra o evento de snooze no historico', () => {
    const d = decidir('me chama amanhã');
    const ev = d.efeitos.filter((e) => e.tipo === 'REGISTRAR_EVENTO');
    expect(JSON.stringify(ev)).toMatch(/SNOOZE_AGENDADO/);
  });
});

// =============================================================================
// SINAIS QUE EXIGEM HUMANO
// =============================================================================
describe('sinais que sempre exigem humano', () => {
  it('suspeita de golpe vira intervencao, mesmo com outra categoria', () => {
    const d = decidir('como conseguiram meu número? quanto custa?');
    expect(d.acao).toBe('INTERVENCAO');
    const iv = d.efeitos.find((e) => e.tipo === 'CRIAR_INTERVENCAO');
    expect(iv).toMatchObject({ motivo: 'SUSPEITA_GOLPE' });
  });

  it('pedido de humano vira intervencao', () => {
    const d = decidir('quero falar com alguém');
    expect(d.acao).toBe('INTERVENCAO');
    const iv = d.efeitos.find((e) => e.tipo === 'CRIAR_INTERVENCAO');
    expect(iv).toMatchObject({ motivo: 'PEDIDO_HUMANO' });
  });

  it('midia nao e interpretada (requisito 41)', () => {
    for (const m of ['imagem', 'audio', 'documento', 'sticker', 'video']) {
      const d = decidirMidia(LEAD, m);
      expect(d.acao, m).toBe('INTERVENCAO');
      expect(d.bloqueiaEnvio, m).toBe(true);
      expect(d.templateId, m).toBeNull();
    }
  });

  it('midia de lead em opt-out nem gera intervencao', () => {
    const d = decidirMidia({ ...LEAD, optOut: true }, 'audio');
    expect(d.efeitos).toEqual([]);
  });
});

// =============================================================================
// TEMPERATURA E STATUS
// =============================================================================
describe('temperatura e status', () => {
  it('sobe a temperatura conforme a regra', () => {
    const d = decidir('quanto custa');
    const temp = d.efeitos.find((e) => e.tipo === 'ALTERAR_TEMPERATURA');
    expect(temp).toMatchObject({ para: 'QUENTE' });
  });

  it('a temperatura tambem pode DESCER', () => {
    const d = decidir('não tenho interesse', { temperatura: 'QUENTE' });
    const temp = d.efeitos.find((e) => e.tipo === 'ALTERAR_TEMPERATURA');
    expect(temp).toMatchObject({ para: 'FRIO' });
  });

  it('nao emite mudanca quando a temperatura ja e a mesma', () => {
    const d = decidir('quanto custa', { temperatura: 'QUENTE' });
    expect(tipos(d.efeitos)).not.toContain('ALTERAR_TEMPERATURA');
  });

  it('toda mudanca de temperatura gera evento de historico', () => {
    const d = decidir('quanto custa');
    const eventos = d.efeitos.filter((e) => e.tipo === 'REGISTRAR_EVENTO');
    expect(JSON.stringify(eventos)).toMatch(/TEMPERATURA_ALTERADA/);
  });
});

// =============================================================================
// AVANCO DE ETAPA
// =============================================================================
describe('avanco de etapa', () => {
  it('POSITIVO avanca quando ha proxima etapa', () => {
    const d = decidir('pode mandar');
    expect(d.acao).toBe('AVANCAR');
    expect(tipos(d.efeitos)).toContain('AVANCAR_ETAPA');
  });

  it('na ultima etapa, AVANCAR vira PARAR em vez de estourar', () => {
    const d = decidir('pode mandar', { temProximaEtapa: false });
    expect(d.acao).toBe('PARAR');
    expect(tipos(d.efeitos)).toContain('PARAR_SEQUENCIA');
    expect(tipos(d.efeitos)).not.toContain('AVANCAR_ETAPA');
  });
});

// =============================================================================
// NEGATIVO
// =============================================================================
describe('NEGATIVO encerra a sequencia', () => {
  it('para e cancela os jobs pendentes', () => {
    const d = decidir('não tenho interesse');
    expect(d.acao).toBe('PARAR');
    expect(tipos(d.efeitos)).toContain('PARAR_SEQUENCIA');
    expect(tipos(d.efeitos)).toContain('CANCELAR_JOBS_PENDENTES');
    expect(tipos(d.efeitos)).not.toContain('ENVIAR_TEMPLATE');
  });

  it('NEGATIVO nao e opt-out — o lead pode ser reabordado depois', () => {
    const d = decidir('não tenho interesse');
    expect(tipos(d.efeitos)).not.toContain('REGISTRAR_OPT_OUT');
  });
});

// =============================================================================
// A REGRA DE OURO
// =============================================================================
describe('regra de ouro: na duvida, nao responder (requisito 52)', () => {
  const arriscadas = [
    'ok',
    'entendi',
    'hmm',
    'legal...',
    'ótimo, mais uma mensagem',
    '😂',
    'quem é você?',
    'como conseguiu meu contato?',
    'asdfgh',
    '',
    '   ',
    '???',
  ];

  it.each(arriscadas)('"%s" nunca dispara envio automatico', (texto) => {
    const d = decidirAcao(classificar(texto), LEAD, {
      regras: REGRAS, templates: TEMPLATES,
    });
    if (d.acao === 'RESPONDER') {
      // Se responder, tem que ser com template configurado — nunca texto livre.
      expect(d.templateId).toBeTruthy();
    } else {
      expect(d.bloqueiaEnvio).toBe(true);
    }
  });

  it('toda decisao que bloqueia envio tem templateId nulo', () => {
    for (const texto of [...arriscadas, 'pare', 'não quero', 'me chama amanhã']) {
      const d = decidirAcao(classificar(texto), LEAD, {
        regras: REGRAS, templates: TEMPLATES,
      });
      if (d.bloqueiaEnvio) expect(d.templateId, texto).toBeNull();
    }
  });
});

// =============================================================================
// AUDITORIA
// =============================================================================
describe('auditoria', () => {
  it('toda decisao registra um evento de classificacao', () => {
    const d = decidir('quanto custa');
    const eventos = d.efeitos.filter((e) => e.tipo === 'REGISTRAR_EVENTO');
    expect(JSON.stringify(eventos)).toMatch(/RESPOSTA_CLASSIFICADA/);
  });

  it('o evento guarda as categorias detectadas e a confianca', () => {
    const d = decidir('tenho interesse, quanto custa?');
    const ev = d.efeitos.find(
      (e) => e.tipo === 'REGISTRAR_EVENTO' &&
        (e as { eventoTipo: string }).eventoTipo === 'RESPOSTA_CLASSIFICADA'
    );
    const dados = (ev as { dados: Record<string, unknown> }).dados;
    expect(dados['categoria']).toBe('PRECO');
    expect(dados['detectadas']).toContain('POSITIVO');
    expect(typeof dados['confianca']).toBe('number');
  });

  it('o resumo e legivel para o operador', () => {
    expect(decidir('pare').resumo).toMatch(/opt-out|nao receber/i);
    expect(decidir('xyz').resumo).toMatch(/nao reconhecida/i);
  });
});

// =============================================================================
// DETERMINISMO DA DECISAO
// =============================================================================
describe('determinismo', () => {
  it('a mesma entrada produz a mesma decisao', () => {
    const agora = new Date('2026-01-10T10:00:00.000Z');
    for (const texto of ['pare', 'quanto custa', 'me chama amanhã', 'xyz']) {
      const a = decidirAcao(classificar(texto), LEAD, {
        regras: REGRAS, templates: TEMPLATES, agora,
      });
      const b = decidirAcao(classificar(texto), LEAD, {
        regras: REGRAS, templates: TEMPLATES, agora,
      });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});
