import path from "node:path";

// Project root = two levels up from src/lib.
export const ROOT = path.resolve(process.cwd());
export const DATA_DIR = path.join(ROOT, "data");
export const APPLICATIONS_DIR = path.join(DATA_DIR, "applications");
export const HIRES_DIR = path.join(DATA_DIR, "hires");
export const JDS_DIR = path.join(DATA_DIR, "jds");
export const OUTCOMES_JSON = path.join(HIRES_DIR, "outcomes.json");

export const JD_PM = path.join(JDS_DIR, "MESA_Kargo_JD_Product Manager.docx");
export const JD_SPM = path.join(JDS_DIR, "MESA_Kargo_JD_Senior Product Manager.docx");

// Pipeline outputs and cache.
export const OUT_DIR = path.join(ROOT, "pipeline-output");
export const EXTRACTED_DIR = path.join(OUT_DIR, "extracted");
export const CACHE_DIR = path.join(ROOT, ".cache");
export const CLAUDE_LOG = path.join(OUT_DIR, "claude-calls.jsonl");

// The dashboard reads this (bundled at build time).
export const RESULTS_JSON = path.join(ROOT, "src", "data", "results.json");
