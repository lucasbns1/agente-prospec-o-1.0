-- AlterTable
ALTER TABLE "campaign_steps" ADD COLUMN     "notificacao_texto" TEXT,
ADD COLUMN     "notificar_ao_chegar" BOOLEAN NOT NULL DEFAULT false;
