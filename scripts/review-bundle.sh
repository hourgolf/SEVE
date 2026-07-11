#!/usr/bin/env bash
# review-bundle — concatenate the curated external-review file set into ONE portable
# markdown file (data/review/CODE-BUNDLE.md) for handing to an outside LLM reviewer.
# Companion to docs/external-review-2026-07-brief.md (which explains what/why/omissions).
# Curation rule: the money path + methodology in FULL; UI/plumbing/instruments described
# in the brief instead (ask-for-more beats context-stuffing).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT_DIR="data/review"; OUT="$OUT_DIR/CODE-BUNDLE.md"
mkdir -p "$OUT_DIR"

FILES=(
  CLAUDE.md
  docs/pre-registered-tests-2026-07.md
  docs/go-live-infra.md
  docs/concentration-allocator-spec.md
  docs/sentinel-context.md
  trading-desk-schema.sql
  02_market_data.sql
  worker/src/config.ts
  worker/src/routing.ts
  worker/src/decide.ts
  worker/src/execute.ts
  worker/src/store.ts
  worker/src/exitRules.ts
  worker/src/index.ts
  worker/src/runner-selftest.ts
  engine/pageAll.ts
  engine/cost.ts
  engine/specEvaluate.ts
  engine/registry.ts
  scripts/capture-forward.ts
  scripts/sentinel.ts
  data/sentinel-latest.md
)

{
  echo "# SEVE — code bundle for external review"
  echo
  echo "Generated: $(date -u +%Y-%m-%dT%H:%MZ) · commit: $(git rev-parse --short HEAD) ($(git log -1 --format=%s | head -c 80))"
  echo "Read docs/external-review-2026-07-brief.md (included in the handoff) BEFORE this file."
  echo
  echo "## Manifest"
  for f in "${FILES[@]}"; do
    [ -f "$f" ] && printf -- "- %s (%s lines)\n" "$f" "$(wc -l < "$f" | tr -d ' ')"
  done
  echo
  for f in "${FILES[@]}"; do
    [ -f "$f" ] || { echo "⚠ missing: $f" >&2; continue; }
    ext="${f##*.}"
    lang="ts"; case "$ext" in md) lang="markdown";; sql) lang="sql";; sh) lang="bash";; esac
    echo "──────────────────────────────────────────────────────────────────────"
    echo "## FILE: $f"
    echo "──────────────────────────────────────────────────────────────────────"
    echo '```'"$lang"
    cat "$f"
    echo '```'
    echo
  done
  echo "## forensics-dataset.jsonl — 3 sample rows (the per-trade analysis substrate)"
  echo '```json'
  head -3 data/forensics-dataset.jsonl 2>/dev/null || echo "(not present on this machine)"
  echo '```'
} > "$OUT"

BYTES=$(wc -c < "$OUT" | tr -d ' ')
echo "wrote $OUT — ${BYTES} bytes (~$((BYTES / 4)) tokens)"
