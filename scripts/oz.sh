#!/usr/bin/env bash
# Oz launcher — start/stop/status the Phase-2 dashboard daemon as a DETACHED background process
# (survives the terminal), so neither the founder nor an agent has to babysit a foreground command.
# It frees the port first (stopping any prior/stale daemon — including a stale v1 Oz on :7878), opens
# the dashboard, and logs to local/oz.log. Convenience tooling, not product surface.
#
#   scripts/oz.sh start | stop | status | restart      (env: COCODER_OZ_PORT, default 7878)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${COCODER_OZ_PORT:-7878}"
URL="http://127.0.0.1:${PORT}/"
LOG="${ROOT}/local/oz.log"
PIDFILE="${ROOT}/local/oz.pid"
DAEMON_BIN="${ROOT}/packages/daemon/bin/oz.mjs"

free_port() {
  if lsof -ti ":${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "stopping the process already on :${PORT}…"
    lsof -ti ":${PORT}" -sTCP:LISTEN | xargs kill 2>/dev/null || true
    sleep 1
  fi
}

start() {
  free_port
  cd "${ROOT}"
  mkdir -p "${ROOT}/local"
  # Run the daemon bin directly (it registers tsx), detached, cwd = repo root (= cocoderHome).
  nohup node "${DAEMON_BIN}" --port "${PORT}" >"${LOG}" 2>&1 &
  echo $! >"${PIDFILE}"
  # Wait briefly for it to answer /health.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS "${URL%/}/health" >/dev/null 2>&1; then
      echo "Oz running on ${URL} (pid $(cat "${PIDFILE}"), log: local/oz.log)"
      command -v open >/dev/null 2>&1 && open "${URL}" || true
      return 0
    fi
    sleep 0.5
  done
  echo "Oz did not come up — last log lines:" >&2
  tail -n 20 "${LOG}" >&2 || true
  exit 1
}

stop() {
  if [ -f "${PIDFILE}" ]; then kill "$(cat "${PIDFILE}")" 2>/dev/null || true; rm -f "${PIDFILE}"; fi
  lsof -ti ":${PORT}" -sTCP:LISTEN | xargs kill 2>/dev/null || true
  echo "Oz stopped."
}

status() {
  if curl -fsS "${URL%/}/health" >/dev/null 2>&1; then
    echo "Oz is up on ${URL}"
  else
    echo "Oz is down."
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  restart) stop; start ;;
  *) echo "usage: scripts/oz.sh {start|stop|status|restart}" >&2; exit 2 ;;
esac
