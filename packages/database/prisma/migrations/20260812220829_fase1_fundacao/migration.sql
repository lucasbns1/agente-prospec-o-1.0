-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NOVO', 'IMPORTADO', 'PRONTO', 'EM_CAMPANHA', 'AGUARDANDO_RESPOSTA', 'AGENDADO', 'ATENCAO_NECESSARIA', 'ENCERRADO', 'OPORTUNIDADE', 'CLIENTE');

-- CreateEnum
CREATE TYPE "Temperatura" AS ENUM ('FRIO', 'MORNO', 'QUENTE');

-- CreateEnum
CREATE TYPE "WebsiteStatus" AS ENUM ('NAO_INFORMADO', 'REDE_SOCIAL', 'SITE_PROPRIO', 'INVALIDO', 'NAO_VERIFICADO');

-- CreateEnum
CREATE TYPE "RespostaCategoria" AS ENUM ('OPT_OUT', 'NEGATIVO', 'FALAR_DEPOIS', 'PRECO', 'DUVIDA', 'POSITIVO', 'INTERESSE', 'DESCONHECIDO');

-- CreateEnum
CREATE TYPE "MatchTipo" AS ENUM ('EXATO', 'CONTEM', 'PALAVRA', 'INICIA_COM', 'REGEX');

-- CreateEnum
CREATE TYPE "StepAction" AS ENUM ('AVANCAR', 'IR_PARA_ETAPA', 'PARAR', 'SNOOZE', 'AGUARDAR_INTERVENCAO', 'NENHUMA');

-- CreateEnum
CREATE TYPE "SnoozeUnidade" AS ENUM ('HORAS', 'DIAS', 'DATA_ESPECIFICA');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('RASCUNHO', 'ATIVA', 'PAUSADA', 'CONCLUIDA', 'ARQUIVADA');

-- CreateEnum
CREATE TYPE "LeadCampaignStatus" AS ENUM ('PENDENTE', 'EM_ANDAMENTO', 'AGUARDANDO_RESPOSTA', 'AGUARDANDO_INTERVENCAO', 'AGENDADO', 'CONCLUIDO', 'PARADO', 'OPT_OUT');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('ENVIADA', 'RECEBIDA');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDENTE', 'ENVIANDO', 'ENVIADA', 'ENTREGUE', 'LIDA', 'FALHOU', 'SIMULADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('ABERTA', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('BAIXA', 'MEDIA', 'ALTA', 'URGENTE');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('CRIAR_PREVIEW', 'RESPONDER_CLIENTE', 'ENVIAR_PROPOSTA', 'FOLLOW_UP', 'VERIFICAR_LEAD', 'RESPOSTA_NAO_RECONHECIDA', 'REVISAR_VARIAVEL_FALTANDO', 'OUTRO');

-- CreateEnum
CREATE TYPE "NotificationLevel" AS ENUM ('INFO', 'SUCESSO', 'ALERTA', 'ERRO');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('LEAD_QUENTE', 'ATENCAO_NECESSARIA', 'RESPOSTA_RECEBIDA', 'PEDIDO_PREVIEW', 'PEDIDO_PRECO', 'OPT_OUT', 'CAMPANHA_INICIADA', 'CAMPANHA_PAUSADA', 'CAMPANHA_CONCLUIDA', 'WHATSAPP_CONECTADO', 'WHATSAPP_DESCONECTADO', 'IMPORTACAO_CONCLUIDA', 'IMPORTACAO_FALHOU', 'ENVIO_FALHOU', 'LIMITE_DIARIO_ATINGIDO', 'SISTEMA');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDENTE', 'AGENDADO', 'EXECUTANDO', 'CONCLUIDO', 'FALHOU', 'CANCELADO');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'FALHOU', 'CANCELADO');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDENTE', 'IMPORTADO', 'DUPLICADO', 'INVALIDO', 'IGNORADO');

-- CreateEnum
CREATE TYPE "DedupeCriterio" AS ENUM ('TELEFONE', 'NOME_ENDERECO', 'NOME_CIDADE');

