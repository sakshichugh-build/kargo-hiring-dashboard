# Kargo Hiring Dashboard

Ranks 60 CVs for two open roles (Product Manager, Senior Product Manager) against the
pattern in Arjun's **best past hires** — not the job spec alone. For each candidate it
gives a score with quoted evidence, why they rank where they do, what to probe in the
interview, and a drafted follow-up email. **The founder decides; the system does
everything else. Nothing is sent without a click.**

Built as an all-TypeScript Next.js app so it deploys to Vercel from GitHub. The heavy
Claude work (extraction → scoring → briefs/emails) runs **offline, once**, as a local
pipeline that writes `src/data/results.json`; the deployed dashboard reads that file and
handles the live actions (decide, edit, send, log).

---

## Architecture

```
Pipeline (offline, local, needs ANTHROPIC_API_KEY)        Dashboard (Vercel)
────────────────────────────────────────────────         ──────────────────────────
scripts/run-all.ts                                         src/app/page.tsx
  1. extract  (Claude call #1: CV → {pii, profile})          reads src/data/results.json
  2. score    (Claude call #2: profile-only → rubric)        two tabs, ranked cards
  3. brief    (Claude call #3: probes + draft emails)        decide / override / edit
  4. backtest (8 hires, criteria 1–4)                        send via Resend (on click)
  →  src/data/results.json                                   decisions + emails → SQLite
```

Three Claude calls (see `src/lib/pipeline/`):

1. **Extract** — CV → structured JSON. **PII** (name, email, phone, location, photo,
   gender cues, age, schools) goes in a separate `pii` object; everything score-relevant
   goes in `profile`. Clean CVs use extracted text; CVs whose text is unreliable are sent
   to Claude as a **PDF document** (see *Data problems* below).
2. **Score** — sends **only `profile`** (never `pii`) + both JDs + the rubric. Returns a
   0–3 score per criterion, each with a quoted evidence line, plus confidence and red flags.
   Weighted 0–100 totals are computed in code, not trusted to the model.
3. **Brief + email** — 3–5 probe questions tied to the candidate's **weakest** criteria,
   plus a draft invite and a draft rejection. Emits a `{{first_name}}` placeholder that the
   app fills, so even this call stays PII-free.

Every Claude call's exact payload is appended to `pipeline-output/claude-calls.jsonl`, and
`results.json.meta.audit` reports how many **scoring** payloads contained contact info
(must be 0) — a verifiable check of the hard rule.

## The rubric (`src/lib/rubric.ts`)

| # | Criterion | Weight |
|---|---|---|
| 1 | Ground-level operations exposure | 30% |
| 2 | Self-started build that others adopted | 20% |
| 3 | Ownership without structure | 15% |
| 4 | Ships, kills, learns | 15% |
| 5 | Role fit (PM 2–4 yrs / SPM 5–8 yrs + platform) | 20% |

Certifications, brand-name schools, speaking slots, buzzwords and long tool lists are
**not** rewarded. Red flags are surfaced, never auto-rejected.

**Backtest:** the 8 past hires are scored on criteria 1–4 only; every *Exceeds* hire must
rank above every *Meets/Below* hire. The result is in `results.json.meta.backtest`.

## Data problems handled

- **Unreliable PDF extraction.** The brief describes pdfplumber returning doubled /
  interleaved characters for files `01_–30_`. This project extracts with **pdfjs**, which
  returns clean characters but exposes a different defect in those same files: **scrambled
  reading order** (the contact block is displaced deep into the text — measured at char
  offset 1,500–5,800 vs 11–38 for the clean files). `src/lib/garble.ts` detects **both**
  defects from content (never the filename) and routes any flagged file to PDF-to-Claude.
  Result: the 30 `pm_/spm_` files use text, the 30 `01_–30_` files use PDF-to-Claude.
- **Mixed layouts / name last** — handled by Claude reconstructing from text or PDF.
- **Unlabelled `01_–30_`** — scored against both rubrics; recommended role shown; Arjun can
  override in the UI (moves the candidate between tabs).
- **Shared test inboxes** (`squad_N@pg27.mesaschool.co`) — preserved as-is; the audit log
  records both the intended recipient and where a test email actually went.

## Hard rules enforced

- **No email is sent without an explicit click.** No auto-send, no scheduled send, no
  auto-reject. "Send all pending rejections" has a confirmation step (and a server-side
  guard).
- **PII never reaches the scoring prompt** (logged and counted for verification).
- **All 60 candidates stay visible** — Pass dims a card, never hides it.

---

## Setup

```bash
npm install
cp .env.example .env.local   # fill in keys when ready (works without them too)
```

## Run the pipeline (produces `src/data/results.json`)

```bash
# Mock mode (no key needed) — deterministic stubs, fully viewable app:
PIPELINE_MOCK=1 npm run pipeline:build

# Live mode — set ANTHROPIC_API_KEY in .env.local, then:
npm run pipeline:build
```

Individual phases (each prints a review table):

```bash
npm run pipeline:extract    # Phase 1 — extraction method per file
npm run pipeline:backtest   # Phase 2 — 8-hire backtest ranking
npm run pipeline:score      # Phase 3 — top/bottom 5 per role
```

Claude results are cached by file hash under `.cache/`, so re-runs are cheap; a prompt
change (its version tag) busts the cache.

## Run the dashboard

```bash
npm run dev     # http://localhost:3000
```

## Deploy to Vercel

1. Push to GitHub, import the repo in Vercel.
2. Set env vars in Vercel (at least `ANTHROPIC_API_KEY` to regenerate data; `RESEND_*`,
   `EMAIL_MODE`, `TEST_RECIPIENT` for live email).
3. **Pick a hosted store for decisions + the audit log.** Local SQLite does not persist on
   serverless. Implement the `StorageAdapter` interface in `src/lib/server/storage.ts`
   against Neon Postgres or Vercel KV and swap it in `getStorage()`. Nothing else changes.
4. `src/data/results.json` is committed and bundled, so the dashboard renders immediately;
   regenerate it by running the pipeline locally and committing the new file.

## Project layout

```
src/lib/            types, rubric, garble detection, pdf/docx text, claude client, cache
src/lib/pipeline/   extract · score · briefEmail · jds · mockScore
src/lib/server/     storage (SQLite adapter) · email (Resend)
src/app/            page.tsx + api/{state,decision,role,send,send-all-rejections}
src/components/     Dashboard · CandidateCard · ActivityLog
scripts/            run-extract · run-backtest · run-score · run-all
data/               applications/ (60) · hires/ (8 + outcomes.json) · jds/ (2)
```
