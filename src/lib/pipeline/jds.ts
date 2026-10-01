import { extractDocxText } from "../extractText";
import { JD_PM, JD_SPM } from "../paths";

let cache: { pm: string; spm: string } | null = null;

export async function loadJDs(): Promise<{ pm: string; spm: string }> {
  if (cache) return cache;
  const [pm, spm] = await Promise.all([extractDocxText(JD_PM), extractDocxText(JD_SPM)]);
  cache = { pm, spm };
  return cache;
}
