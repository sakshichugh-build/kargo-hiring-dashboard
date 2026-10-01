import { callClaudeJson } from "../claude";
import { cacheGet, cacheSet } from "../cache";
import { stringHash } from "../hash";
import { computeScores, computeBacktestTotal } from "../rubric";
import {
  ScoreResponseSchema,
  BacktestScoreSchema,
  type Profile,
  type ScoreResponse,
  type BacktestScore,
  type ComputedScores,
} from "../types";
import { loadJDs } from "./jds";
import { mockScore, mockBacktestScore } from "./mockScore";

const PROMPT_VERSION = "score-v1";

const RUBRIC_TEXT = `Score each criterion 0–3. Every score MUST cite a quoted line from the profile as evidence, or the exact string "no evidence".

Criterion 1 — Ground-level operations exposure (weight 30).
  3 = years doing the operational work itself (logistics, freight, supply chain, port/terminal, CHA/customs, 3PL/carrier, warehouse, or another ops-heavy field) — NOT selling to it, consulting on it, or building software for it from a desk.
  0 = no hands-on operations exposure.

Criterion 2 — Self-started build that others adopted (weight 20).
  3 = spotted a problem unprompted, built something, and OTHERS ADOPTED it, with adoption explicitly stated (e.g. "used by 12 people", "became the team standard", "adopted by 2 other teams").
  0 = no self-started build, or built but no stated adoption.

Criterion 3 — Ownership without structure (weight 15).
  3 = sole owner, no senior layer making the calls; early-stage, "first PM", or "built it from zero".
  0 = always had a senior layer above making the decisions.

Criterion 4 — Ships, kills, learns (weight 15).
  3 = shipped AND killed/reversed something based on evidence; post-mortems; short cycles.
  0 = no evidence of shipping, or never killed/reversed anything.

Criterion 5 — Role fit. Score TWICE, once for each band:
  role_fit_pm: 3 = 2–4 yrs PM on a core workflow product.
  role_fit_spm: 3 = 5–8 yrs PM, owns an integration/platform/data layer, makes architectural product calls.

DO NOT reward: certifications, brand-name schools/MBAs, conference/speaking slots, buzzwords ("AI-driven", "results-driven"), or long tool lists. These do not predict success here.

Surface (do NOT auto-reject) red flags: experience far outside the role's band, no product ownership at all, claims with no outcome.

confidence: "high" | "med" | "low" based on how much concrete evidence the profile contains.
rationale: a 2-line "why ranked here" summary.`;

export const SCORE_SYSTEM = `You score a candidate profile against Kargo's success pattern. You are given ONLY the candidate's professional profile (no name, no personal details) plus both job descriptions.

The success pattern (learned from past hires): the people who went on to EXCEED had hands-on time INSIDE freight/logistics operations and usually built a fix nobody asked for that colleagues then adopted. Candidates with strong credentials but no ground-level ops exposure under-performed. Credentials and polish do NOT predict success.

${RUBRIC_TEXT}

Respond with ONLY this JSON object (no prose, no fences):
{
  "operations_exposure": {"score": 0-3, "evidence": "<quoted line or 'no evidence'>", "reasoning": "<1 sentence>"},
  "self_started_build": {"score": 0-3, "evidence": "...", "reasoning": "..."},
  "ownership_without_structure": {"score": 0-3, "evidence": "...", "reasoning": "..."},
  "ships_kills_learns": {"score": 0-3, "evidence": "...", "reasoning": "..."},
  "role_fit_pm": {"score": 0-3, "evidence": "...", "reasoning": "..."},
  "role_fit_spm": {"score": 0-3, "evidence": "...", "reasoning": "..."},
  "confidence": "high|med|low",
  "red_flags": ["..."],
  "rationale": "<2 lines>"
}`;

export const BACKTEST_SYSTEM = `You score a past hire's profile against Kargo's success pattern, using ONLY criteria 1–4 (these hires joined into different roles, so role fit does not apply).

The success pattern: the people who EXCEED had hands-on time INSIDE freight/logistics operations and usually built a fix nobody asked for that colleagues then adopted. Strong credentials without ground-level ops exposure under-performed.

${RUBRIC_TEXT}

Respond with ONLY this JSON object (no prose, no fences):
{
  "operations_exposure": {"score": 0-3, "evidence": "...", "reasoning": "..."},
  "self_started_build": {"score": 0-3, "evidence": "...", "reasoning": "..."},
  "ownership_without_structure": {"score": 0-3, "evidence": "...", "reasoning": "..."},
  "ships_kills_learns": {"score": 0-3, "evidence": "...", "reasoning": "..."},
  "confidence": "high|med|low",
  "rationale": "<2 lines>"
}`;

function profilePayload(profile: Profile, jds: { pm: string; spm: string }): string {
  return `PROFILE (no personal details):\n${JSON.stringify(profile, null, 2)}\n\n=== JOB DESCRIPTION: PRODUCT MANAGER ===\n${jds.pm}\n\n=== JOB DESCRIPTION: SENIOR PRODUCT MANAGER ===\n${jds.spm}`;
}

/** Full scoring (Claude call #2). mockText (CV text) is used only in MOCK_MODE. */
export async function scoreCandidate(
  id: string,
  profileHash: string,
  profile: Profile,
  mockText: string,
): Promise<ComputedScores> {
  const jds = await loadJDs();
  const cacheKey = `${PROMPT_VERSION}-score-${profileHash}`;
  const cached = cacheGet<ComputedScores>(cacheKey);
  if (cached) return cached;

  const raw = await callClaudeJson<ScoreResponse>({
    callType: "score",
    subjectId: id,
    system: SCORE_SYSTEM,
    user: profilePayload(profile, jds),
    schema: ScoreResponseSchema,
    maxTokens: 6000,
    effort: "high",
    mock: () => mockScore(mockText),
  });

  const computed = computeScores(raw);
  cacheSet(cacheKey, computed);
  return computed;
}

/** Backtest scoring (criteria 1–4 only). */
export async function scoreBacktest(
  id: string,
  profileHash: string,
  profile: Profile,
  mockText: string,
): Promise<{ crit: BacktestScore; total: number }> {
  const cacheKey = `${PROMPT_VERSION}-backtest-${profileHash}`;
  const cached = cacheGet<{ crit: BacktestScore; total: number }>(cacheKey);
  if (cached) return cached;

  const crit = await callClaudeJson<BacktestScore>({
    callType: "backtest",
    subjectId: id,
    system: BACKTEST_SYSTEM,
    user: `PROFILE (past hire, no personal details):\n${JSON.stringify(profile, null, 2)}`,
    schema: BacktestScoreSchema,
    maxTokens: 4000,
    effort: "high",
    mock: () => mockBacktestScore(mockText),
  });

  const result = { crit, total: computeBacktestTotal(crit) };
  cacheSet(cacheKey, result);
  return result;
}

export function profileFingerprint(profile: Profile): string {
  return stringHash(JSON.stringify(profile));
}
