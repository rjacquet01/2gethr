# API-credit runs

Scripts that spend Anthropic API credits on pre-launch quality work. Reports go to `scripts/credit-runs/out/` (git-ignored).

## One-time setup (keeps the key out of the repo and out of chat)
1. Create an API key at platform.claude.com > Settings > API keys. Name it `togethr-credit-runs`.
2. Save it, alone on one line, in `C:\Users\<you>\.togethr-anthropic-key` (Notepad is fine).
   Or set `ANTHROPIC_API_KEY` in your terminal. Never commit it.
3. Optional spend guards: `BUDGET_TOKENS=20000000` (default stop), `MODEL=claude-opus-5-5` (default),
   `PRICE_IN_PER_MTOK` / `PRICE_OUT_PER_MTOK` to print an estimated dollar cost (check the pricing page).

## Runs (from the repo root)
| Run | Command |
| --- | --- |
| Security review of all API routes (+ verification pass) | `node scripts/credit-runs/security-review.mjs` (try `--limit 5` first) |
| Draft Playwright specs per feature area | `node scripts/credit-runs/gen-e2e.mjs` |
| Smart Import accuracy test (real prompt and model) | `npx tsx --tsconfig tsconfig.json scripts/credit-runs/import-eval.ts` |

Security review is resumable (per-file cache in `out/security/`). Always check the Console usage page for the real spend.
