-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "confianca" INTEGER,
ADD COLUMN     "subtipo" TEXT;

-- CreateTable
CREATE TABLE "unknown_contacts" (
    "id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "nome_contato" TEXT,
    "chat_id" TEXT,
    "texto" TEXT NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "canal" TEXT NOT NULL DEFAULT 'whatsapp',
    "leads_candidatos" JSONB,
    "motivo" TEXT NOT NULL,
    "resolvido" BOOLEAN NOT NULL DEFAULT false,
    "resolvido_lead_id" TEXT,
    "resolvido_em" TIMESTAMP(3),
    "recebida_em" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unknown_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unknown_contacts_provider_message_id_key" ON "unknown_contacts"("provider_message_id");

-- CreateIndex
CREATE INDEX "unknown_contacts_resolvido_recebida_em_idx" ON "unknown_contacts"("resolvido", "recebida_em");

-- CreateIndex
CREATE INDEX "unknown_contacts_telefone_idx" ON "unknown_contacts"("telefone");
