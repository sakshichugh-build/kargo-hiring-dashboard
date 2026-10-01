import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { APPLICATIONS_DIR, HIRES_DIR, OUTCOMES_JSON, RESULTS_JSON, OUT_DIR } from "../src/lib/paths";
import { extractApplication, extractHire } from "../src/lib/pipeline/extract";
import { extractDocxText } from "../src/lib/extractText";
import { scoreCandidate, scoreBacktest, profileFingerprint } from "../src/lib/pipeline/score";
import { briefAndEmail } from "../src/lib/pipeline/briefEmail";
import { fileHash } from "../src/lib/hash";
import { MOCK_MODE, MODEL, readAuditLog, resetAuditLog } from "../src/lib/claude";
import type { CandidateRecord, HireRecord, RoleLabel } from "../src/lib/types";

config({ path: ".env.local" });
config({ path: ".env" });

function roleFromName(file: string): RoleLabel {
  if (file.startsWith("pm_")) return "pm";
  if (file.startsWith("spm_")) return "spm";
  return "unlabelled";
}

async function main() {
  resetAuditLog();
  console.log(`Building results.json — mode: ${MOCK_MODE ? "MOCK" : `LIVE via ${MODEL}`}`);

  // --- Candidates ---
  const appFiles = fs.readdirSync(APPLICATIONS_DIR).filter((f) => f.endsWith(".pdf")).sort();
  const candidates: CandidateRecord[] = [];
  for (const file of appFiles) {
    const fp = path.join(APPLICATIONS_DIR, file);
    const roleLabel = roleFromName(file);
    const id = path.basename(file, ".pdf");
    const ex = await extractApplication(fp, roleLabel);
    const pf = profileFingerprint(ex.extraction.profile);
    const scores = await scoreCandidate(id, pf, ex.extraction.profile, ex.text);
    const assignedRole = roleLabel === "unlabelled" ? scores.recommendedRole : roleLabel;
    const brief = await briefAndEmail(id, pf, ex.extraction.profile, scores, assignedRole);
    candidates.push({
      id,
      sourceFile: `applications/${file}`,
      fileHash: ex.cached ? fileHash(fp) : fileHash(fp),
      roleLabel,
      extractionMethod: ex.method,
      extractionOk: !!ex.extraction.pii.name,
      extractionNotes: ex.assessmentReasons.join("; ") || undefined,
      pii: ex.extraction.pii,
      profile: ex.extraction.profile,
      scores,
      brief,
    });
    process.stdout.write(".");
  }
  console.log("");

  // --- Hires (calibration + backtest) ---
  const outcomes: Array<{ file: string; name: string; role: string; joined: string; lastRating: "Exceeds" | "Meets" | "Below" }> =
    JSON.parse(fs.readFileSync(OUTCOMES_JSON, "utf8"));
  const hires: HireRecord[] = [];
  for (const o of outcomes) {
    const fp = path.join(HIRES_DIR, o.file);
    const ex = await extractHire(fp);
    const text = await extractDocxText(fp);
    const bt = await scoreBacktest(o.file.replace(/\.docx$/, ""), profileFingerprint(ex.extraction.profile), ex.extraction.profile, text);
    hires.push({
      id: o.file.replace(/\.docx$/, ""),
      sourceFile: `hires/${o.file}`,
      name: o.name,
      role: o.role,
      joined: o.joined,
      lastRating: o.lastRating,
      profile: ex.extraction.profile,
      backtest: { crit: bt.crit, total: bt.total },
    });
  }

  const exceeds = hires.filter((h) => h.lastRating === "Exceeds").map((h) => h.backtest!.total);
  const lower = hires.filter((h) => h.lastRating !== "Exceeds").map((h) => h.backtest!.total);
  const backtestPass = Math.min(...exceeds) > Math.max(...lower);

  // --- Audit summary ---
  const log = readAuditLog();
  const scoreLeaks = log.filter((l) => (l.callType === "score" || l.callType === "backtest") && l.userPayloadContainsContactInfo).length;

  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      mock: MOCK_MODE,
      model: MOCK_MODE ? "mock" : MODEL,
      counts: { candidates: candidates.length, hires: hires.length },
      backtest: { pass: backtestPass, lowestExceeds: Math.min(...exceeds), highestLower: Math.max(...lower) },
      audit: { totalCalls: log.length, scoringPayloadsWithPii: scoreLeaks },
    },
    candidates,
    hires,
  };

  fs.mkdirSync(path.dirname(RESULTS_JSON), { recursive: true });
  fs.writeFileSync(RESULTS_JSON, JSON.stringify(out, null, 2));
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "results.json"), JSON.stringify(out, null, 2));

  console.log(`\nWrote ${candidates.length} candidates + ${hires.length} hires to src/data/results.json`);
  console.log(`Backtest: ${backtestPass ? "PASS" : "FAIL"} | Audit: ${log.length} calls, scoring payloads with PII = ${scoreLeaks} (must be 0)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
