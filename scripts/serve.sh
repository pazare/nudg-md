#!/usr/bin/env bash
# NUDG MD demo server — one local origin so the demo tabs (and the buddy)
# share a BroadcastChannel. No dependencies beyond python3.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "NUDG MD synthetic demo"
echo "  Scribe (ambient notes): http://localhost:4800/scribe/"
echo "  LegacyChart EHR (fictional legacy): http://localhost:4800/ehr/"
echo "  Nudge-card gallery (design only):   http://localhost:4800/design/cards.html"
if [ -f server/relay.py ]; then
  python3 server/relay.py >/dev/null 2>&1 &
  echo "  AI relay: http://127.0.0.1:4809 (Claude lane needs ANTHROPIC_API_KEY; codex lane auto-detects)"
fi
exec python3 -m http.server 4800 --bind 127.0.0.1
