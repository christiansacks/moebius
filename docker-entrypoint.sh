#!/bin/sh
set -e
exec node server.js \
    --file    "${MOEBIUS_FILE:-/data/server.mob}" \
    --pass    "${MOEBIUS_PASS:-}" \
    --server_port "${MOEBIUS_PORT:-8000}" \
    --columns "${MOEBIUS_COLUMNS:-80}" \
    --rows    "${MOEBIUS_ROWS:-25}"
