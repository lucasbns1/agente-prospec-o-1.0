/**
 * Enums compartilhados entre API, worker e frontend.
 *
 * Estes valores espelham exatamente os enums do schema Prisma. Sao
 * redeclarados aqui como constantes simples porque o frontend NAO pode
 * importar @prisma/client (arrastaria o cliente do banco para o browser).
 *
 * Se um enum mudar no schema, mude aqui tambem. O teste
 * `tests/enums.test.ts` compara os dois e falha se divergirem.
 */

export const LEAD_STATUS = [
  'NOVO',
  'IMPORTADO',
  'PRONTO',
  'EM_CAMPANHA',
  'AGUARDANDO_RESPOSTA',
  'EM_CONVERSA',
  'AGUARDANDO_INTERVENCAO',
  'AGENDADO',
  'PAUSADO',
  'ENCERRADO',
  'OPT_OUT',
  'OPORTUNIDADE',
  'CLIENTE',
] as const;
export type LeadStatus = (typeof LEAD_STATUS)[number];

/**
 * Status que significam "este lead esta parado esperando VOCE".
 * Alimenta a secao "precisa da sua atencao" do dashboard.
 */
export const STATUS_PRECISA_ATENCAO: readonly LeadStatus[] = [
  'AGUARDANDO_INTERVENCAO',
];

/** Status que contam como "ja foi prospectado". */
export const STATUS_PROSPECTADO: readonly LeadStatus[] = [
  'EM_CAMPANHA',
  'AGUARDANDO_RESPOSTA',
  'EM_CONVERSA',
  'AGUARDANDO_INTERVENCAO',
  'AGENDADO',
  'PAUSADO',
  'ENCERRADO',
  'OPT_OUT',
  'OPORTUNIDADE',
  'CLIENTE',
];

export const TEMPERATURA = ['FRIO', 'MORNO', 'QUENTE'] as const;
export type Temperatura = (typeof TEMPERATURA)[number];

export const WEBSITE_STATUS = [
  'NAO_INFORMADO',
  'REDE_SOCIAL',
  'SITE_PROPRIO',
  'INVALIDO',
  'NAO_VERIFICADO',
] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUS)[number];

/**
 * Ordem de precedencia PADRAO das categorias de resposta.
 *
 * A ordem real usada em runtime vem da tabela `settings`
 * (chave `regras.precedencia`) — este array e apenas o fallback caso a
 * configuracao nao exista.
 */
export const RESPOSTA_CATEGORIA = [
  'OPT_OUT',
  'NEGATIVO',
  'FALAR_DEPOIS',
  'PRECO',
  'DUVIDA',
  'POSITIVO',
  'INTERESSE',
  'DESCONHECIDO',
] as const;
export type RespostaCategoria = (typeof RESPOSTA_CATEGORIA)[number];

export const MATCH_TIPO = ['EXATO', 'CONTEM', 'PALAVRA', 'INICIA_COM', 'REGEX'] as const;
export type MatchTipo = (typeof MATCH_TIPO)[number];

export const STEP_ACTION = [
  'AVANCAR',
  'IR_PARA_ETAPA',
  'PARAR',
  'SNOOZE',
  'AGUARDAR_INTERVENCAO',
  'NENHUMA',
] as const;
export type StepAction = (typeof STEP_ACTION)[number];

export const SNOOZE_UNIDADE = ['HORAS', 'DIAS', 'DATA_ESPECIFICA'] as const;
export type SnoozeUnidade = (typeof SNOOZE_UNIDADE)[number];

export const CAMPAIGN_STATUS = [
  'RASCUNHO',
  'ATIVA',
  'PAUSADA',
  'CONCLUIDA',
  'ARQUIVADA',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUS)[number];

export const MESSAGE_STATUS = [
  'PENDENTE',
  'ENVIANDO',
  'ENVIADA',
  'ENTREGUE',
  'LIDA',
  'FALHOU',
  'SIMULADA',
  'CANCELADA',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUS)[number];

/**
 * Status que contam para o LIMITE DIARIO de envios.
 * SIMULADA (dry-run) e FALHOU ficam de fora de proposito.
 */
