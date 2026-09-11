#!/usr/bin/env bash
#
# build-netlify-verified.sh
#
# Netlify production build for the Balwyn High client portal, with a hard gate
# on the artefact that actually ships.
#
# WHY THIS EXISTS
#   scripts/build-verified.sh does NOT verify anything. It is a timeout wrapper
#   around `vinext build`, which produces the Cloudflare Worker in dist/. The
#   node tests inspect dist/. Netlify ships something else entirely: `next build`
#   with NETLIFY_STATIC=true, emitting static HTML into out/. Nothing had ever
#   inspected out/ — the artefact the school actually loads.
#
#   This runs the real Netlify build, then scans what it emitted and exits
#   non-zero so Netlify fails the deploy rather than publishing.
#
# EXIT CODES
#   0  build succeeded and all gates passed
#   1  the underlying next build failed
#   2  build succeeded but a gate failed - deploy is blocked
#
# NOTE ON PATTERNS
#   Every regex below is deliberately free of quote characters so this file
#   survives being pasted through a shell heredoc without mangling. The
#   codex-preview pattern uses .? to cover name="x", name='x' and name=x.
#
set -euo pipefail

OUT_DIR="${NETLIFY_OUT_DIR:-out}"
failures=0

fail() { printf 'GATE FAILED: %s\n' "$1" >&2; failures=$((failures + 1)); }
pass() { printf 'gate ok: %s\n' "$1"; }

# --- 1. Build ----------------------------------------------------------------
echo "==> Building Netlify static export"
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  NETLIFY=true NETLIFY_STATIC=true npx --no-install next build || {
    echo "next build failed" >&2
    exit 1
  }
fi

# --- 2. The build must have produced something -------------------------------
echo "==> Verifying emitted artefact in ${OUT_DIR}/"

if [[ ! -d "${OUT_DIR}" ]]; then
  echo "GATE FAILED: ${OUT_DIR}/ does not exist - the export produced nothing." >&2
  exit 2
fi

if [[ ! -s "${OUT_DIR}/index.html" ]]; then
  fail "${OUT_DIR}/index.html is missing or empty"
else
  index_bytes=$(wc -c < "${OUT_DIR}/index.html")
  if (( index_bytes < 1024 )); then
    fail "${OUT_DIR}/index.html is only ${index_bytes} bytes - almost certainly a failed render"
  else
    pass "index.html present (${index_bytes} bytes)"
  fi
fi

# --- 3. Forbidden markers in the shipped build -------------------------------
# Format: <label>|<grep -E pattern>. A match anywhere under out/ blocks deploy.
forbidden=(
  "development-preview metadata|name=.?codex-preview"
  "Supabase service_role key|service_role"
  "raw service-role env name|SUPABASE_SERVICE_ROLE"
  "hardcoded localhost URL|https?://(localhost|127[.]0[.]0[.]1)"
  "superseded facility name|Tom Frizza"
)

for entry in "${forbidden[@]}"; do
  label="${entry%%|*}"
  pattern="${entry#*|}"
  if hits=$(grep -rIlE "${pattern}" "${OUT_DIR}" 2>/dev/null); then
    fail "${label} found in the shipped build:"
    while IFS= read -r h; do printf '         %s\n' "$h" >&2; done <<< "${hits}"
  else
    pass "no ${label}"
  fi
done

# --- 4. Required markers - absence means a broken client build ---------------
required=(
  "confirmed facility name|Tony Frizza"
)

for entry in "${required[@]}"; do
  label="${entry%%|*}"
  pattern="${entry#*|}"
  if grep -rIqE "${pattern}" "${OUT_DIR}" 2>/dev/null; then
    pass "${label} present"
  else
    fail "${label} missing from the shipped build (expected /${pattern}/)"
  fi
done

# --- 5. Verdict ---------------------------------------------------------------
if (( failures > 0 )); then
  printf '\n%d gate(s) failed. Deploy blocked.\n' "${failures}" >&2
  exit 2
fi

printf '\nAll gates passed. Artefact in %s/ is cleared to publish.\n' "${OUT_DIR}"
