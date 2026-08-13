/**
 * Decisao de acao a partir de uma classificacao.
 *
 * ============================================================
 * O QUE ESTE ARQUIVO NUNCA FAZ
 * ============================================================
 * Nunca escreve o texto de uma resposta. No maximo devolve
 * `{ acao: 'RESPONDER', templateId }`. O texto vive em
 * `response_templates`, editavel por voce (requisito 49).
 *
 * Se a categoria exige resposta mas nao ha template ativo, o sistema
 * NAO improvisa: registra `missing_template`, cria intervencao e nao
 * envia nada (requisito 51).
 *
 * ============================================================
 * A REGRA DE OURO (requisito 52)
 * ============================================================
 * Entre responder e nao responder, nao responder sempre vence.
 * Toda incerteza vira intervencao humana.
 */
import type {
  RespostaCategoria,
  Temperatura,
  LeadStatus,
} from '@prospector/shared';
import type { ResultadoClassificacao } from './motor.js';

export type AcaoMotor =
  | 'RESPONDER'
  | 'AVANCAR'
  | 'AGUARDAR'
  | 'SNOOZE'
  | 'PARAR'
  | 'OPT_OUT'
  | 'INTERVENCAO';

/** Configuracao de uma categoria: o que fazer quando ela vencer. */
export interface RegraCategoria {
  categoria: RespostaCategoria;
  acao: AcaoMotor;
  /** Template a usar quando acao === RESPONDER. */
  templateId?: string | null;
  novaTemperatura?: Temperatura | null;
  novoStatus?: LeadStatus | null;
  criarTarefa?: boolean;
  tarefaTitulo?: string | null;
  notificar?: boolean;
  snoozeHoras?: number | null;
  ativo?: boolean;
}

/** Um template disponivel. */
export interface TemplateDisponivel {
  templateId: string;
  categoria: RespostaCategoria;
  subtipo: string | null;
  campaignStepId: string | null;
  ativo: boolean;
}

export type EfeitoDecisao =
  | { tipo: 'ENVIAR_TEMPLATE'; templateId: string }
  | { tipo: 'AVANCAR_ETAPA' }
  | { tipo: 'AGUARDAR_RESPOSTA' }
  | { tipo: 'AGENDAR_SNOOZE'; retomarEm: Date; horas: number }
  | { tipo: 'PARAR_SEQUENCIA'; motivo: string }
  | { tipo: 'REGISTRAR_OPT_OUT' }
  | { tipo: 'CANCELAR_JOBS_PENDENTES'; motivo: string }
  | { tipo: 'ALTERAR_TEMPERATURA'; para: Temperatura; motivo: string }
  | { tipo: 'ALTERAR_STATUS'; para: LeadStatus; motivo: string }
  | { tipo: 'CRIAR_TAREFA'; titulo: string; tipo_tarefa: string }
  | { tipo: 'CRIAR_INTERVENCAO'; titulo: string; mensagem: string; motivo: MotivoIntervencao }
  | { tipo: 'REGISTRAR_EVENTO'; eventoTipo: string; descricao: string; dados?: unknown };

export type MotivoIntervencao =
  | 'RESPOSTA_DESCONHECIDA'
  | 'MISSING_TEMPLATE'
  | 'SEM_REGRA_CONFIGURADA'
  | 'PEDIDO_HUMANO'
  | 'SUSPEITA_GOLPE'
  | 'BAIXA_CONFIANCA'
  | 'MIDIA_NAO_SUPORTADA';

export interface ResultadoDecisao {
  acao: AcaoMotor;
  efeitos: EfeitoDecisao[];
  /** Preenchido apenas quando acao === RESPONDER. */
  templateId: string | null;
  /** true = nenhuma mensagem automatica sai. */
  bloqueiaEnvio: boolean;
  resumo: string;
}

export interface EstadoLead {
  leadId: string;
  nome: string | null;
  optOut: boolean;
  temperatura: Temperatura;
  /** Ha proxima etapa na campanha? */
  temProximaEtapa: boolean;
}

