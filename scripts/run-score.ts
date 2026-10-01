import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { APPLICATIONS_DIR } from "../src/lib/paths";
import { extractApplication } from "../src/lib/pipeline/extract";
import { scoreCandidate, profileFingerprint } from "../src/lib/pipeline/score";
import { MOCK_MODE, MODEL } from "../src/lib/claude";
import type { RoleLabel, ComputedScores } from "../src/lib/types";

config({ path: ".env.local" });
config({ path: ".env" });

function roleFromName(file: string): RoleLabel {
  if (file.startsWith("pm_")) return "pm";
  if (file.startsWith("spm_")) return "spm";
  return "unlabelled";
}
const pad = (s: string | number, n: number) => String(s).padEnd(n);

interface Row {
  id: string;
  name: string;
  roleLabel: RoleLabel;
  s: ComputedScores;
}

async function main() {
  console.log(`\n=== PHASE 3: SCORE ALL 60 ===`);
  console.log(`Mode: ${MOCK_MODE ? "MOCK (keyword heuristic)" : `LIVE via ${MODEL}`}\n`);

  const files = fs.readdirSync(APPLICATIONS_DIR).filter((f) => f.endsWith(".pdf")).sort();
  const rows: Row[] = [];
  for (const file of files) {
    const role = roleFromName(file);
    const r = await extractApplication(path.join(APPLICATIONS_DIR, file), role);
    const s = await scoreCandidate(
      path.basename(file, ".pdf"),
      profileFingerprint(r.extraction.profile),
      r.extraction.profile,
      r.text,
    );
    rows.push({ id: path.basename(file, ".pdf"), name: r.extraction.pii.name ?? file, roleLabel: role, s });
  }

  const show = (title: string, list: Row[], score: (r: Row) => number) => {
    console.log(`\n${title}`);
    console.log(pad("SCORE", 7) + pad("REC", 5) + pad("CONF", 6) + pad("NAME", 22) + pad("LABEL", 11) + "FLAGS");
    console.log("-".repeat(90));
    for (const r of list) {
      console.log(
        pad(score(r).toFixed(1), 7) + pad(r.s.recommendedRole, 5) + pad(r.s.confidence, 6) +
        pad(r.name, 22) + pad(r.roleLabel, 11) + (r.s.redFlags[0] ?? ""),
      );
    }
  };

  const byPm = [...rows].sort((a, b) => b.s.totalPm - a.s.totalPm);
  const bySpm = [...rows].sort((a, b) => b.s.totalSpm - a.s.totalSpm);

  show("TOP 5 — Product Manager (by PM score)", byPm.slice(0, 5), (r) => r.s.totalPm);
  show("BOTTOM 5 — Product Manager", byPm.slice(-5), (r) => r.s.totalPm);
  show("TOP 5 — Senior Product Manager (by SPM score)", bySpm.slice(0, 5), (r) => r.s.totalSpm);
  show("BOTTOM 5 — Senior Product Manager", bySpm.slice(-5), (r) => r.s.totalSpm);

  const rec = rows.reduce((m, r) => ((m[r.s.recommendedRole] = (m[r.s.recommendedRole] || 0) + 1), m), {} as Record<string, number>);
  console.log(`\nRecommended-role split: PM=${rec.pm || 0}  SPM=${rec.spm || 0}  (all 60 remain visible)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
