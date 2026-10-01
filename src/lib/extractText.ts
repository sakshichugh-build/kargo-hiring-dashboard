import fs from "node:fs";
import mammoth from "mammoth";

/**
 * Extract text from a PDF using pdfjs-dist (legacy Node build). This mirrors the
 * "pdfplumber for text" step: it extracts cleanly for the pm_/spm_ files and
 * produces the known garbled output for the 01_–30_ files (which we then detect
 * and route to Claude PDF-input instead).
 */
export async function extractPdfText(filePath: string): Promise<string> {
  // Legacy build works in a plain Node (non-worker) context.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(filePath));
  // Silence font/verbosity noise; we only need the text stream.
  const loadingTask = pdfjs.getDocument({ data, verbosity: 0 });
  const doc = await loadingTask.promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ("str" in it ? (it as { str: string }).str : ""))
      .join(" ");
    pages.push(line);
  }
  await loadingTask.destroy();
  return pages.join("\n");
}

export async function pdfPageCount(filePath: string): Promise<number> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(filePath));
  const loadingTask = pdfjs.getDocument({ data, verbosity: 0 });
  const doc = await loadingTask.promise;
  const n = doc.numPages;
  await loadingTask.destroy();
  return n;
}

/** Extract text from a .docx (used for the 8 hire CVs and the 2 JDs). */
export async function extractDocxText(filePath: string): Promise<string> {
  const { value } = await mammoth.extractRawText({ path: filePath });
  return value;
}

/** Read a PDF as base64 (no newlines) for Claude PDF-document input. */
export function pdfBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString("base64");
}
