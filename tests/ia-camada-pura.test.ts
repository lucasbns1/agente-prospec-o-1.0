/**
 * A camada pura da orquestracao por IA.
 *
 * NENHUM destes testes chama o Gemini. Todos entregam uma decisao
 * fabricada a mao para a guarda e conferem o veredito. E de proposito:
 * as invariantes de seguranca precisam ser verificaveis sem rede, sem
 * chave e sem custo, para poderem rodar em todo commit.
 */
import { describe, it, expect } from 'vitest';
import {
  interpretarRespostaIA,
  mapearIntent,
  limitarConfiancaDaIA,
  TETO_CONFIANCA_SO_IA,
  montarPrompt,
  proximaEtapaEsperada,
  validarDecisao,
  type ContextoCadencia,
  type DecisaoIA,
} from '../packages/domain/src/index.js';

// -----------------------------------------------------------------------------
// Fabricas
// -----------------------------------------------------------------------------

function contexto(over: Partial<ContextoCadencia> = {}): ContextoCadencia {
  return {
    gatilho: 'MENSAGEM_RECEBIDA',
    campanha: { id: 'c1', nome: 'Prospeccao de sites', status: 'ATIVA', dentroDaJanela: true },
    sequencia: [
      { ordem: 1, nome: 'Abordagem', texto: 'Oi, e o {{empresa}}?', aguardarResposta: true, enviarAutomaticamente: true, delaySegundos: 0 },
      { ordem: 2, nome: 'Proposta', texto: 'Vi voces no Google...', aguardarResposta: true, enviarAutomaticamente: true, delaySegundos: 120 },
      { ordem: 3, nome: 'Previa', texto: 'Montei uma ideia...', aguardarResposta: false, enviarAutomaticamente: false, delaySegundos: 120 },
    ],
    lead: {
      id: 'l1', nome: null, empresa: 'Studio Teste', bairro: 'Centro', cidade: 'Campinas',
      optOut: false, status: 'EM_CAMPANHA', temperatura: 'MORNO',
    },
    posicao: {
      etapaAtualOrdem: 1, statusNaCampanha: 'AGUARDANDO_RESPOSTA',
      aguardandoLiberacao: false, proximoEnvioEm: null,
    },
    envios: [],
    respostas: [],
    conversa: [],
    regras: [],
    relogio: { agora: '2026-08-19T14:00:00.000Z', segundosDesdeUltimoEnvio: null },
    ...over,
  };
}

function decisao(over: Partial<DecisaoIA> = {}): DecisaoIA {
  return {
    intent: 'INTERESSE',
    acao: 'SEND_STEP',
    etapaOrdem: 1,
    confianca: 90,
    precisaHumano: false,
    optOut: false,
    motivo: 'teste',
    esperarSegundos: null,
    ...over,
  };
}

/** Um envio que ocupa a etapa. */
function envio(ordem: number, statusOutbound: string, over = {}) {
  return {
    ordem,
    statusOutbound,
    statusMensagem: statusOutbound === 'ENVIADA' ? 'ENVIADA' : null,
    enviadaEm: statusOutbound === 'ENVIADA' ? '2026-08-19T13:58:00.000Z' : null,
    erro: null,
    dryRun: false,
    ...over,
  };
}

// -----------------------------------------------------------------------------
// Contrato: o que o modelo devolve
// -----------------------------------------------------------------------------