export interface OpcoesDecisao {
  agora?: Date;
  /** Regras por categoria, vindas de `campaign_step_rules`. */
  regras: RegraCategoria[];
  templates: TemplateDisponivel[];
  campaignStepId?: string | null;
  /** Padrao para SNOOZE quando a regra nao especificar. */
  snoozeHorasPadrao?: number;
  /**
   * Confianca minima para executar uma acao que ENVIA mensagem
   * (RESPONDER ou AVANCAR). Padrao 50.
   *
   * POR QUE E MAIOR QUE O LIMIAR DE CLASSIFICACAO (30):
   * classificar e agir tem custos diferentes. Registrar "isto parece
   * POSITIVO" com confianca 35 e util para o CRM. Mas disparar a
   * proxima mensagem da sequencia por causa de um "ok" solto e uma
   * aposta — e uma mensagem enviada nao volta atras.
   *
   * Acoes que NAO enviam nada (SNOOZE, PARAR, AGUARDAR) nao passam por
   * este limiar: elas so tornam o sistema mais silencioso.
   */
  confiancaMinimaParaAgir?: number;
}

function intervencao(
  titulo: string,
  mensagem: string,
  motivo: MotivoIntervencao
): EfeitoDecisao[] {
  return [
    { tipo: 'ALTERAR_STATUS', para: 'AGUARDANDO_INTERVENCAO', motivo: titulo },
    { tipo: 'CRIAR_INTERVENCAO', titulo, mensagem, motivo },
    {
      tipo: 'CRIAR_TAREFA',
      titulo,
      tipo_tarefa: 'RESPOSTA_NAO_RECONHECIDA',
    },
    { tipo: 'REGISTRAR_EVENTO', eventoTipo: 'INTERVENCAO_NECESSARIA', descricao: mensagem },
  ];
}

/** Encontra o template mais especifico para a categoria. */
export function escolherTemplate(
  categoria: RespostaCategoria,
  subtipo: string | null,
  campaignStepId: string | null | undefined,
  templates: TemplateDisponivel[]
): string | null {
  const ativos = templates.filter((t) => t.ativo && t.categoria === categoria);
  if (ativos.length === 0) return null;

  // Especificidade decrescente: etapa+subtipo > etapa > subtipo > geral.
  const candidatos = [
    ativos.find((t) => t.campaignStepId === campaignStepId && t.subtipo === subtipo),
    ativos.find((t) => t.campaignStepId === campaignStepId && t.subtipo == null),
    ativos.find((t) => t.campaignStepId == null && t.subtipo === subtipo),
    ativos.find((t) => t.campaignStepId == null && t.subtipo == null),
  ];

  return candidatos.find((c) => c !== undefined)?.templateId ?? null;
}

/**
 * Decide o que fazer com uma resposta classificada.
 *
 * INVARIANTES garantidas (e cobertas por teste):
 *  1. OPT_OUT sempre para tudo e registra opt-out. Nenhuma configuracao
 *     pode sobrepor isso.
 *  2. Lead ja em opt-out nunca recebe efeito de envio.
 *  3. DESCONHECIDO nunca avanca e nunca responde.
 *  4. RESPONDER sem template vira intervencao, nunca texto improvisado.
 *  5. Categoria sem regra configurada vira intervencao.
 */
