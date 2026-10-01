import crypto from "node:crypto";
import fs from "node:fs";

export function fileHash(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

export function stringHash(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);
}
