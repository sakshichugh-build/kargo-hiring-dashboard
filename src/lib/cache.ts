import fs from "node:fs";
import path from "node:path";
import { CACHE_DIR } from "./paths";

/**
 * Caches Claude results by a key derived from the file hash + call type + a
 * prompt-version tag, so re-runs are cheap and a prompt change busts the cache.
 */
export function cacheGet<T>(key: string): T | null {
  const f = path.join(CACHE_DIR, `${key}.json`);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, value: T): void {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(value, null, 2));
}
