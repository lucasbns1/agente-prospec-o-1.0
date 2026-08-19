-- =============================================================================
-- FASE 9 — ORQUESTRACAO POR IA
--
-- ADITIVA. Nenhuma coluna existente muda de tipo, nenhum enum e alterado,
-- nenhum dado e reescrito. Com GEMINI_ENABLED=false o sistema se comporta
-- exatamente como antes desta migration.
--
-- Reverter = dropar o que esta aqui.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Analise da IA por mensagem recebida
-- -----------------------------------------------------------------------------
ALTER TABLE "messages" ADD COLUMN "ai_intent"      TEXT;
ALTER TABLE "messages" ADD COLUMN "ai_confidence"  INTEGER;
ALTER TABLE "messages" ADD COLUMN "ai_motivo"      TEXT;
ALTER TABLE "messages" ADD COLUMN "ai_modelo"      TEXT;
ALTER TABLE "messages" ADD COLUMN "ai_latencia_ms" INTEGER;
ALTER TABLE "messages" ADD COLUMN "ai_status"      TEXT;
ALTER TABLE "messages" ADD COLUMN "ai_divergiu"    BOOLEAN;

-- -----------------------------------------------------------------------------
-- 2. Idempotencia de notificacao
--
-- O buraco que isto fecha: `criarNotificacao` era um `create()` seco, e o
-- mesmo acontecimento podia virar dois avisos no sino.
--
-- NULL permitido: avisos avulsos nao tem acontecimento que os identifique,
-- e no PostgreSQL varios NULL nao colidem numa UNIQUE.
-- -----------------------------------------------------------------------------
ALTER TABLE "notifications" ADD COLUMN "chave_idempotencia" TEXT;
CREATE UNIQUE INDEX "notifications_chave_idempotencia_key"
  ON "notifications"("chave_idempotencia");

-- -----------------------------------------------------------------------------
-- 3. O que a tela precisa mostrar: a PROXIMA acao, nao so a atual
-- -----------------------------------------------------------------------------
ALTER TABLE "lead_campaigns" ADD COLUMN "proxima_acao"        TEXT;
ALTER TABLE "lead_campaigns" ADD COLUMN "proxima_acao_em"     TIMESTAMP(3);
ALTER TABLE "lead_campaigns" ADD COLUMN "proxima_acao_motivo" TEXT;
ALTER TABLE "lead_campaigns" ADD COLUMN "estado_ia"           TEXT;

-- -----------------------------------------------------------------------------
-- 4. Trilha de decisoes — a base do relatorio do modo sombra
-- -----------------------------------------------------------------------------
CREATE TABLE "ai_decisions" (
  "id"              TEXT NOT NULL,
  "lead_id"         TEXT NOT NULL,
  "campaign_id"     TEXT,
  "etapa_ordem"     INTEGER,
  "gatilho"         TEXT NOT NULL,
  "acao_ia"         TEXT,
  "intent_ia"       TEXT,
  "confianca"       INTEGER,
  "motivo"          TEXT,
  "acao_motor"      TEXT,
  "divergiu"        BOOLEAN NOT NULL DEFAULT false,
  "acao_executada"  TEXT,
  "motivo_rejeicao" TEXT,
  "fallback"        BOOLEAN NOT NULL DEFAULT false,
  "erro"            TEXT,
  "modelo"          TEXT,
  "latencia_ms"     INTEGER,
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_decisions_lead_id_created_at_idx" ON "ai_decisions"("lead_id", "created_at");
-- `WHERE divergiu` e o relatorio inteiro do modo sombra; merece indice.
CREATE INDEX "ai_decisions_divergiu_idx"           ON "ai_decisions"("divergiu");
CREATE INDEX "ai_decisions_created_at_idx"         ON "ai_decisions"("created_at");

ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_campaign_id_fkey"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
