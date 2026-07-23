#!/bin/sh
set -eu

node server.js &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}

trap cleanup INT TERM

PORT_VALUE="${PORT:-3000}"

until wget -q -O /dev/null "http://127.0.0.1:${PORT_VALUE}/"; do
  sleep 0.2
done

for path in / /students /classes /fees /staff /settings /login; do
  wget -q -O /dev/null "http://127.0.0.1:${PORT_VALUE}${path}" || true
done

wait "$SERVER_PID"
