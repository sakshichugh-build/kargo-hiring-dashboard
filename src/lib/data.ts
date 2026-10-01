import results from "@/data/results.json";
import type { CandidateRecord, HireRecord } from "./types";
export { defaultRole, firstNameOf, fillName } from "./view";

export interface ResultsFile {
  meta: {
    generatedAt: string;
    mock: boolean;
    model: string;
    counts: { candidates: number; hires: number };
    backtest: { pass: boolean; lowestExceeds: number; highestLower: number };
    audit: { totalCalls: number; scoringPayloadsWithPii: number };
  };
  candidates: CandidateRecord[];
  hires: HireRecord[];
}

const data = results as unknown as ResultsFile;

export function getResults(): ResultsFile {
  return data;
}

export function getCandidate(id: string): CandidateRecord | undefined {
  return data.candidates.find((c) => c.id === id);
}
