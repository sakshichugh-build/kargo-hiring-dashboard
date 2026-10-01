import { z } from "zod";

/**
 * Data model for the Kargo Hiring Dashboard.
 *
 * Hard rule (the Cut): PII lives ONLY in the `pii` object and is NEVER sent to
 * the scoring prompt. Everything score-relevant lives in `profile`.
 */

// ---------------------------------------------------------------------------
// Extraction (Claude call #1): CV -> { pii, profile }
// ---------------------------------------------------------------------------

export const RoleLabel = z.enum(["pm", "spm", "unlabelled"]);
export type RoleLabel = z.infer<typeof RoleLabel>;

export const ExtractionMethod = z.enum(["text", "pdf-to-claude", "docx"]);
export type ExtractionMethod = z.infer<typeof ExtractionMethod>;

/** Personal details — kept separate, never sent to scoring. */
export const PiiSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  hasPhoto: z.boolean().nullable(),
  genderCues: z.string().nullable(),
  ageOrDob: z.string().nullable(),
  schools: z.array(z.string()),
});
export type Pii = z.infer<typeof PiiSchema>;

export const ExperienceSchema = z.object({
  title: z.string(),
  company: z.string(),
  companyDescriptor: z.string().nullable(), // e.g. "Series A freight SaaS, 35 employees"
  durationText: z.string().nullable(), // e.g. "Mar 2022 – Present"
  startYear: z.number().int().nullable(),
  endYear: z.number().int().nullable(), // null if current
  isCurrent: z.boolean().nullable(),
  bullets: z.array(z.string()),
});
export type Experience = z.infer<typeof ExperienceSchema>;

/** Everything score-relevant. No name, email, phone, school, gender, age. */
export const ProfileSchema = z.object({
  headline: z.string().nullable(), // e.g. "Product Manager"
  summary: z.string().nullable(),
  totalYearsExperience: z.number().nullable(),
  totalPmYears: z.number().nullable(),
  domain: z.string(), // e.g. "logistics/freight", "e-commerce", "fintech"
  experience: z.array(ExperienceSchema),
  skillsMentioned: z.array(z.string()),
  certificationsMentioned: z.array(z.string()), // surfaced so we can NOT reward them
});
export type Profile = z.infer<typeof ProfileSchema>;

export const ExtractionSchema = z.object({
  pii: PiiSchema,
  profile: ProfileSchema,
});
export type Extraction = z.infer<typeof ExtractionSchema>;

// ---------------------------------------------------------------------------
// Scoring (Claude call #2): profile-only -> per-criterion scores
// ---------------------------------------------------------------------------

export const Confidence = z.enum(["high", "med", "low"]);
export type Confidence = z.infer<typeof Confidence>;

export const CriterionScoreSchema = z.object({
  score: z.number().int().min(0).max(3),
  evidence: z.string(), // a quoted line from the CV, or "no evidence"
  reasoning: z.string(),
});
export type CriterionScore = z.infer<typeof CriterionScoreSchema>;

/**
 * The model returns raw 0–3 per criterion. Criteria 1–4 are role-agnostic;
 * role fit (criterion 5) is scored separately for PM and SPM bands.
 * Weighted totals are computed in code — never trusted to the model's math.
 */
export const ScoreResponseSchema = z.object({
  operations_exposure: CriterionScoreSchema, // c1, weight 30
  self_started_build: CriterionScoreSchema, // c2, weight 20
  ownership_without_structure: CriterionScoreSchema, // c3, weight 15
  ships_kills_learns: CriterionScoreSchema, // c4, weight 15
  role_fit_pm: CriterionScoreSchema, // c5 for PM band, weight 20
  role_fit_spm: CriterionScoreSchema, // c5 for SPM band, weight 20
  confidence: Confidence,
  red_flags: z.array(z.string()),
  rationale: z.string(), // 2-line "why ranked here"
});
export type ScoreResponse = z.infer<typeof ScoreResponseSchema>;

/** Backtest scoring (criteria 1–4 only — hires joined into different roles). */
export const BacktestScoreSchema = z.object({
  operations_exposure: CriterionScoreSchema,
  self_started_build: CriterionScoreSchema,
  ownership_without_structure: CriterionScoreSchema,
  ships_kills_learns: CriterionScoreSchema,
  confidence: Confidence,
  rationale: z.string(),
});
export type BacktestScore = z.infer<typeof BacktestScoreSchema>;

// ---------------------------------------------------------------------------
// Brief + email (Claude call #3)
// ---------------------------------------------------------------------------

export const BriefEmailSchema = z.object({
  probe_questions: z.array(z.string()).min(3).max(5),
  invite_subject: z.string(),
  invite_body: z.string(),
  rejection_subject: z.string(),
  rejection_body: z.string(),
});
export type BriefEmail = z.infer<typeof BriefEmailSchema>;

// ---------------------------------------------------------------------------
// Computed / stored records
// ---------------------------------------------------------------------------

export interface ComputedScores {
  crit: {
    operations_exposure: CriterionScore;
    self_started_build: CriterionScore;
    ownership_without_structure: CriterionScore;
    ships_kills_learns: CriterionScore;
    role_fit_pm: CriterionScore;
    role_fit_spm: CriterionScore;
  };
  totalPm: number; // 0–100
  totalSpm: number; // 0–100
  recommendedRole: "pm" | "spm";
  confidence: Confidence;
  redFlags: string[];
  rationale: string;
}

/** One candidate as stored in results.json (drives the dashboard). */
export interface CandidateRecord {
  id: string; // source file stem, e.g. "pm_01_priya_krishnan"
  sourceFile: string;
  fileHash: string;
  roleLabel: RoleLabel; // from filename prefix
  extractionMethod: ExtractionMethod;
  extractionOk: boolean;
  extractionNotes?: string;
  pii: Pii;
  profile: Profile;
  scores?: ComputedScores;
  brief?: BriefEmail;
}

export interface HireRecord {
  id: string;
  sourceFile: string;
  name: string;
  role: string;
  joined: string;
  lastRating: "Exceeds" | "Meets" | "Below";
  profile: Profile;
  backtest?: {
    crit: BacktestScore;
    total: number; // 0–100, criteria 1–4 renormalised
  };
}