-- CreateEnum
CREATE TYPE "LeadEventType" AS ENUM ('CRIADO', 'IMPORTADO', 'NORMALIZADO', 'DUPLICADO_DETECTADO', 'WEBSITE_VERIFICADO', 'STATUS_ALTERADO', 'TEMPERATURA_ALTERADA', 'ENTROU_EM_CAMPANHA', 'SAIU_DA_CAMPANHA', 'MENSAGEM_ENVIADA', 'MENSAGEM_SIMULADA', 'MENSAGEM_FALHOU', 'MENSAGEM_RECEBIDA', 'RESPOSTA_CLASSIFICADA', 'RESPOSTA_NAO_RECONHECIDA', 'ETAPA_AVANCADA', 'SNOOZE_AGENDADO', 'SNOOZE_CANCELADO', 'OPT_OUT_REGISTRADO', 'TAREFA_CRIADA', 'TAREFA_CONCLUIDA', 'LIBERADO_MANUALMENTE', 'OBSERVACAO_ADICIONADA', 'EDITADO_MANUALMENTE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_login" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "user_agent" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "descricao" TEXT,
    "categoria" TEXT NOT NULL DEFAULT 'geral',
    "sistema" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_domains" (
    "id" TEXT NOT NULL,
    "dominio" TEXT NOT NULL,
    "rotulo" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_keywords" (
    "id" TEXT NOT NULL,
    "categoria" "RespostaCategoria" NOT NULL,
    "termo" TEXT NOT NULL,
    "match_tipo" "MatchTipo" NOT NULL DEFAULT 'CONTEM',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "peso" INTEGER NOT NULL DEFAULT 0,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "campaign_step_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "response_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capture_sessions" (
    "id" TEXT NOT NULL,
    "nicho" TEXT NOT NULL,
    "cidade" TEXT NOT NULL,
    "estado" TEXT,
    "observacao" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capture_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imports" (
    "id" TEXT NOT NULL,
    "nome_arquivo" TEXT NOT NULL,
    "caminho_arquivo" TEXT,
    "tamanho_bytes" INTEGER,
    "formato" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDENTE',
    "mapeamento_colunas" JSONB,
    "colunas_detectadas" JSONB,
    "total_linhas" INTEGER NOT NULL DEFAULT 0,
    "total_importados" INTEGER NOT NULL DEFAULT 0,
    "total_duplicados" INTEGER NOT NULL DEFAULT 0,
    "total_invalidos" INTEGER NOT NULL DEFAULT 0,
    "total_ignorados" INTEGER NOT NULL DEFAULT 0,
    "erro" TEXT,
    "iniciado_em" TIMESTAMP(3),
    "concluido_em" TIMESTAMP(3),
    "capture_session_id" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "numero_linha" INTEGER NOT NULL,
    "dados_originais" JSONB NOT NULL,
    "dados_normalizados" JSONB,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDENTE',
    "motivo_erro" TEXT,
    "dedupe_criterio" "DedupeCriterio",
    "lead_duplicado_id" TEXT,
    "lead_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "nome_original" TEXT,
    "telefone_original" TEXT,
    "endereco_original" TEXT,
    "website_original" TEXT,
    "nome_completo" TEXT,
    "primeiro_nome" TEXT,
    "empresa" TEXT,
    "nome_contato" TEXT,
    "categoria" TEXT,
    "telefone" TEXT,
    "telefone_normalizado" TEXT,
    "email" TEXT,
    "logradouro" TEXT,
    "numero" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "cep" TEXT,
    "website_url" TEXT,
    "website_status" "WebsiteStatus" NOT NULL DEFAULT 'NAO_VERIFICADO',
    "instagram_url" TEXT,
    "facebook_url" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NOVO',
    "temperatura" "Temperatura" NOT NULL DEFAULT 'FRIO',
    "campaign_id" TEXT,
    "opt_out" BOOLEAN NOT NULL DEFAULT false,
    "opt_out_em" TIMESTAMP(3),
    "origem" TEXT,
    "capture_session_id" TEXT,
    "import_id" TEXT,
    "capturado_em" TIMESTAMP(3),
    "ultima_interacao_em" TIMESTAMP(3),
    "ultima_mensagem_em" TIMESTAMP(3),
    "observacoes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "website_checks" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "url_verificada" TEXT,
    "status" "WebsiteStatus" NOT NULL,
    "dominio" TEXT,
    "dominio_social" TEXT,
    "detalhe" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "website_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_events" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "tipo" "LeadEventType" NOT NULL,
    "descricao" TEXT NOT NULL,
    "dados" JSONB,
    "origem" TEXT NOT NULL DEFAULT 'sistema',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "nicho" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'RASCUNHO',
    "delay_min_segundos" INTEGER NOT NULL DEFAULT 180,
    "delay_max_segundos" INTEGER NOT NULL DEFAULT 240,
    "delay_entre_leads_min_segundos" INTEGER NOT NULL DEFAULT 60,
    "delay_entre_leads_max_segundos" INTEGER NOT NULL DEFAULT 180,
    "limite_diario_envios" INTEGER NOT NULL DEFAULT 50,
    "iniciada_em" TIMESTAMP(3),
    "pausada_em" TIMESTAMP(3),
    "concluida_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_steps" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "nome" TEXT,
    "texto" TEXT NOT NULL,
    "enviar_automaticamente" BOOLEAN NOT NULL DEFAULT true,
    "aguardar_resposta" BOOLEAN NOT NULL DEFAULT true,
    "delay_min_segundos" INTEGER,
    "delay_max_segundos" INTEGER,
    "acao_padrao_desconhecido" "StepAction" NOT NULL DEFAULT 'AGUARDAR_INTERVENCAO',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_step_rules" (
    "id" TEXT NOT NULL,
    "campaign_step_id" TEXT NOT NULL,
    "categoria" "RespostaCategoria" NOT NULL,
    "acao" "StepAction" NOT NULL DEFAULT 'NENHUMA',
    "proxima_etapa_id" TEXT,
    "nova_temperatura" "Temperatura",
    "novo_status" "LeadStatus",
    "criar_tarefa" BOOLEAN NOT NULL DEFAULT false,
    "tarefa_tipo" "TaskType",
    "tarefa_titulo" TEXT,
    "tarefa_descricao" TEXT,
    "tarefa_prioridade" "TaskPriority",
    "notificar" BOOLEAN NOT NULL DEFAULT false,
    "notificacao_tipo" "NotificationType",
    "notificacao_titulo" TEXT,
    "notificacao_mensagem" TEXT,
    "notificacao_nivel" "NotificationLevel",
    "registrar_opt_out" BOOLEAN NOT NULL DEFAULT false,
    "snooze_unidade" "SnoozeUnidade",
    "snooze_valor" INTEGER,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_step_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_campaigns" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "status" "LeadCampaignStatus" NOT NULL DEFAULT 'PENDENTE',
    "etapa_atual_id" TEXT,
    "etapa_atual_ordem" INTEGER,
    "proximo_envio_em" TIMESTAMP(3),
    "snooze_ate" TIMESTAMP(3),
    "aguardando_liberacao" BOOLEAN NOT NULL DEFAULT false,
    "total_enviadas" INTEGER NOT NULL DEFAULT 0,
    "total_recebidas" INTEGER NOT NULL DEFAULT 0,
    "iniciado_em" TIMESTAMP(3),
    "concluido_em" TIMESTAMP(3),
    "motivo_parada" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "chat_id" TEXT,
    "nao_lidas" INTEGER NOT NULL DEFAULT 0,
    "ultima_mensagem_em" TIMESTAMP(3),
    "ultima_mensagem_texto" TEXT,
    "arquivada" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "campaign_step_id" TEXT,
    "direcao" "MessageDirection" NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDENTE',
    "texto" TEXT NOT NULL,
    "texto_original" TEXT,
    "variaveis_usadas" JSONB,
    "idempotency_key" TEXT,
    "whatsapp_message_id" TEXT,
    "simulada" BOOLEAN NOT NULL DEFAULT false,
    "categoria" "RespostaCategoria",
    "categorias_detectadas" JSONB,
    "termos_casados" JSONB,
    "texto_normalizado" TEXT,
    "erro" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "enviada_em" TIMESTAMP(3),
    "entregue_em" TIMESTAMP(3),
    "lida_em" TIMESTAMP(3),
    "recebida_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT,
    "user_id" TEXT,
    "tipo" "TaskType" NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "prioridade" "TaskPriority" NOT NULL DEFAULT 'MEDIA',
    "status" "TaskStatus" NOT NULL DEFAULT 'ABERTA',
    "prazo" TIMESTAMP(3),
    "concluida_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "lead_id" TEXT,
    "tipo" "NotificationType" NOT NULL,
    "nivel" "NotificationLevel" NOT NULL DEFAULT 'INFO',
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "link" TEXT,
    "lida" BOOLEAN NOT NULL DEFAULT false,
    "lida_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "fila" TEXT NOT NULL,
    "bull_job_id" TEXT,
    "idempotency_key" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDENTE',
    "payload" JSONB NOT NULL,
    "resultado" JSONB,
    "erro" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "max_tentativas" INTEGER NOT NULL DEFAULT 3,
    "agendado_para" TIMESTAMP(3),
    "iniciado_em" TIMESTAMP(3),
    "concluido_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "settings_chave_key" ON "settings"("chave");

-- CreateIndex
CREATE INDEX "settings_categoria_idx" ON "settings"("categoria");

-- CreateIndex
CREATE UNIQUE INDEX "social_domains_dominio_key" ON "social_domains"("dominio");

-- CreateIndex
CREATE INDEX "social_domains_ativo_idx" ON "social_domains"("ativo");

-- CreateIndex
CREATE INDEX "response_keywords_categoria_ativo_idx" ON "response_keywords"("categoria", "ativo");

-- CreateIndex
CREATE INDEX "response_keywords_campaign_step_id_idx" ON "response_keywords"("campaign_step_id");

-- CreateIndex
CREATE UNIQUE INDEX "response_keywords_categoria_termo_campaign_step_id_key" ON "response_keywords"("categoria", "termo", "campaign_step_id");

-- CreateIndex
CREATE INDEX "capture_sessions_nicho_cidade_idx" ON "capture_sessions"("nicho", "cidade");

-- CreateIndex
CREATE INDEX "imports_status_idx" ON "imports"("status");

-- CreateIndex
CREATE INDEX "imports_capture_session_id_idx" ON "imports"("capture_session_id");

-- CreateIndex
CREATE INDEX "import_rows_import_id_status_idx" ON "import_rows"("import_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_import_id_numero_linha_key" ON "import_rows"("import_id", "numero_linha");

-- CreateIndex
CREATE UNIQUE INDEX "leads_telefone_normalizado_key" ON "leads"("telefone_normalizado");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_temperatura_idx" ON "leads"("temperatura");

-- CreateIndex
CREATE INDEX "leads_website_status_idx" ON "leads"("website_status");

-- CreateIndex
CREATE INDEX "leads_cidade_idx" ON "leads"("cidade");

-- CreateIndex
CREATE INDEX "leads_bairro_idx" ON "leads"("bairro");

-- CreateIndex
CREATE INDEX "leads_categoria_idx" ON "leads"("categoria");

-- CreateIndex
CREATE INDEX "leads_campaign_id_idx" ON "leads"("campaign_id");

-- CreateIndex
CREATE INDEX "leads_opt_out_idx" ON "leads"("opt_out");

-- CreateIndex
CREATE INDEX "leads_ultima_interacao_em_idx" ON "leads"("ultima_interacao_em");

-- CreateIndex
CREATE INDEX "leads_nome_completo_cidade_idx" ON "leads"("nome_completo", "cidade");

-- CreateIndex
CREATE INDEX "website_checks_lead_id_idx" ON "website_checks"("lead_id");

-- CreateIndex
CREATE INDEX "lead_events_lead_id_created_at_idx" ON "lead_events"("lead_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_events_tipo_idx" ON "lead_events"("tipo");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaign_steps_campaign_id_idx" ON "campaign_steps"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_steps_campaign_id_ordem_key" ON "campaign_steps"("campaign_id", "ordem");

-- CreateIndex
CREATE INDEX "campaign_step_rules_campaign_step_id_idx" ON "campaign_step_rules"("campaign_step_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_step_rules_campaign_step_id_categoria_key" ON "campaign_step_rules"("campaign_step_id", "categoria");

-- CreateIndex
CREATE INDEX "lead_campaigns_status_idx" ON "lead_campaigns"("status");

-- CreateIndex
CREATE INDEX "lead_campaigns_proximo_envio_em_idx" ON "lead_campaigns"("proximo_envio_em");

-- CreateIndex
CREATE INDEX "lead_campaigns_snooze_ate_idx" ON "lead_campaigns"("snooze_ate");

-- CreateIndex
CREATE UNIQUE INDEX "lead_campaigns_lead_id_campaign_id_key" ON "lead_campaigns"("lead_id", "campaign_id");

-- CreateIndex
CREATE INDEX "conversations_lead_id_idx" ON "conversations"("lead_id");

-- CreateIndex
CREATE INDEX "conversations_ultima_mensagem_em_idx" ON "conversations"("ultima_mensagem_em");

-- CreateIndex
CREATE UNIQUE INDEX "messages_idempotency_key_key" ON "messages"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "messages_whatsapp_message_id_key" ON "messages"("whatsapp_message_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_lead_id_idx" ON "messages"("lead_id");

-- CreateIndex
CREATE INDEX "messages_status_idx" ON "messages"("status");

-- CreateIndex
CREATE INDEX "messages_direcao_idx" ON "messages"("direcao");

-- CreateIndex
CREATE INDEX "messages_enviada_em_idx" ON "messages"("enviada_em");

-- CreateIndex
CREATE INDEX "tasks_status_prioridade_idx" ON "tasks"("status", "prioridade");

-- CreateIndex
CREATE INDEX "tasks_lead_id_idx" ON "tasks"("lead_id");

-- CreateIndex
CREATE INDEX "tasks_prazo_idx" ON "tasks"("prazo");

-- CreateIndex
CREATE INDEX "notifications_lida_created_at_idx" ON "notifications"("lida", "created_at");

-- CreateIndex
CREATE INDEX "notifications_lead_id_idx" ON "notifications"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_idempotency_key_key" ON "jobs"("idempotency_key");

-- CreateIndex
CREATE INDEX "jobs_fila_status_idx" ON "jobs"("fila", "status");

-- CreateIndex
CREATE INDEX "jobs_agendado_para_idx" ON "jobs"("agendado_para");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_keywords" ADD CONSTRAINT "response_keywords_campaign_step_id_fkey" FOREIGN KEY ("campaign_step_id") REFERENCES "campaign_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capture_sessions" ADD CONSTRAINT "capture_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_capture_session_id_fkey" FOREIGN KEY ("capture_session_id") REFERENCES "capture_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_capture_session_id_fkey" FOREIGN KEY ("capture_session_id") REFERENCES "capture_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "imports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "website_checks" ADD CONSTRAINT "website_checks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_step_rules" ADD CONSTRAINT "campaign_step_rules_campaign_step_id_fkey" FOREIGN KEY ("campaign_step_id") REFERENCES "campaign_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_campaigns" ADD CONSTRAINT "lead_campaigns_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_campaigns" ADD CONSTRAINT "lead_campaigns_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_campaigns" ADD CONSTRAINT "lead_campaigns_etapa_atual_id_fkey" FOREIGN KEY ("etapa_atual_id") REFERENCES "campaign_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_campaign_step_id_fkey" FOREIGN KEY ("campaign_step_id") REFERENCES "campaign_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
