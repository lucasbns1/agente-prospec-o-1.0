-- CreateEnum
CREATE TYPE "Qualificacao" AS ENUM ('NAO_AVALIADO', 'QUALIFICADO', 'NAO_QUALIFICADO', 'BLOQUEADO', 'REVISAR');

-- CreateEnum
CREATE TYPE "OutboundStatus" AS ENUM ('PENDENTE', 'AGENDADA', 'PROCESSANDO', 'SIMULADA', 'ENVIADA', 'BLOQUEADA', 'FALHOU', 'CANCELADA');

-- CreateEnum
CREATE TYPE "MotivoBloqueio" AS ENUM ('LEAD_OPT_OUT', 'LEAD_SEM_TELEFONE', 'TELEFONE_INVALIDO', 'LEAD_BLOQUEADO', 'LEAD_AGUARDANDO_INTERVENCAO', 'CAMPANHA_PAUSADA', 'ETAPA_DESATIVADA', 'TEMPLATE_INEXISTENTE', 'VARIAVEL_OBRIGATORIA_AUSENTE', 'MENSAGEM_VAZIA', 'MENSAGEM_MUITO_LONGA', 'JA_EXISTE_PENDENTE', 'LIMITE_DIARIO_ATINGIDO', 'LIMITE_HORARIO_ATINGIDO', 'FORA_DA_JANELA', 'LEAD_EM_SNOOZE');

-- AlterTable
ALTER TABLE "campaign_steps" ADD COLUMN     "ativo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "template_id" TEXT;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "dias_permitidos" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
ADD COLUMN     "dry_run" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "filtros" JSONB,
ADD COLUMN     "horario_fim" TEXT NOT NULL DEFAULT '20:00',
ADD COLUMN     "horario_inicio" TEXT NOT NULL DEFAULT '08:00',
ADD COLUMN     "limite_horario_envios" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "max_leads" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "motivo_qualificacao" TEXT,
ADD COLUMN     "qualificacao" "Qualificacao" NOT NULL DEFAULT 'NAO_AVALIADO',
ADD COLUMN     "qualificado_em" TIMESTAMP(3),
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "outbound_messages" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "campaign_step_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "OutboundStatus" NOT NULL DEFAULT 'PENDENTE',
    "motivo_bloqueio" "MotivoBloqueio",
    "detalhe_bloqueio" TEXT,
    "telefone_destino" TEXT,
    "texto_renderizado" TEXT,
    "texto_template" TEXT,
    "variaveis_usadas" JSONB,
    "scheduled_at" TIMESTAMP(3),
    "processed_at" TIMESTAMP(3),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "max_tentativas" INTEGER NOT NULL DEFAULT 3,
    "erro" TEXT,
    "dry_run" BOOLEAN NOT NULL DEFAULT true,
    "message_id" TEXT,
    "bull_job_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbound_messages_idempotency_key_key" ON "outbound_messages"("idempotency_key");

-- CreateIndex
CREATE INDEX "outbound_messages_campaign_id_status_idx" ON "outbound_messages"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "outbound_messages_status_scheduled_at_idx" ON "outbound_messages"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "outbound_messages_lead_id_idx" ON "outbound_messages"("lead_id");

-- CreateIndex
CREATE INDEX "outbound_messages_scheduled_at_idx" ON "outbound_messages"("scheduled_at");

-- CreateIndex
CREATE INDEX "leads_qualificacao_idx" ON "leads"("qualificacao");

-- CreateIndex
CREATE INDEX "leads_tags_idx" ON "leads"("tags");

-- AddForeignKey
ALTER TABLE "campaign_steps" ADD CONSTRAINT "campaign_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "response_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_campaign_step_id_fkey" FOREIGN KEY ("campaign_step_id") REFERENCES "campaign_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
