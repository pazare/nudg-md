#!/usr/bin/env bash
# NUDG MD demo server — one local origin so the demo tabs (and the buddy)
# share a BroadcastChannel. No dependencies beyond python3.
set -euo pipefail
cd "$(dirname "$0")/.."

relay_pid=""
relay_instance=""
relay_port="4809"
relay_log="${TMPDIR:-/tmp}/nudg-md-relay.log"
cleanup() {
  if [ -n "$relay_pid" ] && kill -0 "$relay_pid" 2>/dev/null; then
    kill "$relay_pid" 2>/dev/null || true
    wait "$relay_pid" 2>/dev/null || true
  fi
  relay_pid=""
}
trap cleanup EXIT INT TERM HUP

echo "NUDG MD synthetic demo"
echo "  Scribe (ambient notes): http://localhost:4800/scribe/"
echo "  LegacyChart EHR (fictional legacy): http://localhost:4800/ehr/"
echo "  Nudge-card gallery (design only):   http://localhost:4800/design/cards.html"
if [ -f server/relay.py ]; then
  if [ "${NUDG_RELAY_PORT:-4809}" != "4809" ]; then
    echo "  ERROR: the browser demo and launcher use relay port 4809; custom NUDG_RELAY_PORT values are test-only." >&2
    exit 1
  fi
  if ! python3 -c 'import socket, sys; s=socket.socket(); s.bind(("127.0.0.1", int(sys.argv[1]))); s.close()' "$relay_port" 2>/dev/null; then
    echo "  ERROR: relay port $relay_port is already in use; refusing to use a stale or unknown relay." >&2
    exit 1
  fi
  relay_instance="launcher-$$-$RANDOM-$RANDOM"
  NUDG_RELAY_INSTANCE_ID="$relay_instance" python3 server/relay.py >"$relay_log" 2>&1 &
  relay_pid=$!
  relay_ready="false"
  for _attempt in {1..25}; do
    if ! kill -0 "$relay_pid" 2>/dev/null; then
      break
    fi
    if python3 -c 'import json, sys, urllib.request; data=json.load(urllib.request.urlopen("http://127.0.0.1:%s/api/health" % sys.argv[1], timeout=.3)); raise SystemExit(0 if data.get("ok") is True and data.get("instance") == sys.argv[2] else 1)' "$relay_port" "$relay_instance" >/dev/null 2>&1; then
      relay_ready="true"
      break
    fi
    sleep 0.1
  done
  if [ "$relay_ready" = "true" ]; then
    echo "  AI relay: http://127.0.0.1:$relay_port (Claude lane needs ANTHROPIC_API_KEY; codex lane auto-detects)"
  else
    echo "  WARNING: AI relay did not become ready; scripted fallbacks remain available. Log: $relay_log" >&2
  fi
fi
python3 -m http.server 4800 --bind 127.0.0.1