export function decidirAcao(
  classificacao: ResultadoClassificacao,
  estado: EstadoLead,
  opcoes: OpcoesDecisao
): ResultadoDecisao {
  const agora = opcoes.agora ?? new Date();
  const { categoria, sinais } = classificacao;

  // ---------------------------------------------------------------
  // 1. OPT-OUT E INVIOLAVEL
  //
  // Vem antes de qualquer regra configurada de proposito. Nao ha
  // configuracao no painel capaz de fazer o sistema continuar mandando
  // mensagem para quem pediu para parar.
  // ---------------------------------------------------------------
  if (categoria === 'OPT_OUT') {
    return {
      acao: 'OPT_OUT',
      templateId: null,
      bloqueiaEnvio: true,
      resumo: 'Lead pediu para nao receber mais mensagens — sequencia encerrada em definitivo',
      efeitos: [
        { tipo: 'REGISTRAR_OPT_OUT' },
        { tipo: 'CANCELAR_JOBS_PENDENTES', motivo: 'opt-out do lead' },
        { tipo: 'PARAR_SEQUENCIA', motivo: 'opt-out' },
        { tipo: 'ALTERAR_STATUS', para: 'OPT_OUT', motivo: 'Lead solicitou opt-out' },
        { tipo: 'ALTERAR_TEMPERATURA', para: 'FRIO', motivo: 'opt-out' },
        {
          tipo: 'REGISTRAR_EVENTO',
          eventoTipo: 'OPT_OUT_REGISTRADO',
          descricao: `Opt-out registrado: "${classificacao.textoNormalizado.slice(0, 120)}"`,
        },
      ],
    };
  }

  // ---------------------------------------------------------------
  // 2. Lead JA em opt-out: nada sai, aconteca o que acontecer
  // ---------------------------------------------------------------
  if (estado.optOut) {
    return {
      acao: 'PARAR',
      templateId: null,
      bloqueiaEnvio: true,
      resumo: 'Lead esta em opt-out — nenhuma mensagem pode ser enviada',
      efeitos: [
        {
          tipo: 'REGISTRAR_EVENTO',
          eventoTipo: 'MENSAGEM_RECEBIDA',
          descricao: 'Resposta recebida de lead em opt-out; nenhuma acao automatica',
        },
      ],
    };
  }

  // ---------------------------------------------------------------
  // 3. Sinais que exigem humano, independentemente da categoria
  // ---------------------------------------------------------------
  if (sinais.suspeitaGolpe) {
    return {
      acao: 'INTERVENCAO',
      templateId: null,
      bloqueiaEnvio: true,
      resumo: 'Lead questionou a origem do contato — resposta automatica seria pior que o silencio',
      efeitos: intervencao(
        'Lead questionou a origem do contato',
        `${estado.nome ?? 'O lead'} perguntou de onde veio o contato. Responda pessoalmente.`,
        'SUSPEITA_GOLPE'
      ),
    };
  }

  if (sinais.pedidoHumano) {
    return {
      acao: 'INTERVENCAO',
      templateId: null,
      bloqueiaEnvio: true,
      resumo: 'Lead pediu para falar com uma pessoa',
      efeitos: intervencao(
        'Lead quer falar com uma pessoa',
        `${estado.nome ?? 'O lead'} pediu contato humano.`,
        'PEDIDO_HUMANO'
      ),
    };
  }

  // ---------------------------------------------------------------
  // 4. DESCONHECIDO nunca avanca e nunca responde (requisito 11)
  // ---------------------------------------------------------------
  if (categoria === 'DESCONHECIDO' || classificacao.desconhecido) {
    return {
      acao: 'INTERVENCAO',
      templateId: null,
      bloqueiaEnvio: true,
      resumo: `Resposta nao reconhecida — ${classificacao.motivo}`,
      efeitos: intervencao(
        'Nova resposta precisa de atendimento manual',
        `${estado.nome ?? 'O lead'} respondeu algo que o sistema nao reconheceu: ` +
          `"${classificacao.textoNormalizado.slice(0, 160)}"`,
        'RESPOSTA_DESCONHECIDA'
      ),
    };
  }

  // ---------------------------------------------------------------
  // 5. Regra configurada para a categoria
  // ---------------------------------------------------------------
  const regra = opcoes.regras.find(
    (r) => r.categoria === categoria && r.ativo !== false
  );

  if (!regra) {
    return {
      acao: 'INTERVENCAO',
      templateId: null,
      bloqueiaEnvio: true,
      resumo: `Categoria ${categoria} detectada, mas nao ha regra configurada para ela`,
      efeitos: intervencao(
        `Sem regra para ${categoria}`,
        `A resposta foi classificada como ${categoria}, mas nenhuma acao esta ` +
          `configurada. O sistema nao vai improvisar.`,
        'SEM_REGRA_CONFIGURADA'
      ),
    };
  }

  // ---------------------------------------------------------------
  // 5b. Confianca insuficiente para uma acao que ENVIA
  //
  // Um "ok" solto e classificado como POSITIVO com confianca baixa.
  // Isso e informacao util para o CRM, mas nao e base para disparar a
  // proxima mensagem da sequencia. Aqui a regra de ouro se aplica:
  // classificamos, registramos, e chamamos um humano em vez de enviar.
  // ---------------------------------------------------------------
  const acaoEnvia = regra.acao === 'RESPONDER' || regra.acao === 'AVANCAR';
  const minimoParaAgir = opcoes.confiancaMinimaParaAgir ?? 50;

  if (acaoEnvia && classificacao.confianca < minimoParaAgir) {
    return {
      acao: 'INTERVENCAO',
      templateId: null,
      bloqueiaEnvio: true,
      resumo:
        `${categoria} detectado, mas com confianca ${classificacao.confianca} ` +
        `(minimo ${minimoParaAgir} para enviar) — melhor voce olhar`,
      efeitos: intervencao(
        'Resposta fraca demais para responder sozinho',
        `${estado.nome ?? 'O lead'} respondeu "${classificacao.textoNormalizado.slice(0, 100)}". ` +
          `Parece ${categoria}, mas o sinal e fraco demais para o sistema agir sozinho.`,
        'BAIXA_CONFIANCA'
      ),
    };
  }

  const efeitos: EfeitoDecisao[] = [];

  // Efeitos colaterais comuns
  if (regra.novaTemperatura && regra.novaTemperatura !== estado.temperatura) {
    efeitos.push({
      tipo: 'ALTERAR_TEMPERATURA',
      para: regra.novaTemperatura,
      motivo: `resposta ${categoria}`,
    });
    efeitos.push({
      tipo: 'REGISTRAR_EVENTO',
      eventoTipo: 'TEMPERATURA_ALTERADA',
      descricao: `${estado.temperatura} -> ${regra.novaTemperatura} (${categoria})`,
      dados: { de: estado.temperatura, para: regra.novaTemperatura },
    });
  }

  if (regra.criarTarefa && regra.tarefaTitulo) {
    efeitos.push({
      tipo: 'CRIAR_TAREFA',
      titulo: regra.tarefaTitulo,
      tipo_tarefa: 'RESPONDER_CLIENTE',
    });
  }

  efeitos.push({
    tipo: 'REGISTRAR_EVENTO',
    eventoTipo: 'RESPOSTA_CLASSIFICADA',
    descricao: classificacao.motivo,
    dados: {
      categoria,
      detectadas: classificacao.categoriasDetectadas,
      confianca: classificacao.confianca,
      subtipo: classificacao.subtipo,
    },
  });

  // ---------------------------------------------------------------
  // 6. Acao especifica
  // ---------------------------------------------------------------
  switch (regra.acao) {
    case 'RESPONDER': {
      const templateId =
        regra.templateId ??
        escolherTemplate(
          categoria,
          classificacao.subtipo,
          opcoes.campaignStepId,
          opcoes.templates
        );

      // Requisito 51: sem template, NAO inventar resposta.
      if (!templateId) {
        return {
          acao: 'INTERVENCAO',
          templateId: null,
          bloqueiaEnvio: true,
          resumo: `missing_template para ${categoria}`,
          efeitos: [
            ...efeitos,
            ...intervencao(
              `Falta template para ${categoria}`,
              `A regra manda responder, mas nao ha template ativo para ` +
                `${categoria}. Nenhuma mensagem foi enviada.`,
              'MISSING_TEMPLATE'
            ),
          ],
        };
      }

      efeitos.push({ tipo: 'ENVIAR_TEMPLATE', templateId });
      if (regra.novoStatus) {
        efeitos.push({ tipo: 'ALTERAR_STATUS', para: regra.novoStatus, motivo: categoria });
      }

      return {
        acao: 'RESPONDER',
        templateId,
        bloqueiaEnvio: false,
        resumo: `Responder ${categoria} com o template ${templateId}`,
        efeitos,
      };
    }

    case 'AVANCAR': {
      if (!estado.temProximaEtapa) {
        efeitos.push({
          tipo: 'PARAR_SEQUENCIA',
          motivo: 'ultima etapa da campanha alcancada',
        });
        efeitos.push({
          tipo: 'ALTERAR_STATUS',
          para: regra.novoStatus ?? 'ENCERRADO',
          motivo: 'fim da sequencia',
        });
        return {
          acao: 'PARAR',
          templateId: null,
          bloqueiaEnvio: true,
          resumo: 'Sequencia chegou ao fim — nada a avancar',
          efeitos,
        };
      }

      efeitos.push({ tipo: 'AVANCAR_ETAPA' });
      if (regra.novoStatus) {
        efeitos.push({ tipo: 'ALTERAR_STATUS', para: regra.novoStatus, motivo: categoria });
      }
      return {
        acao: 'AVANCAR',
        templateId: null,
        bloqueiaEnvio: false,
        resumo: `Avancar para a proxima etapa apos ${categoria}`,
        efeitos,
      };
    }

    case 'SNOOZE': {
      const horas = regra.snoozeHoras ?? opcoes.snoozeHorasPadrao ?? 72;
      const retomarEm = new Date(agora.getTime() + horas * 3600_000);

      efeitos.push({ tipo: 'AGENDAR_SNOOZE', retomarEm, horas });
      efeitos.push({
        tipo: 'ALTERAR_STATUS',
        para: regra.novoStatus ?? 'AGENDADO',
        motivo: 'lead pediu para falar depois',
      });
      efeitos.push({
        tipo: 'REGISTRAR_EVENTO',
        eventoTipo: 'SNOOZE_AGENDADO',
        descricao: `Retomar em ${retomarEm.toISOString()} (${horas}h)`,
      });

      return {
        acao: 'SNOOZE',
        templateId: null,
        bloqueiaEnvio: true,
        resumo: `Lead pediu para falar depois — retomar em ${horas}h`,
        efeitos,
      };
    }

    case 'PARAR': {
      efeitos.push({ tipo: 'PARAR_SEQUENCIA', motivo: `resposta ${categoria}` });
      efeitos.push({
        tipo: 'CANCELAR_JOBS_PENDENTES',
        motivo: `resposta ${categoria}`,
      });
      efeitos.push({
        tipo: 'ALTERAR_STATUS',
        para: regra.novoStatus ?? 'ENCERRADO',
        motivo: categoria,
      });
      return {
        acao: 'PARAR',
        templateId: null,
        bloqueiaEnvio: true,
        resumo: `Sequencia encerrada por resposta ${categoria}`,
        efeitos,
      };
    }

    case 'AGUARDAR': {
      efeitos.push({ tipo: 'AGUARDAR_RESPOSTA' });
      return {
        acao: 'AGUARDAR',
        templateId: null,
        bloqueiaEnvio: true,
        resumo: 'Aguardando proxima manifestacao do lead',
        efeitos,
      };
    }

    case 'INTERVENCAO':
    default: {
      return {
        acao: 'INTERVENCAO',
        templateId: null,
        bloqueiaEnvio: true,
        resumo: `Regra de ${categoria} pede intervencao humana`,
        efeitos: [
          ...efeitos,
          ...intervencao(
            `${categoria} precisa da sua atencao`,
            `A regra configurada para ${categoria} exige intervencao manual.`,
            'SEM_REGRA_CONFIGURADA'
          ),
        ],
      };
    }
  }
}

/**
 * Decisao para mensagens sem texto (imagem, audio, sticker, documento).
 * Requisito 41: nao tentar interpretar midia.
 */
export function decidirMidia(estado: EstadoLead, tipoMidia: string): ResultadoDecisao {
  if (estado.optOut) {
    return {
      acao: 'PARAR',
      templateId: null,
      bloqueiaEnvio: true,
      resumo: 'Lead em opt-out',
      efeitos: [],
    };
  }

  return {
    acao: 'INTERVENCAO',
    templateId: null,
    bloqueiaEnvio: true,
    resumo: `Mensagem de midia (${tipoMidia}) — o sistema nao interpreta midia`,
    efeitos: intervencao(
      'Lead enviou mídia',
      `${estado.nome ?? 'O lead'} enviou ${tipoMidia}. O sistema nao interpreta ` +
        `midia automaticamente.`,
      'MIDIA_NAO_SUPORTADA'
    ),
  };
}
