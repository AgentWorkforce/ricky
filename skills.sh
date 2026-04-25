#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo "[ricky] Installing bootstrap skills..."
npx skills add https://github.com/vercel-labs/skills --skill find-skills --yes

echo "[ricky] Installing bootstrap prpm package..."
prpm install @prpm/self-improving

echo "[ricky] Bootstrap complete."
