# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---


## What this is

A CLI pipeline that reads a CSV/XLSX lead list (Apollo exports by default), researches each lead via web search, and uses OpenAI to score the lead and write a 3-email cold outbound sequence — writing results back into the same spreadsheet format. Three entry points share the same lead-parsing, batching, checkpointing, and output-writing infrastructure but differ in what they call the LLM for.

## Commands

```bash
pnpm install
cp .env.example .env   # fill in OPENAI_API_KEY, a search provider key, and SENDER_*/PRODUCT_CONTEXT

# Full pipeline: web search + research synthesis + lead scoring + 3-email sequence
pnpm start -- --input leads.csv
pnpm start -- --input leads.csv --no-search        # skip web search (LLM only, faster/cheaper)
pnpm start -- --input leads.csv --reprocess         # clear checkpoint entries for this file and rerun
pnpm start -- --input leads.csv --output out.csv -c custom-checkpoint.json -b 20

# Regenerate only the email copy from already-saved research (no new web search)
pnpm regenerate-emails -- --input leads-researched.xlsx
pnpm regenerate-emails -- --input leads.xlsx --reprocess

# Score-only: re-score existing rows against LEAD_SCORING_CONTEXT without re-researching/rewriting emails
pnpm score-leads -- --input leads-researched.xlsx
pnpm score-leads -- --input leads.xlsx --reprocess

pnpm exec tsc --noEmit   # typecheck (no test suite exists in this repo)
```

There are no unit tests and no lint config — `npx tsc --noEmit` is the only automated check. When validating prompt or pipeline changes, the fastest sanity check is running `regenerate-emails` against a small CSV slice carved from an already-researched file in `data/` (it reuses the saved `research_summary` column, so it costs an OpenAI call but no web search call).

## Architecture

**Pipeline shape (all three entry points follow this):** `leadParser.parseFile()` → normalize rows into `Lead[]` → `OutputWriter` loads `checkpoint.json` and filters out already-processed leads → a `processXBatches()` function runs the remaining leads through `pLimit(config.concurrency)` in chunks of `--batch-size`, pausing `BATCH_DELAY_MS` between chunks → `writer.writeFinal()` re-reads the *original* input file and writes appended columns back into it (XLSX path preserves original cell values/hyperlinks by loading the source workbook fresh, not by reusing parsed data).

**Entry points** (`src/main.ts`, `src/regenerateEmails.ts`, `src/scoreLeads.ts`) are thin Commander CLIs that wire `config` + parsed leads + an `OutputWriter` into a batch processor (`batchProcessor.ts`, `regenerateBatch.ts`, `scoreBatch.ts` respectively). Each batch processor calls a different function in `researcher.ts`/`leadScorer.ts`:
- `main.ts` → `researchAndGenerateEmail()` — full flow: web search (if enabled) → `buildSystemPrompt()`/`buildUserPrompt()` → one OpenAI call returning research summary + lead score + all 3 emails as JSON.
- `regenerateEmails.ts` → `generateEmailsFromResearch()` — reads `research_summary` (or falls back to legacy `company_research`/`contact_research` columns) already present in the input file's `_raw` data, skips web search and re-scoring, and only asks the LLM for `email_1..3` (`buildSystemPrompt({ regenerateEmailsOnly: true })`).
- `scoreLeads.ts` → `scoreLead()` (`leadScorer.ts`) — re-scores using `research_summary`, preserves whatever email copy is already in the row.

**Checkpointing/resume:** `OutputWriter` keys results by lowercased email, or `firstName_lastName_company` when email is missing (`leadKey()` in `outputWriter.ts`). Checkpoint JSON is rewritten to disk after *every* lead (not just every batch), so a kill mid-run loses at most the in-flight lead. Rows with `status: "error"` are NOT considered processed and are retried on the next invocation; only `status: "success"` rows are skipped. `--reprocess` clears checkpoint entries scoped to leads present in the current input file only — it does not wipe the whole checkpoint.

**Prompt construction (`src/prompts.ts`)** is the highest-leverage file for output quality — `buildSystemPrompt()` builds one shared instruction block (reply strategy, sequence structure, copy rules, calibration examples) used identically by both the full pipeline and the email-only regeneration path; the only branch is whether the JSON response includes `research_summary`/`lead_score` or just `email_1..3`. When iterating on email copy quality, this is the single file to edit — both `main.ts` and `regenerateEmails.ts` consume it, so a change here affects every code path without touching the CLIs.

**Multi-provider web search (`src/webSearch.ts`):** `runWebSearch()` dispatches to Tavily/Linkup/Exa based on `config.searchProvider`, normalizing each provider's response into the same `[title] content` text blob, capped at 3000 chars (`capContext`). Each lead does two searches (company + contact) when `--search` is enabled; results are passed into `buildUserPrompt()` as raw text, not structured data.

**Lead parsing (`src/leadParser.ts`):** `COLUMN_MAP` normalizes a long list of Apollo/generic header variants into the canonical `Lead` fields, but every original column is also preserved verbatim in `lead._raw` (and `lead._rowIndex` for XLSX row targeting) — `OutputWriter` reads/writes through `_raw` so arbitrary extra input columns survive a round trip untouched. When adding support for a new CSV header variant, extend `COLUMN_MAP`; don't add a new field unless the LLM prompts (`prompts.ts`) actually need it.

**Output columns** are fixed and ordered (`APPENDED_COLS` in `outputWriter.ts`): `research_summary`, `mobile_phone`, `lead_score`, `lead_score_tier`, `lead_score_rationale`, `email_1_subject/body`, `email_2_subject/body`, `email_3_subject/body`, `status`, `error`. Re-running against a file that already has these columns updates them in place by matching header names case-insensitively rather than duplicating columns.

**Sender/offer context** lives entirely in `.env` (`SENDER_NAME`, `SENDER_COMPANY`, `SENDER_ROLE`, `PRODUCT_CONTEXT`, `LEAD_SCORING_CONTEXT`) and flows through `config.ts` → every prompt builder. `leadScoringDefaults.ts` holds the fallback ICP criteria used when `LEAD_SCORING_CONTEXT` is unset — defaults target SMBs/solopreneurs (1-50 employees) for AI agents/automation.

## Module path convention

This is an ESM project (`"type": "module"` + `NodeNext` resolution) — internal imports must use explicit `.js` extensions even though the source files are `.ts` (e.g. `import { loadConfig } from "./config.js"`).
