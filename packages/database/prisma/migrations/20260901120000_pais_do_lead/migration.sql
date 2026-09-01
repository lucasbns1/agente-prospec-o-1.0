-- O pais do lead.
--
-- Nasce com "Brasil" para todo mundo porque a base inteira e brasileira
-- hoje. O campo existe para o dia em que deixar de ser: sem ele, a ficha
-- do dia nao teria como separar "Brasil" de "Portugal" num relatorio so,
-- e cidade/estado nao servem para isso (as duas se repetem entre paises).
--
-- NULL continua permitido: um lead importado de uma planilha que nao
-- informa o pais fica sem, e a tela mostra "—" em vez de afirmar algo
-- que ninguem disse.
ALTER TABLE "leads" ADD COLUMN "pais" TEXT DEFAULT 'Brasil';

-- Os leads que ja existiam nasceram antes da coluna: o DEFAULT so vale
-- para linhas novas. Este UPDATE alcanca os antigos.
UPDATE "leads" SET "pais" = 'Brasil' WHERE "pais" IS NULL;
