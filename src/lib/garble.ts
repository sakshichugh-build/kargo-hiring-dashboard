/**
 * Decides whether a PDF's extracted text is trustworthy, or whether we should
 * send the PDF itself to Claude for extraction instead.
 *
 * The brief describes pdfplumber returning doubled / interleaved characters
 * ("RRoOhHaAnN M MehEtHaTA") for files 01_–30_. With pdfjs (used here) the
 * characters come out clean, but those same files have a DIFFERENT defect:
 * scrambled reading order — the name and contact block are displaced deep into
 * the text stream instead of sitting in the header. Measured across the 60 CVs,
 * the first phone/email appears at char offset 11–38 for the clean pm_/spm_
 * files and 1,500–5,800 for the 01_–30_ files, so a single offset threshold
 * separates them perfectly.
 *
 * We detect BOTH defects (whichever a given PDF library produces) and route any
 * flagged file to Claude PDF-document input.
 */

export interface ExtractionAssessment {
  // Primary signal: how deep into the text the contact block appears.
  firstContactOffset: number;
  // Secondary signals: pdfplumber-style doubling / run-together words.
  caseFlipRatio: number;
  longTokenRatio: number;
  doubledCharRatio: number;
  reasons: string[];
  trustworthy: boolean; // true -> use text; false -> send PDF to Claude
}

const CONTACT_OFFSET_THRESHOLD = 300; // clean header is within ~40 chars; scrambled is 1500+
const CASE_FLIP_THRESHOLD = 0.6;
const LONG_TOKEN_THRESHOLD = 0.08;
const DOUBLED_CHAR_THRESHOLD = 0.12;

export function assessExtraction(text: string): ExtractionAssessment {
  const flat = text.replace(/\s+/g, " ").trim();

  // 1. First-contact offset (scrambled reading order).
  const contact = /(\+91|squad_\d|@[\w.-]+\.\w)/.exec(flat);
  const firstContactOffset = contact ? contact.index : Number.MAX_SAFE_INTEGER;

  // 2–4. pdfplumber-style doubling / run-together words (header sample).
  const sample = text.slice(0, 6000);
  const words = sample.split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  const nWords = Math.max(words.length, 1);

  let caseFlips = 0;
  for (const w of words) {
    const letters = w.replace(/[^A-Za-z]/g, "");
    for (let i = 1; i < letters.length; i++) {
      const p = letters[i - 1];
      const c = letters[i];
      const pUp = p === p.toUpperCase() && p !== p.toLowerCase();
      const cUp = c === c.toUpperCase() && c !== c.toLowerCase();
      if (pUp !== cUp) caseFlips++;
    }
  }
  const caseFlipRatio = caseFlips / nWords;
  const longTokenRatio = words.filter((w) => w.length > 22).length / nWords;

  const letters = sample.replace(/[^A-Za-z]/g, "");
  let doubled = 0;
  for (let i = 1; i < letters.length; i++) {
    if (letters[i].toLowerCase() === letters[i - 1].toLowerCase()) doubled++;
  }
  const doubledCharRatio = letters.length ? doubled / letters.length : 0;

  const reasons: string[] = [];
  if (firstContactOffset > CONTACT_OFFSET_THRESHOLD) {
    reasons.push(
      `contact block displaced (first phone/email at char ${
        firstContactOffset === Number.MAX_SAFE_INTEGER ? "none" : firstContactOffset
      })`,
    );
  }
  if (caseFlipRatio > CASE_FLIP_THRESHOLD)
    reasons.push(`doubled/alternating-case chars (flip ratio ${caseFlipRatio.toFixed(2)})`);
  if (longTokenRatio > LONG_TOKEN_THRESHOLD)
    reasons.push(`run-together words (${(longTokenRatio * 100).toFixed(1)}%)`);
  if (doubledCharRatio > DOUBLED_CHAR_THRESHOLD)
    reasons.push(`repeated characters (${(doubledCharRatio * 100).toFixed(1)}%)`);

  return {
    firstContactOffset,
    caseFlipRatio,
    longTokenRatio,
    doubledCharRatio,
    reasons,
    trustworthy: reasons.length === 0,
  };
}
