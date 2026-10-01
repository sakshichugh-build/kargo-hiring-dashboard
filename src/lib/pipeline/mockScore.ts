import type { ScoreResponse, BacktestScore, CriterionScore } from "../types";

/**
 * Keyword heuristic used ONLY in MOCK_MODE so the backtest and rankings are
 * demonstrable without an API key. The live path replaces this entirely with
 * Claude's judgment. It reads the CV text directly (the real scoring call never
 * does — it gets profile-only); this is local computation, not a sent payload.
 */

const OPS = [
  "freight", "logistics", "supply chain", "3pl", "carrier", "port", "terminal",
  "customs", "cha", "warehouse", "dock", "shipment", "forwarder", "clearing",
  "bill of lading", "jnpt", "import", "export", "fulfil",
];
const BUILD_VERB = ["built", "created", "designed", "wrote", "introduced", "set up"];
const ADOPTED = [
  "adopted", "used by", "became the", "team standard", "rolled out", "30 colleagues",
  "12 people", "other teams", "kept permanently", "company-wide", "now a core",
  "standard", "widely used",
];
const OWNERSHIP = [
  "sole", "only pm", "first pm", "from zero", "from scratch", "founding",
  "no pm", "early-stage", "no senior", "without a product layer", "independently",
  "owned", "solely responsible",
];
const SHIP = ["shipped", "launched", "delivered", "released"];
const KILL = ["killed", "sunset", "deprecated", "reversed", "rolled back", "post-mortem", "retrospective", "cut "];

function findLine(text: string, kws: string[]): string {
  const lines = text.split(/[\n.]/).map((l) => l.trim()).filter(Boolean);
  for (const l of lines) {
    const low = l.toLowerCase();
    if (kws.some((k) => low.includes(k))) return l.slice(0, 180);
  }
  return "no evidence";
}

function countHits(low: string, kws: string[]): number {
  return kws.filter((k) => low.includes(k)).length;
}

function crit(score: number, evidence: string, reasoning: string): CriterionScore {
  return { score: Math.max(0, Math.min(3, score)) as 0 | 1 | 2 | 3, evidence, reasoning };
}

interface FourCrit {
  operations_exposure: CriterionScore;
  self_started_build: CriterionScore;
  ownership_without_structure: CriterionScore;
  ships_kills_learns: CriterionScore;
}

function scoreFour(text: string): FourCrit {
  const low = text.toLowerCase();

  const opsHits = countHits(low, OPS);
  const ops = opsHits >= 5 ? 3 : opsHits >= 3 ? 2 : opsHits >= 1 ? 1 : 0;

  const builds = BUILD_VERB.some((v) => low.includes(v));
  const adopted = countHits(low, ADOPTED);
  const build = adopted >= 2 ? 3 : adopted === 1 ? 2 : builds ? 1 : 0;

  const own = countHits(low, OWNERSHIP);
  const ownership = own >= 3 ? 3 : own === 2 ? 2 : own === 1 ? 1 : 0;

  const ships = SHIP.some((v) => low.includes(v));
  const kills = KILL.some((v) => low.includes(v));
  const sk = ships && kills ? 3 : kills ? 2 : ships ? 1 : 0;

  return {
    operations_exposure: crit(ops, findLine(text, OPS), `${opsHits} ops signals in CV text`),
    self_started_build: crit(build, findLine(text, ADOPTED.concat(BUILD_VERB)), `${adopted} adoption signals`),
    ownership_without_structure: crit(ownership, findLine(text, OWNERSHIP), `${own} ownership signals`),
    ships_kills_learns: crit(sk, findLine(text, KILL.concat(SHIP)), ships && kills ? "ships and kills" : "partial"),
  };
}

function confidenceFrom(text: string): "high" | "med" | "low" {
  return text.length > 2500 ? "high" : text.length > 1200 ? "med" : "low";
}

export function mockBacktestScore(text: string): BacktestScore {
  const four = scoreFour(text);
  return { ...four, confidence: confidenceFrom(text), rationale: "Mock backtest score (keyword heuristic)." };
}

export function mockScore(text: string): ScoreResponse {
  const four = scoreFour(text);
  const low = text.toLowerCase();

  // crude PM-year detection for role fit
  const pmYears = Number(/(\d+)\s*\+?\s*years?[^.]{0,40}product/i.exec(text)?.[1] ?? 0);
  const archSignals = countHits(low, ["integration", "platform", "data layer", "api", "architecture", "carrier system"]);
  const roleFitPm = pmYears >= 2 && pmYears <= 4 ? 3 : pmYears >= 1 && pmYears <= 5 ? 2 : pmYears >= 1 ? 1 : 0;
  const roleFitSpm = pmYears >= 5 && pmYears <= 8 && archSignals >= 2 ? 3 : pmYears >= 5 ? 2 : pmYears >= 4 ? 1 : 0;

  const redFlags: string[] = [];
  if (four.operations_exposure.score === 0) redFlags.push("No ground-level operations exposure.");
  if (pmYears === 0) redFlags.push("No explicit product-management tenure detected.");

  return {
    ...four,
    role_fit_pm: crit(roleFitPm, pmYears ? `~${pmYears} yrs PM` : "no evidence", "PM band fit (mock)"),
    role_fit_spm: crit(roleFitSpm, pmYears ? `~${pmYears} yrs PM` : "no evidence", "SPM band fit (mock)"),
    confidence: confidenceFrom(text),
    red_flags: redFlags,
    rationale: "Mock score via keyword heuristic — replaced by Claude in live mode.",
  };
}
