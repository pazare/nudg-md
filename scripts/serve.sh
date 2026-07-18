#!/usr/bin/env bash
# NUDG MD demo server — one local origin so the demo tabs (and the buddy)
# share a BroadcastChannel. No dependencies beyond python3.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "NUDG MD synthetic demo"
echo "  Scribe (ambient notes): http://localhost:4800/scribe/"
echo "  MediCore EHR (legacy):  http://localhost:4800/ehr/"
exec python3 -m http.server 4800 --bind 127.0.0.1
