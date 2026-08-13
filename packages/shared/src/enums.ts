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

export const WHATSAPP_MODE = ['dry-run', 'live'] as const;
export type WhatsAppMode = (typeof WHATSAPP_MODE)[number];

export const WHATSAPP_STATUS = [
  'DESCONECTADO',
  'CONECTANDO',
  'AGUARDANDO_QR',
  'CONECTADO',
  'ERRO',
] as const;
export type WhatsAppStatus = (typeof WHATSAPP_STATUS)[number];

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
