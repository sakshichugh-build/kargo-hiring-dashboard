import path from "node:path";
import { callClaudeJson } from "../claude";
import { cacheGet, cacheSet } from "../cache";
import { fileHash } from "../hash";
import { assessExtraction } from "../garble";
import { extractPdfText, extractDocxText, pdfBase64, pdfPageCount } from "../extractText";
import { ExtractionSchema, type Extraction, type RoleLabel, type ExtractionMethod } from "../types";

const PROMPT_VERSION = "extract-v1";

export const EXTRACT_SYSTEM = `You extract structured data from a CV for a hiring pipeline.

Split everything into two objects:

1. "pii" — PERSONAL details only (these are kept separate and never used for scoring):
   name, email, phone, location, hasPhoto (true/false if the CV appears to contain a photo), genderCues (any gendered pronoun/title/marker stated, else null), ageOrDob (if stated, else null), schools (list of school/college/university names).

2. "profile" — everything SCORE-RELEVANT, with NO personal identifiers:
   headline, summary, totalYearsExperience (number, your best estimate), totalPmYears (years specifically in product-management roles; 0 if none), domain (short phrase, e.g. "logistics/freight", "e-commerce", "fintech", "edtech", "B2B SaaS"), experience (array of {title, company, companyDescriptor, durationText, startYear, endYear, isCurrent, bullets[]}), skillsMentioned, certificationsMentioned.

Rules:
- Use only what the CV states. If a field is unknown, use null (or [] for lists). Do not invent.
- Keep bullet points verbatim where possible — a later scoring step needs to quote them.
- The CV text may be extracted out of reading order or have layout artifacts; reconstruct the person's actual history as best you can.
- Do NOT put any name, email, phone, school, gender, or age into "profile".

Respond with ONLY a JSON object: {"pii": {...}, "profile": {...}}. No prose, no markdown fences.`;

/** Lightweight heuristic extraction for MOCK_MODE so the table is meaningful. */
function mockExtraction(rawText: string, fallbackName: string): Extraction {
  const flat = rawText.replace(/\s+/g, " ");
  const email = /([\w.+-]+@[\w.-]+\.\w+)/.exec(flat)?.[1] ?? null;
  const phone = /(\+91[\s\d]{8,})/.exec(flat)?.[1]?.trim() ?? null;
  const pmYears = /(\d+)\s*\+?\s*years?[^.]{0,30}product/i.exec(flat)?.[1];
  const domain = /logistic|freight|supply chain|3pl|port|cha/i.test(flat)
    ? "logistics/freight"
    : /fintech|payment/i.test(flat)
      ? "fintech"
      : /e-?commerce|retail/i.test(flat)
        ? "e-commerce"
        : /edtech|assessment|learning/i.test(flat)
          ? "edtech"
          : "B2B SaaS (unclassified)";
  return {
    pii: {
      name: fallbackName,
      email,
      phone,
      location: null,
      hasPhoto: null,
      genderCues: null,
      ageOrDob: null,
      schools: [],
    },
    profile: {
      headline: null,
      summary: flat.slice(0, 200),
      totalYearsExperience: null,
      totalPmYears: pmYears ? Number(pmYears) : null,
      domain,
      experience: [],
      skillsMentioned: [],
      certificationsMentioned: [],
    },
  };
}

/** Prettify a file stem into a fallback display name for MOCK mode. */
function nameFromStem(stem: string): string {
  return stem
    .replace(/^(pm_|spm_|cv_)?\d+_/, "")
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export interface ExtractResult {
  extraction: Extraction;
  method: ExtractionMethod;
  pages: number;
  assessmentReasons: string[];
  textChars: number;
  text: string; // raw extracted text (used by the mock scorer; never sent to the live scoring call)
  cached: boolean;
}

/** Extract one application PDF: pdfjs text if trustworthy, else PDF-to-Claude. */
export async function extractApplication(
  filePath: string,
  roleLabel: RoleLabel,
): Promise<ExtractResult> {
  const stem = path.basename(filePath, ".pdf");
  const hash = fileHash(filePath);
  const text = await extractPdfText(filePath);
  const pages = await pdfPageCount(filePath);
  const assess = assessExtraction(text);
  const method: ExtractionMethod = assess.trustworthy ? "text" : "pdf-to-claude";

  const cacheKey = `${PROMPT_VERSION}-${hash}-${method}`;
  const cached = cacheGet<Extraction>(cacheKey);
  if (cached) {
    return { extraction: cached, method, pages, assessmentReasons: assess.reasons, textChars: text.length, text, cached: true };
  }

  const extraction = await callClaudeJson<Extraction>({
    callType: method === "text" ? "extract-text" : "extract-pdf",
    subjectId: stem,
    system: EXTRACT_SYSTEM,
    user:
      method === "text"
        ? `CV text (role applied for: ${roleLabel}):\n\n${text}`
        : [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBase64(filePath) },
            },
            {
              type: "text",
              text: `The extracted text for this CV was unreliable (${assess.reasons.join("; ")}), so use the PDF directly. Role applied for: ${roleLabel}.`,
            },
          ],
    schema: ExtractionSchema,
    maxTokens: 8000,
    effort: "low",
    mock: () => mockExtraction(text, nameFromStem(stem)),
  });

  cacheSet(cacheKey, extraction);
  return { extraction, method, pages, assessmentReasons: assess.reasons, textChars: text.length, text, cached: false };
}

/** Extract one hire CV (.docx, always clean text). */
export async function extractHire(filePath: string): Promise<ExtractResult> {
  const stem = path.basename(filePath, ".docx");
  const hash = fileHash(filePath);
  const text = await extractDocxText(filePath);

  const cacheKey = `${PROMPT_VERSION}-${hash}-docx`;
  const cached = cacheGet<Extraction>(cacheKey);
  if (cached) {
    return { extraction: cached, method: "docx", pages: 1, assessmentReasons: [], textChars: text.length, text, cached: true };
  }

  const extraction = await callClaudeJson<Extraction>({
    callType: "extract-text",
    subjectId: stem,
    system: EXTRACT_SYSTEM,
    user: `CV text (past hire):\n\n${text}`,
    schema: ExtractionSchema,
    maxTokens: 8000,
    effort: "low",
    mock: () => mockExtraction(text, nameFromStem(stem)),
  });

  cacheSet(cacheKey, extraction);
  return { extraction, method: "docx", pages: 1, assessmentReasons: [], textChars: text.length, text, cached: false };
}
