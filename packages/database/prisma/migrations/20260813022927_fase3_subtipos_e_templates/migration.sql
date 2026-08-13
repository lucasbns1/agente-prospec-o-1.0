-- AlterTable
ALTER TABLE "response_keywords" ADD COLUMN     "idioma" TEXT NOT NULL DEFAULT 'pt-BR',
ADD COLUMN     "observacao" TEXT,
ADD COLUMN     "subtipo" TEXT;

-- CreateTable
CREATE TABLE "response_templates" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "categoria" "RespostaCategoria" NOT NULL,
    "subtipo" TEXT,
    "campaign_step_id" TEXT,
    "nome" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "response_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "response_templates_template_id_key" ON "response_templates"("template_id");

-- CreateIndex
CREATE INDEX "response_templates_categoria_ativo_idx" ON "response_templates"("categoria", "ativo");

-- CreateIndex
CREATE INDEX "response_templates_campaign_step_id_idx" ON "response_templates"("campaign_step_id");

-- CreateIndex
CREATE INDEX "response_keywords_subtipo_idx" ON "response_keywords"("subtipo");

-- AddForeignKey
ALTER TABLE "response_templates" ADD CONSTRAINT "response_templates_campaign_step_id_fkey" FOREIGN KEY ("campaign_step_id") REFERENCES "campaign_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
