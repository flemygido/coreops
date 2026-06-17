#!/bin/bash
# CoreOps launcher — double-click in Finder to start everything.
# Opens the owner dashboard in your browser automatically.

# Always run from the project root regardless of where the shell starts
cd "$(dirname "$0")"

# ── Colours ──────────────────────────────────────────────────────────────────
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

log()  { echo -e "  $1"; }
ok()   { echo -e "  ${GREEN}✓${RESET} $1"; }
warn() { echo -e "  ${YELLOW}⚠${RESET}  $1"; }
fail() { echo -e "  ${RED}✗${RESET} $1"; }
step() { echo -e "\n${BOLD}▶ $1${RESET}"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════╗${RESET}"
echo -e "${BOLD}║        CoreOps Launcher          ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════╝${RESET}"

# ── 1. Validate .env ─────────────────────────────────────────────────────────
step "Checking environment"

if [ ! -f ".env" ]; then
  fail ".env not found — copy .env.example and fill in ENCRYPTION_KEY"
  echo "      cp .env.example .env"
  read -r -p "  Press Enter to exit…"; exit 1
fi

ENCRYPTION_KEY=$(grep -E '^ENCRYPTION_KEY=' .env | cut -d= -f2-)
if [ -z "$ENCRYPTION_KEY" ]; then
  fail "ENCRYPTION_KEY is not set in .env"
  echo "      Generate one with:  openssl rand -hex 32"
  echo "      Then add it to .env: ENCRYPTION_KEY=<value>"
  read -r -p "  Press Enter to exit…"; exit 1
fi
ok ".env looks good"

# ── 2. Supabase ───────────────────────────────────────────────────────────────
step "Supabase"

if npx supabase status 2>/dev/null | grep -q "API URL"; then
  ok "Already running"
else
  log "Starting local Supabase (first run takes ~30 s)…"
  npx supabase start 2>&1 | grep -E "Started|API URL|Error" | sed 's/^/    /'
fi

# Parse connection details from supabase status
SUPA_JSON=$(npx supabase status --output json 2>/dev/null)

if command -v jq &>/dev/null; then
  SUPABASE_URL=$(echo "$SUPA_JSON" | jq -r '.API_URL')
  SUPABASE_ANON_KEY=$(echo "$SUPA_JSON" | jq -r '.ANON_KEY')
  SUPABASE_SERVICE_ROLE_KEY=$(echo "$SUPA_JSON" | jq -r '.SERVICE_ROLE_KEY')
else
  # Fallback: parse with python3 (always on macOS)
  SUPABASE_URL=$(echo "$SUPA_JSON" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['API_URL'])")
  SUPABASE_ANON_KEY=$(echo "$SUPA_JSON" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['ANON_KEY'])")
  SUPABASE_SERVICE_ROLE_KEY=$(echo "$SUPA_JSON" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['SERVICE_ROLE_KEY'])")
fi

ok "Connected at $SUPABASE_URL"

# Save live Supabase values before sourcing .env (which has empty placeholders)
_SUPA_URL="$SUPABASE_URL"
_SUPA_ANON="$SUPABASE_ANON_KEY"
_SUPA_SRK="$SUPABASE_SERVICE_ROLE_KEY"

# Load the rest of .env (ENCRYPTION_KEY, LLM keys, PORT, …)
set -a
# shellcheck disable=SC1091
source .env
set +a

# Restore live Supabase values — these win over the empty .env placeholders
export SUPABASE_URL="$_SUPA_URL"
export SUPABASE_ANON_KEY="$_SUPA_ANON"
export SUPABASE_SERVICE_ROLE_KEY="$_SUPA_SRK"

# ── 3. Build shared package (API uses tsx directly; only shared needs a dist/) ─
step "Building"

npm run build -w packages/shared >/dev/null 2>&1 && ok "packages/shared" || { fail "packages/shared build failed"; exit 1; }

# ── 4. Start services ─────────────────────────────────────────────────────────
step "Starting services"

# Kill any stale processes on our ports before starting fresh
lsof -ti :3000 -ti :3001 | xargs kill -9 2>/dev/null || true
sleep 1

# API — inherits the exported env vars above
npm run dev -w apps/api        > /tmp/coreops-api.log 2>&1 &
API_PID=$!

# Dashboard — reads its own .env.local
npm run dev -w apps/dashboard  > /tmp/coreops-dashboard.log 2>&1 &
DASH_PID=$!

log "API       → http://localhost:3000  (log: /tmp/coreops-api.log)"
log "Dashboard → http://localhost:3001  (log: /tmp/coreops-dashboard.log)"

# ── 5. Wait for dashboard ─────────────────────────────────────────────────────
step "Waiting for dashboard to be ready"

TIMEOUT=90; ELAPSED=0
while ! curl -s http://localhost:3001 >/dev/null 2>&1; do
  sleep 1; ELAPSED=$((ELAPSED + 1))
  # Show a dot every 5 s so the user knows we haven't frozen
  [ $((ELAPSED % 5)) -eq 0 ] && printf "    …%ds\n" "$ELAPSED"
  if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
    fail "Timed out after ${TIMEOUT}s"
    fail "Check the log:  cat /tmp/coreops-dashboard.log"
    exit 1
  fi
done

ok "Ready in ${ELAPSED}s"

# ── 6. Open browser ───────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  Opening http://localhost:3001${RESET}"
open http://localhost:3001

echo ""
echo "  Press ${BOLD}Ctrl+C${RESET} to stop all services."
echo ""

# ── 7. Cleanup on exit ────────────────────────────────────────────────────────
cleanup() {
  echo ""
  step "Shutting down"
  kill "$API_PID" "$DASH_PID" 2>/dev/null
  ok "Done"
  exit 0
}
trap cleanup INT TERM

wait "$API_PID" "$DASH_PID"
