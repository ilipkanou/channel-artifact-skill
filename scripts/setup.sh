#!/usr/bin/env bash
# Auto-setup for tool-channel-artifact: ensures Bun is available.
# Idempotent — exits early if Bun is already installed. No user interaction.
set -euo pipefail

if command -v bun >/dev/null 2>&1; then
  echo "✓ Bun already installed: $(bun --version)"
  exit 0
fi

echo "Bun not found — installing…"

if [[ "$(uname)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
  brew install oven-sh/bun/bun
elif command -v curl >/dev/null 2>&1; then
  # Official installer fallback (Linux / macOS without Homebrew)
  curl -fsSL https://bun.sh/install | bash
else
  echo "✗ Could not install Bun automatically." >&2
  echo "  Install it manually: https://bun.sh  (macOS: brew install oven-sh/bun/bun)" >&2
  exit 1
fi

if command -v bun >/dev/null 2>&1; then
  echo "✓ Bun installed: $(bun --version)"
else
  echo "✗ Bun install ran but 'bun' is still not on PATH." >&2
  echo "  Open a new shell or add Bun to your PATH, then re-run." >&2
  exit 1
fi