describe('interpretarRespostaIA — o contrato com o modelo', () => {
  const valido = JSON.stringify({
    intent: 'INTERESSE', action: 'SEND_STEP', confidence: 92,
    needs_human: false, opt_out: false, reason: 'o lead autorizou',
    next_step: 2, wait_seconds: null,
  });

  it('aceita um JSON dentro do contrato', () => {
    const r = interpretarRespostaIA(valido);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.decisao.intent).toBe('INTERESSE');
    expect(r.decisao.acao).toBe('SEND_STEP');
    expect(r.decisao.etapaOrdem).toBe(2);
  });

  it('tolera a cerca de markdown que os modelos gostam de por', () => {
    const r = interpretarRespostaIA('```json\n' + valido + '\n```');
    expect(r.ok).toBe(true);
  });

  it('rejeita um intent que o modelo inventou', () => {
    const r = interpretarRespostaIA(valido.replace('"INTERESSE"', '"MUITO_INTERESSADO"'));
    expect(r.ok).toBe(false);
  });

  it('rejeita uma acao que o modelo inventou', () => {
    const r = interpretarRespostaIA(valido.replace('"SEND_STEP"', '"ENVIAR_AGORA_TUDO"'));
    expect(r.ok).toBe(false);
  });

  // O `.strict()` do Zod existe por isto: sem ele, um campo a mais passaria
  // calado — e um campo a mais pode ser o modelo tentando fazer algo que o
  // contrato nao previu.
  it('rejeita campo extra que o modelo acrescentou por conta propria', () => {
    const r = interpretarRespostaIA(
      JSON.stringify({ ...JSON.parse(valido), tambem_enviar: true })
    );
    expect(r.ok).toBe(false);
  });

  it('rejeita confianca fora de 0-100', () => {
    expect(interpretarRespostaIA(valido.replace('92', '150')).ok).toBe(false);
    expect(interpretarRespostaIA(valido.replace('92', '-5')).ok).toBe(false);
  });

  it('rejeita JSON truncado sem lancar excecao', () => {
    const r = interpretarRespostaIA('{"intent":"INTERESSE","act');
    expect(r.ok).toBe(false);
  });

  it('rejeita resposta vazia sem lancar excecao', () => {
    expect(interpretarRespostaIA('').ok).toBe(false);
    expect(interpretarRespostaIA('   ').ok).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Traducao 14 -> 8
// -----------------------------------------------------------------------------

describe('mapearIntent — os 14 intents viram as 8 categorias do banco', () => {
  it('agrupa os intents de avanco em POSITIVO', () => {
    for (const i of ['INTERESSE', 'ACEITE', 'NEGOCIACAO', 'AGENDAMENTO'] as const) {
      expect(mapearIntent(i)).toBe('POSITIVO');
    }
  });

  it('agrupa os intents de pergunta em DUVIDA', () => {
    for (const i of ['DUVIDA', 'INFORMACAO', 'SUPORTE'] as const) {
      expect(mapearIntent(i)).toBe('DUVIDA');
    }
  });

  // Esta e a escolha menos obvia do mapa, e a que mais muda comportamento:
  // "achei caro" e conversa, nao recusa. Em NEGATIVO, a regra PARAR
  // encerraria leads que estavam a uma resposta de fechar.
  it('OBJECAO vira DUVIDA, nunca NEGATIVO', () => {
    expect(mapearIntent('OBJECAO')).toBe('DUVIDA');
  });

  it('SPAM e INTERVENCAO caem em DESCONHECIDO, que forca intervencao', () => {
    expect(mapearIntent('SPAM')).toBe('DESCONHECIDO');
    expect(mapearIntent('INTERVENCAO')).toBe('DESCONHECIDO');
  });

  it('OPT_OUT e NEGATIVO passam direto', () => {
    expect(mapearIntent('OPT_OUT')).toBe('OPT_OUT');
    expect(mapearIntent('NEGATIVO')).toBe('NEGATIVO');
  });

  // O motor exige 50 para AGIR. Limitar a 49 faz "a IA sozinha nunca
  // dispara mensagem" valer por construcao, nao por configuracao.
  it('confianca so da IA nunca atinge o piso de agir do motor', () => {
    expect(limitarConfiancaDaIA(99)).toBe(TETO_CONFIANCA_SO_IA);
    expect(TETO_CONFIANCA_SO_IA).toBeLessThan(50);
    expect(limitarConfiancaDaIA(20)).toBe(20);
  });
});

// -----------------------------------------------------------------------------
// Aritmetica da proxima etapa — feita pelo codigo, nunca pelo modelo
// -----------------------------------------------------------------------------

describe('proximaEtapaEsperada', () => {
  it('sem nenhum envio, a proxima e a 1', () => {
    expect(proximaEtapaEsperada(contexto())).toBe(1);
  });

  it('com a 1 enviada, a proxima e a 2', () => {
    expect(proximaEtapaEsperada(contexto({ envios: [envio(1, 'ENVIADA')] }))).toBe(2);
  });

  it('uma etapa apenas AGENDADA ja ocupa: nao vira "proxima"', () => {
    expect(
      proximaEtapaEsperada(contexto({ envios: [envio(1, 'ENVIADA'), envio(2, 'AGENDADA')] }))
    ).toBe(3);
  });

  it('uma etapa que FALHOU volta a ser a proxima', () => {
    expect(
      proximaEtapaEsperada(contexto({ envios: [envio(1, 'ENVIADA'), envio(2, 'FALHOU')] }))
    ).toBe(2);
  });

  it('com tudo enviado, nao ha proxima', () => {
    expect(
      proximaEtapaEsperada(
        contexto({ envios: [envio(1, 'ENVIADA'), envio(2, 'ENVIADA'), envio(3, 'ENVIADA')] })
      )
    ).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// A GUARDA
// -----------------------------------------------------------------------------

describe('validarDecisao — opt-out e uma barreira absoluta', () => {
  it('lead em opt-out: SEND_STEP e recusado e vira STOP_CAMPAIGN', () => {
    const r = validarDecisao(
      contexto({ lead: { ...contexto().lead, optOut: true } }),
      decisao({ acao: 'SEND_STEP', etapaOrdem: 1, confianca: 99 })
    );
    expect(r.permitida).toBe(false);
    expect(r.acaoFinal).toBe('STOP_CAMPAIGN');
    expect(r.motivoRejeicao).toBe('LEAD_EM_OPT_OUT');
  });

  // A IA nao tem como reativar um lead que pediu para parar. Nem por
  // RESUME, nem por RETRY, nem com confianca 100.
  it('lead em opt-out: nenhuma acao de envio passa, qualquer que seja', () => {
    for (const acao of ['SEND_STEP', 'ADVANCE_STEP', 'RETRY_SEND', 'RESUME'] as const) {
      const r = validarDecisao(
        contexto({ lead: { ...contexto().lead, optOut: true } }),
        decisao({ acao, confianca: 100, intent: 'ACEITE' })
      );
      expect(r.permitida, `acao ${acao} deveria ser recusada`).toBe(false);
      expect(r.acaoFinal).toBe('STOP_CAMPAIGN');
    }
  });

  it('opt-out detectado agora vira STOP_CAMPAIGN mesmo se a acao pedida for outra', () => {
    const r = validarDecisao(contexto(), decisao({ intent: 'OPT_OUT', optOut: true, acao: 'SEND_STEP' }));
    expect(r.acaoFinal).toBe('STOP_CAMPAIGN');
  });
});

describe('validarDecisao — nao duplica envio', () => {
  it('etapa ja ENVIADA nao e enviada de novo', () => {
    const r = validarDecisao(
      contexto({ envios: [envio(1, 'ENVIADA')] }),
      decisao({ acao: 'SEND_STEP', etapaOrdem: 1 })
    );
    expect(r.permitida).toBe(false);
    expect(r.motivoRejeicao).toBe('ETAPA_JA_ENVIADA');
    expect(r.acaoFinal).toBe('WAIT');
  });

  it('etapa ja AGENDADA nao gera segunda ordem', () => {
    const r = validarDecisao(
      contexto({ envios: [envio(1, 'ENVIADA'), envio(2, 'AGENDADA')] }),
      decisao({ acao: 'SEND_STEP', etapaOrdem: 2 })
    );
    expect(r.permitida).toBe(false);
    expect(r.motivoRejeicao).toBe('ETAPA_JA_ENVIADA');
  });

  it('etapa PROCESSANDO nao gera segunda ordem', () => {
    const r = validarDecisao(
      contexto({ envios: [envio(1, 'PROCESSANDO')] }),
      decisao({ acao: 'SEND_STEP', etapaOrdem: 1 })
    );
    expect(r.permitida).toBe(false);
  });

  // O caso que o usuario pediu explicitamente: reexecucao do modelo.
  it('a mesma decisao repetida cinco vezes so passa enquanto a etapa nao tem envio', () => {
    const semEnvio = contexto();
    const comEnvio = contexto({ envios: [envio(1, 'ENVIADA')] });
    const d = decisao({ acao: 'SEND_STEP', etapaOrdem: 1 });

    expect(validarDecisao(semEnvio, d).permitida).toBe(true);
    for (let i = 0; i < 5; i += 1) {
      expect(validarDecisao(comEnvio, d).permitida).toBe(false);
    }
  });
});

describe('validarDecisao — respeita a ordem da sequencia', () => {
  it('pular da 1 para a 3 e recusado', () => {
    const r = validarDecisao(contexto(), decisao({ acao: 'SEND_STEP', etapaOrdem: 3 }));
    expect(r.permitida).toBe(false);
    expect(r.motivoRejeicao).toBe('PULO_DE_ETAPA');
  });

  it('etapa que nao existe na campanha e recusada', () => {
    const r = validarDecisao(contexto(), decisao({ acao: 'SEND_STEP', etapaOrdem: 9 }));
    expect(r.permitida).toBe(false);
    expect(r.motivoRejeicao).toBe('ETAPA_INEXISTENTE');
  });

  it('SEND_STEP sem dizer a etapa e recusado', () => {
    const r = validarDecisao(contexto(), decisao({ acao: 'SEND_STEP', etapaOrdem: null }));
    expect(r.permitida).toBe(false);
    expect(r.motivoRejeicao).toBe('ETAPA_NAO_INFORMADA');
  });

  it('com a sequencia toda enviada, nao ha proxima', () => {
    const r = validarDecisao(
      contexto({ envios: [envio(1, 'ENVIADA'), envio(2, 'ENVIADA'), envio(3, 'ENVIADA')] }),
      decisao({ acao: 'SEND_STEP', etapaOrdem: 2 })
    );
    expect(r.permitida).toBe(false);
  });
});

describe('validarDecisao — estado da campanha e do lead', () => {
  it('campanha em RASCUNHO nao recebe envio', () => {
    const r = validarDecisao(
      contexto({ campanha: { ...contexto().campanha, status: 'RASCUNHO' } }),
      decisao({ acao: 'SEND_STEP', etapaOrdem: 1 })
    );
    expect(r.permitida).toBe(false);
    expect(r.motivoRejeicao).toBe('CAMPANHA_NAO_ATIVA');
  });

  it('sequencia esperando liberacao manual nao e retomada pela IA', () => {
    const r = validarDecisao(
      contexto({ posicao: { ...contexto().posicao, aguardandoLiberacao: true } }),
      decisao({ acao: 'RESUME', etapaOrdem: 2 })
    );
    expect(r.permitida).toBe(false);
    expect(r.motivoRejeicao).toBe('AGUARDANDO_LIBERACAO');
  });

  // A etapa 3 do fluxo real: alguem precisa montar a previa antes.
  // A acao nao e so negada — ela vira o que voce configurou.
  it('etapa marcada como manual vira intervencao, nao envio', () => {
    const r = validarDecisao(
      contexto({ envios: [envio(1, 'ENVIADA'), envio(2, 'ENVIADA')] }),
      decisao({ acao: 'SEND_STEP', etapaOrdem: 3 })
    );
    expect(r.permitida).toBe(false);
    expect(r.motivoRejeicao).toBe('ETAPA_MANUAL');
    expect(r.acaoFinal).toBe('CREATE_INTERVENTION');
    expect(r.etapaFinal).toBe(3);
  });

  // Duas recusas diferentes, as duas corretas. Sobre uma etapa ENVIADA o
  // "ja saiu" e checado primeiro — e a barreira mais forte, entao vence.
  it('RETRY_SEND sobre etapa ENVIADA e recusado por ja ter saido', () => {
    const r = validarDecisao(
      contexto({ envios: [envio(1, 'ENVIADA')] }),
      decisao({ acao: 'RETRY_SEND', etapaOrdem: 1 })
    );
    expect(r.permitida).toBe(false);
    expect(r.motivoRejeicao).toBe('ETAPA_JA_ENVIADA');
  });

  it('RETRY_SEND sobre etapa que nunca teve envio e recusado', () => {
    const r = validarDecisao(contexto(), decisao({ acao: 'RETRY_SEND', etapaOrdem: 1 }));
    expect(r.permitida).toBe(false);
    expect(r.motivoRejeicao).toBe('RETRY_SEM_FALHA');
  });

  it('RETRY_SEND sobre etapa que falhou de verdade e permitido', () => {
    const r = validarDecisao(
      contexto({ envios: [envio(1, 'FALHOU')] }),
      decisao({ acao: 'RETRY_SEND', etapaOrdem: 1 })
    );
    expect(r.permitida).toBe(true);
  });
});

describe('validarDecisao — acoes que nao enviam passam', () => {
  it.each(['WAIT', 'PAUSE', 'CREATE_INTERVENTION', 'NOTIFY_OPERATOR', 'STOP_CAMPAIGN'] as const)(
    '%s e permitida sem conferir etapa',
    (acao) => {
      const r = validarDecisao(contexto(), decisao({ acao, etapaOrdem: null }));
      expect(r.permitida).toBe(true);
      expect(r.acaoFinal).toBe(acao);
    }
  );

  it('o caminho feliz: etapa 2 pendente, IA pede a 2, passa', () => {
    const r = validarDecisao(
      contexto({ envios: [envio(1, 'ENVIADA')] }),
      decisao({ acao: 'SEND_STEP', etapaOrdem: 2 })
    );
    expect(r.permitida).toBe(true);
    expect(r.acaoFinal).toBe('SEND_STEP');
    expect(r.etapaFinal).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// Prompt
// -----------------------------------------------------------------------------

describe('montarPrompt', () => {
  it('mostra o estado real dos envios, que e a fonte da verdade', () => {
    const p = montarPrompt(contexto({ envios: [envio(1, 'ENVIADA', { statusMensagem: 'ENTREGUE' })] }));
    expect(p).toContain('ENVIOS REAIS');
    expect(p).toContain('ordem de envio: ENVIADA');
    expect(p).toContain('mensagem: ENTREGUE');
  });

  it('diz explicitamente quando nada foi enviado', () => {
    expect(montarPrompt(contexto())).toContain('nenhum envio registrado ainda');
  });

  it('entrega a proxima etapa ja calculada, para o modelo nao deduzir', () => {
    expect(montarPrompt(contexto({ envios: [envio(1, 'ENVIADA')] })))
      .toContain('PROXIMA ETAPA SEM ENVIO: 2');
  });

  it('destaca o opt-out do lead', () => {
    const p = montarPrompt(contexto({ lead: { ...contexto().lead, optOut: true } }));
    expect(p).toContain('OPT-OUT: SIM');
  });

  it('marca a etapa manual como manual', () => {
    expect(montarPrompt(contexto())).toContain('ENVIO MANUAL');
  });

  // O prompt viaja para fora da maquina. Nada de segredo pode ir junto.
  it('nao carrega segredo nenhum', () => {
    const p = montarPrompt(contexto()).toLowerCase();
    for (const proibido of ['api_key', 'apikey', 'session_secret', 'database_url', 'password', 'senha']) {
      expect(p).not.toContain(proibido);
    }
  });

  it('e puro: a mesma entrada produz exatamente o mesmo texto', () => {
    const c = contexto();
    expect(montarPrompt(c)).toBe(montarPrompt(c));
  });
});
