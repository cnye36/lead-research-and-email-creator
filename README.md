# Lead Research Script

Reads a CSV or XLSX lead list, researches each lead with Tavily web search, then generates a personalized cold email via OpenAI. Processes in batches with rate limiting and auto-resumes from a checkpoint if interrupted.

## Setup

```bash
npm install
cp .env.example .env
# fill in your keys and sender context in .env
```

## Usage

```bash
# With Tavily web search (recommended)
npm start -- --input leads.csv

# LLM only (no web search, faster + cheaper)
npm start -- --input leads.csv --no-search

# Custom output file
npm start -- --input leads.csv --output results.csv

# Resume an interrupted run (uses checkpoint.json by default)
npm start -- --input leads.csv
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `-i, --input <file>` | required | Input `.csv` or `.xlsx` |
| `-o, --output <file>` | `output.csv` | Output CSV path |
| `-c, --checkpoint <file>` | `checkpoint.json` | Checkpoint for resuming |
| `--no-search` | off | Skip Tavily, use LLM only |
| `-b, --batch-size <n>` | `10` | Leads per batch |
| `--reprocess` | off | Clear checkpoint entries for this input and run again |

## Output CSV

All original columns are preserved, plus:

| Column | Description |
|--------|-------------|
| `research_summary` | 2–3 sentence synthesis of company/contact insights |
| `mobile_phone` | Personal mobile only when explicitly found in research |
| `lead_score` | 0–100 fit score for your ICP |
| `lead_score_tier` | `hot`, `warm`, `neutral`, `cold`, or `disqualified` |
| `lead_score_rationale` | Short explanation tied to your scoring criteria and research |
| `email_1_subject` / `email_1_body` | First email in the sequence |
| `email_2_subject` / `email_2_body` | Follow-up |
| `email_3_subject` / `email_3_body` | Breakup email |
| `status` | `success` or `error` |
| `error` | Error message if failed |

### Lead scoring

Scoring uses `SENDER_*`, `PRODUCT_CONTEXT`, and **`LEAD_SCORING_CONTEXT`** (who you want and why you are reaching out). If `LEAD_SCORING_CONTEXT` is unset, built-in defaults target small businesses and solopreneurs for AI agents, automation, and consulting.

To score an existing export without re-researching or rewriting emails:

```bash
pnpm score-leads -- --input data/leads-researched.xlsx
```

Use `--reprocess` to re-score every row in the file. Checkpoint defaults to `checkpoint-score-leads.json`.

## Apollo CSV columns

The parser normalizes Apollo's default export headers automatically (`First Name`, `Company Domain`, `# Employees`, `LinkedIn Url`, etc.). Any extra columns are passed through to the output.

## Rate limits

- **Concurrency**: controlled by `CONCURRENCY` env var (default: 5 simultaneous leads)
- **Batch delay**: `BATCH_DELAY_MS` adds a pause between batches (default: 1000ms)
- **Retries**: exponential backoff up to `MAX_RETRIES` (default: 3) on 429/503 errors
