import type { ComputedScores, ScoreResponse, BacktestScore } from "./types";

/**
 * The success pattern rubric (from the brief). Criteria 1–4 are role-agnostic;
 * criterion 5 (role fit) differs by role. Weights sum to 100.
 */
export const CRITERIA = [
  {
    key: "operations_exposure",
    n: 1,
    name: "Ground-level operations exposure",
    weight: 30,
    three: "Years doing the operational work itself (logistics, freight, supply chain, or another ops-heavy field) — not selling to it or consulting on it from a desk.",
  },
  {
    key: "self_started_build",
    n: 2,
    name: "Self-started build that others adopted",
    weight: 20,
    three: "Spotted a problem unprompted, built something, and people adopted it; adoption is explicitly stated (e.g. 'used by 12 people', 'became the team standard').",
  },
  {
    key: "ownership_without_structure",
    n: 3,
    name: "Ownership without structure",
    weight: 15,
    three: "Sole owner, no senior layer making the calls; early-stage, or 'built it from zero'.",
  },
  {
    key: "ships_kills_learns",
    n: 4,
    name: "Ships, kills, learns",
    weight: 15,
    three: "Shipped AND killed or reversed something based on evidence; post-mortems; short cycles.",
  },
  {
    key: "role_fit",
    n: 5,
    name: "Role fit",
    weight: 20,
    three: "PM: 2–4 yrs PM on a core workflow product. Senior PM: 5–8 yrs PM, owns an integration/platform/data layer, makes architectural product calls.",
  },
] as const;

export const WEIGHTS = {
  operations_exposure: 30,
  self_started_build: 20,
  ownership_without_structure: 15,
  ships_kills_learns: 15,
  role_fit: 20,
} as const;

/** 0–3 raw score -> fraction of the criterion's weight. */
function weighted(score: number, weight: number): number {
  return (score / 3) * weight;
}

/** Compute PM and SPM totals (0–100) from the model's raw per-criterion scores. */
export function computeScores(r: ScoreResponse): ComputedScores {
  const base =
    weighted(r.operations_exposure.score, WEIGHTS.operations_exposure) +
    weighted(r.self_started_build.score, WEIGHTS.self_started_build) +
    weighted(r.ownership_without_structure.score, WEIGHTS.ownership_without_structure) +
    weighted(r.ships_kills_learns.score, WEIGHTS.ships_kills_learns);

  const totalPm = round1(base + weighted(r.role_fit_pm.score, WEIGHTS.role_fit));
  const totalSpm = round1(base + weighted(r.role_fit_spm.score, WEIGHTS.role_fit));

  // Recommend the higher-scoring role (deterministic; not left to model math).
  // Tie-break toward PM (the more junior band) to avoid over-levelling.
  const recommendedRole = totalSpm > totalPm ? "spm" : "pm";

  return {
    crit: {
      operations_exposure: r.operations_exposure,
      self_started_build: r.self_started_build,
      ownership_without_structure: r.ownership_without_structure,
      ships_kills_learns: r.ships_kills_learns,
      role_fit_pm: r.role_fit_pm,
      role_fit_spm: r.role_fit_spm,
    },
    totalPm,
    totalSpm,
    recommendedRole,
    confidence: r.confidence,
    redFlags: r.red_flags,
    rationale: r.rationale,
  };
}

/**
 * Backtest total: criteria 1–4 only (the hires joined into different roles),
 * renormalised to 0–100 so it's comparable to the live 0–100 scores.
 */
export function computeBacktestTotal(b: BacktestScore): number {
  const raw =
    weighted(b.operations_exposure.score, WEIGHTS.operations_exposure) +
    weighted(b.self_started_build.score, WEIGHTS.self_started_build) +
    weighted(b.ownership_without_structure.score, WEIGHTS.ownership_without_structure) +
    weighted(b.ships_kills_learns.score, WEIGHTS.ships_kills_learns);
  const maxWeight =
    WEIGHTS.operations_exposure +
    WEIGHTS.self_started_build +
    WEIGHTS.ownership_without_structure +
    WEIGHTS.ships_kills_learns; // 80
  return round1((raw / maxWeight) * 100);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
