-- Remocao do modo simulacao global.
--
-- O `WHATSAPP_MODE` saiu do codigo. Ele travava o envio do sistema
-- inteiro por variavel de ambiente, sem aparecer em lugar nenhum da
-- interface — voce desmarcava a simulacao na campanha, reenfileirava, e
-- continuava sem sair nada.
--
-- Duas mudancas aqui, e as duas sao sobre nao deixar o banco contradizer
-- a tela:

-- 1. Campanha NOVA nasce enviando. Simular virou escolha explicita.
ALTER TABLE "campaigns" ALTER COLUMN "dry_run" SET DEFAULT false;

-- 2. As campanhas que JA existem saem da simulacao.
--
--    Sem isto, quem ja tinha campanha continuaria travado pelo valor
--    antigo e a remocao nao teria efeito nenhum na pratica — que e
--    exatamente a reclamacao que originou esta migration.
UPDATE "campaigns" SET "dry_run" = false WHERE "dry_run" = true;

-- 3. As mensagens que ainda NAO sairam perdem a marca herdada.
--
--    Restrito ao que nao foi processado de proposito: `SIMULADA`,
--    `ENVIADA` e `FALHOU` sao historico. Reescrever historico apagaria a
--    unica prova de que aquele envio foi simulado.
UPDATE "outbound_messages"
   SET "dry_run" = false
 WHERE "dry_run" = true
   AND "status" IN ('PENDENTE', 'AGENDADA', 'CANCELADA', 'BLOQUEADA');
