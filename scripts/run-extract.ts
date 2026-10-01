import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { APPLICATIONS_DIR, HIRES_DIR, EXTRACTED_DIR } from "../src/lib/paths";
import { extractApplication, extractHire } from "../src/lib/pipeline/extract";
import { MOCK_MODE, MODEL, resetAuditLog, readAuditLog } from "../src/lib/claude";
import type { RoleLabel } from "../src/lib/types";

config({ path: ".env.local" });
config({ path: ".env" });

function roleFromName(file: string): RoleLabel {
  if (file.startsWith("pm_")) return "pm";
  if (file.startsWith("spm_")) return "spm";
  return "unlabelled";
}

function pad(s: string | number, n: number): string {
  return String(s).slice(0, n).padEnd(n);
}

async function main() {
  resetAuditLog();
  fs.mkdirSync(EXTRACTED_DIR, { recursive: true });

  console.log(`\n=== PHASE 1: EXTRACTION ===`);
  console.log(`Mode: ${MOCK_MODE ? "MOCK (no ANTHROPIC_API_KEY — structured fields are heuristic stubs)" : `LIVE via ${MODEL}`}\n`);

  const appFiles = fs.readdirSync(APPLICATIONS_DIR).filter((f) => f.endsWith(".pdf")).sort();
  const hireFiles = fs.readdirSync(HIRES_DIR).filter((f) => f.endsWith(".docx")).sort();

  console.log(pad("FILE", 30) + pad("ROLE", 11) + pad("METHOD", 15) + pad("PG", 3) + pad("NAME", 20) + pad("PMyr", 6) + pad("DOMAIN", 22) + "FLAGS");
  console.log("-".repeat(130));

  let textCount = 0, pdfCount = 0, failures = 0;
  const failureList: string[] = [];

  for (const file of appFiles) {
    const role = roleFromName(file);
    const fp = path.join(APPLICATIONS_DIR, file);
    try {
      const r = await extractApplication(fp, role);
      if (r.method === "text") textCount++;
      else pdfCount++;
      const name = r.extraction.pii.name ?? "(none)";
      const nameOk = !!r.extraction.pii.name;
      const flags: string[] = [];
      if (!nameOk) flags.push("NO-NAME");
      if (!r.extraction.pii.email) flags.push("NO-EMAIL");
      if (r.method === "pdf-to-claude") flags.push("pdf-fallback");
      if (r.cached) flags.push("cached");
      if (flags.includes("NO-NAME")) { failures++; failureList.push(file); }
      console.log(
        pad(file, 30) + pad(role, 11) + pad(r.method, 15) + pad(r.pages, 3) +
        pad(name, 20) + pad(r.extraction.profile.totalPmYears ?? "?", 6) +
        pad(r.extraction.profile.domain, 22) + flags.join(" "),
      );
      fs.writeFileSync(
        path.join(EXTRACTED_DIR, `${path.basename(file, ".pdf")}.json`),
        JSON.stringify({ file, role, method: r.method, pages: r.pages, assessmentReasons: r.assessmentReasons, ...r.extraction }, null, 2),
      );
    } catch (e) {
      failures++; failureList.push(file);
      console.log(pad(file, 30) + pad(role, 11) + "ERROR: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  console.log("\n--- HIRES (calibration set) ---");
  for (const file of hireFiles) {
    const fp = path.join(HIRES_DIR, file);
    try {
      const r = await extractHire(fp);
      console.log(
        pad(file, 30) + pad("hire", 11) + pad(r.method, 15) + pad(1, 3) +
        pad(r.extraction.pii.name ?? "(none)", 20) +
        pad(r.extraction.profile.totalPmYears ?? "?", 6) +
        pad(r.extraction.profile.domain, 22) + (r.cached ? "cached" : ""),
      );
      fs.writeFileSync(
        path.join(EXTRACTED_DIR, `${path.basename(file, ".docx")}.json`),
        JSON.stringify({ file, role: "hire", method: r.method, ...r.extraction }, null, 2),
      );
    } catch (e) {
      console.log(pad(file, 30) + "ERROR: " + (e instanceof Error ? e.message : String(e)));
    }
  }

  // Method + failure summary.
  console.log("\n=== SUMMARY ===");
  console.log(`Applications: ${appFiles.length}  |  text-extraction: ${textCount}  |  pdf-to-claude fallback: ${pdfCount}`);
  console.log(`Name-detection failures: ${failures}${failureList.length ? " -> " + failureList.join(", ") : ""}`);

  // Audit check: prove scoring payloads never carry contact info (none yet in phase 1).
  const log = readAuditLog();
  const scoreCalls = log.filter((l) => l.callType === "score" || l.callType === "backtest");
  const leaks = scoreCalls.filter((l) => l.userPayloadContainsContactInfo);
  console.log(`\nAudit log: ${log.length} Claude calls recorded -> pipeline-output/claude-calls.jsonl`);
  console.log(`  extraction calls may contain PII (expected). Scoring calls with contact info: ${leaks.length} (must be 0).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
