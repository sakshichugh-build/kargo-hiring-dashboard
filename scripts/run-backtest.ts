import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { HIRES_DIR, OUTCOMES_JSON, OUT_DIR } from "../src/lib/paths";
import { extractHire } from "../src/lib/pipeline/extract";
import { extractDocxText } from "../src/lib/extractText";
import { scoreBacktest, profileFingerprint } from "../src/lib/pipeline/score";
import { MOCK_MODE, MODEL } from "../src/lib/claude";

config({ path: ".env.local" });
config({ path: ".env" });

interface Outcome {
  file: string;
  name: string;
  role: string;
  joined: string;
  lastRating: "Exceeds" | "Meets" | "Below";
}

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}

async function main() {
  const outcomes: Outcome[] = JSON.parse(fs.readFileSync(OUTCOMES_JSON, "utf8"));

  console.log(`\n=== PHASE 2: BACKTEST (criteria 1–4 only) ===`);
  console.log(`Mode: ${MOCK_MODE ? "MOCK (keyword heuristic)" : `LIVE via ${MODEL}`}\n`);

  const rows: Array<{ o: Outcome; total: number; c: number[] }> = [];
  for (const o of outcomes) {
    const fp = path.join(HIRES_DIR, o.file);
    const { extraction } = await extractHire(fp);
    const text = await extractDocxText(fp);
    const { crit, total } = await scoreBacktest(
      o.file.replace(/\.docx$/, ""),
      profileFingerprint(extraction.profile),
      extraction.profile,
      text,
    );
    rows.push({
      o,
      total,
      c: [
        crit.operations_exposure.score,
        crit.self_started_build.score,
        crit.ownership_without_structure.score,
        crit.ships_kills_learns.score,
      ],
    });
  }

  rows.sort((a, b) => b.total - a.total);

  console.log(pad("RANK", 5) + pad("TOTAL", 7) + pad("RATING", 9) + pad("c1", 4) + pad("c2", 4) + pad("c3", 4) + pad("c4", 4) + pad("NAME", 22) + "HIRED ROLE");
  console.log("-".repeat(90));
  rows.forEach((r, i) => {
    console.log(
      pad(i + 1, 5) + pad(r.total.toFixed(1), 7) + pad(r.o.lastRating, 9) +
      pad(r.c[0], 4) + pad(r.c[1], 4) + pad(r.c[2], 4) + pad(r.c[3], 4) +
      pad(r.o.name, 22) + r.o.role,
    );
  });

  // Validation: every Exceeds must rank above every Meets/Below.
  const exceeds = rows.filter((r) => r.o.lastRating === "Exceeds").map((r) => r.total);
  const lower = rows.filter((r) => r.o.lastRating !== "Exceeds").map((r) => r.total);
  const minExceeds = Math.min(...exceeds);
  const maxLower = Math.max(...lower);
  const pass = minExceeds > maxLower;

  console.log("\n=== BACKTEST RESULT ===");
  console.log(`Lowest Exceeds total:  ${minExceeds.toFixed(1)}`);
  console.log(`Highest Meets/Below:   ${maxLower.toFixed(1)}`);
  console.log(pass ? "✅ PASS — all Exceeds rank above all Meets/Below." : "❌ FAIL — overlap between bands. Investigate before changing weights.");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "backtest.json"), JSON.stringify({ pass, rows }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
