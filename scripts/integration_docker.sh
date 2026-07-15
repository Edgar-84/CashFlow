#!/usr/bin/env bash
# Run the @integration test suite against a throwaway local Postgres.
#
# Workaround for environments where `alembic upgrade head` can't run locally
# (see plan Decision log, D18: macOS ARM / uv.lock greenlet marker gap).
# Applies docs/SCHEMA.sql directly via psql, bypassing Alembic. The
# container is always removed on exit, success or failure — nothing is left
# behind. Any extra args are passed through to pytest, e.g.:
#   bash scripts/integration_docker.sh -k test_category_repo
set -euo pipefail

CONTAINER=cashflow-test-pg
DB_NAME=cashflow_test
DB_USER=postgres
DB_PASSWORD=postgres
DB_PORT=5432
SCHEMA_FILE="$(dirname "$0")/../docs/SCHEMA.sql"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER="$DB_USER" \
  -e POSTGRES_PASSWORD="$DB_PASSWORD" \
  -e POSTGRES_DB="$DB_NAME" \
  -p "$DB_PORT:5432" \
  postgres:16 >/dev/null

echo "==> waiting for postgres"
for _ in $(seq 1 30); do
  docker exec "$CONTAINER" pg_isready -U "$DB_USER" >/dev/null 2>&1 && break
  sleep 1
done

echo "==> applying $SCHEMA_FILE"
docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" < "$SCHEMA_FILE" >/dev/null

echo "==> running integration tests"
DATABASE_URL="postgresql://$DB_USER:$DB_PASSWORD@localhost:$DB_PORT/$DB_NAME" \
  uv run pytest -q -m integration "$@"
