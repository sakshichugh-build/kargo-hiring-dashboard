import type { CandidateRecord } from "./types";

/** Pure, client-safe view helpers (no server imports, no results.json). */

export function defaultRole(c: CandidateRecord): "pm" | "spm" {
  if (c.roleLabel === "pm" || c.roleLabel === "spm") return c.roleLabel;
  return c.scores?.recommendedRole ?? "pm";
}

export function firstNameOf(c: CandidateRecord): string {
  const n = c.pii.name?.trim();
  if (!n) return "there";
  return n.split(/\s+/)[0];
}

export function fillName(body: string, c: CandidateRecord): string {
  return body.replace(/\{\{\s*first_name\s*\}\}/g, firstNameOf(c));
}

export function scoreFor(c: CandidateRecord, role: "pm" | "spm"): number {
  if (!c.scores) return 0;
  return role === "spm" ? c.scores.totalSpm : c.scores.totalPm;
}

export function scoreBand(n: number): "high" | "mid" | "low" {
  return n >= 66 ? "high" : n >= 40 ? "mid" : "low";
}