export const STATUS_ENVIO_REAL: readonly MessageStatus[] = [
  'ENVIADA',
  'ENTREGUE',
  'LIDA',
];

export const TASK_STATUS = ['ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

export const TASK_PRIORITY = ['BAIXA', 'MEDIA', 'ALTA', 'URGENTE'] as const;
export type TaskPriority = (typeof TASK_PRIORITY)[number];

// O modo global de envio (`WHATSAPP_MODE`) foi removido do sistema: ele
// travava o envio inteiro por variavel de ambiente, sem aparecer na
// interface. Quem decide simulacao agora e a campanha (`dryRun`), mais a
// trava de fase em `packages/integrations/src/whatsapp/guarda-envio.ts`.

/**
 * Estados da conexao com o canal.
 *
 * Sao sete de proposito: colapsar "inicializando", "aguardando QR" e
 * "autenticando" num unico "conectando" esconde exatamente a informacao
 * que voce precisa quando a conexao nao sobe. E a diferenca entre "o
 * Chromium ainda esta abrindo" e "o QR expirou e ninguem escaneou".
 *
 * NAO e enum do Prisma: o estado da conexao e efemero, vive no processo
 * do worker e e publicado por SSE. Persistir seria guardar uma verdade
 * que expira em segundos.
 */
export const WHATSAPP_STATUS = [
  /** Sem conexao e sem tentativa em curso. */
  'DESCONECTADO',
  /** Subindo o navegador e a biblioteca. */
  'INICIALIZANDO',
  /** QR gerado, esperando alguem escanear. */
  'AGUARDANDO_QR',
  /** QR lido; validando a sessao. */
  'AUTENTICANDO',
  /** Pronto para receber (e, numa fase futura, enviar). */
  'CONECTADO',
  /** Caiu e esta tentando voltar sozinho. */
  'RECONECTANDO',
  /** Desistiu. Exige acao humana. */
  'FALHOU',
] as const;
export type WhatsAppStatus = (typeof WHATSAPP_STATUS)[number];

/** Estados em que o canal consegue receber mensagens. */
export const STATUS_CANAL_SAUDAVEL: readonly WhatsAppStatus[] = ['CONECTADO'];

/** Estados que exigem alguem olhar. */
export const STATUS_CANAL_PRECISA_ACAO: readonly WhatsAppStatus[] = [
  'AGUARDANDO_QR',
  'FALHOU',
];

/** Nomes das filas BullMQ. Uma unica fonte para API e worker. */
export const QUEUES = {
  SEND_MESSAGE: 'send_message',
  OUTBOUND_SEND: 'outbound_send',
  PROCESS_INCOMING_MESSAGE: 'process_incoming_message',
  ADVANCE_CAMPAIGN: 'advance_campaign',
  CREATE_NOTIFICATION: 'create_notification',
  CREATE_TASK: 'create_task',
  WEBSITE_CHECK: 'website_check',
  IMPORT_CSV: 'import_csv',
  CLEANUP_IMPORT: 'cleanup_import',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Gatilhos que a API pode pedir ao orquestrador do worker.
 *
 * Vive aqui, e nao no dominio, porque quem precisa concordar sobre estes
 * nomes sao os dois APPS — e eles nao se importam. `@prospector/shared` e
 * o unico lugar que os dois alcancam.
 *
 * A lista e menor que a de `GatilhoCadencia`: a API so sabe de coisas que
 * VOCE faz. Os outros gatilhos (mensagem recebida, etapa concluida, ACK,
 * falha) nascem dentro do proprio worker.
 */
export const GATILHOS_ORQUESTRACAO = ['OPERADOR_LIBEROU'] as const;
export type GatilhoOrquestracao = (typeof GATILHOS_ORQUESTRACAO)[number];

/** Variaveis aceitas nos templates de mensagem. */
export const TEMPLATE_VARIAVEIS = [
  'primeiro_nome',
  'nome_completo',
  'empresa',
  'bairro',
  'cidade',
  'estado',
  'telefone',
  'categoria',
  'site_preview_url',
] as const;
export type TemplateVariavel = (typeof TEMPLATE_VARIAVEIS)[number];
