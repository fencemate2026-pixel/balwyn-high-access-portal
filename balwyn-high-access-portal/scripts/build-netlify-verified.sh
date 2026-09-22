#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${SKIP_BUILD:-0}" == "1" || "${ALLOW_DETACHED_SCAN:-0}" == "1" ]]; then
  echo "Build/scan bypasses are not allowed. To inspect existing output, run python3 scripts/verify-netlify.py directly." >&2
  exit 1
fi
python3 -c 'import tomllib' || { echo "The deploy gate requires Python 3.11 or later." >&2; exit 1; }
build_base="$(python3 "${script_dir}/verify-netlify.py" --print-base)"
cd "${build_base}"
NETLIFY=true NETLIFY_STATIC=true npx --no-install next build
python3 "${script_dir}/verify-netlify.py"
