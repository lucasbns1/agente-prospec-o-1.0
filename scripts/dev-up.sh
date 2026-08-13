#!/usr/bin/env bash
#
# Sobe o ambiente de desenvolvimento sem Docker.
#
# POR QUE ISSO EXISTE:
# O docker-compose.yml e o caminho normal (e o documentado no SETUP.md
# para Windows). Este script serve para ambientes onde o Docker nao esta
# disponivel — como o container efemero em que o desenvolvimento
# acontece, que perde Postgres e Redis toda vez que hiberna.
#
# Nao substitui `docker compose up -d`. Use aquele quando tiver Docker.
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGDATA=/var/lib/postgresql/16/main
PGLOG=/var/lib/postgresql/pg.log

echo "==> PostgreSQL"
if pg_isready -q 2>/dev/null; then
  echo "    ja esta no ar"
else
  su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -l $PGLOG \
    -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' start" >/dev/null
  # O pg_ctl volta antes de aceitar conexoes; esperar evita que a API
  # suba e morra no primeiro query.
  for _ in $(seq 1 30); do
    pg_isready -q 2>/dev/null && break
    sleep 1
  done
  pg_isready -q || { echo "    FALHOU — veja $PGLOG"; exit 1; }
  echo "    no ar"
fi

echo "==> Redis"
if redis-cli ping >/dev/null 2>&1; then
  echo "    ja esta no ar"
else
  # Sem persistencia de proposito: o banco e a fonte da verdade da fila,
  # o Redis e so transporte. Ver docs/FILA.md.
  redis-server --daemonize yes --save '' --appendonly no >/dev/null
  for _ in $(seq 1 15); do
    redis-cli ping >/dev/null 2>&1 && break
    sleep 1
  done
  redis-cli ping >/dev/null 2>&1 || { echo "    FALHOU"; exit 1; }
  echo "    no ar"
fi

echo "==> Migrations"
cd "$RAIZ"
pnpm db:migrate:deploy >/dev/null 2>&1 && echo "    aplicadas" || echo "    nada a aplicar"

echo
echo "Pronto. Agora: pnpm dev"
