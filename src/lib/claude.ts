import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CLAUDE_LOG, OUT_DIR } from "./paths";

export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

/** Mock mode runs the whole pipeline without an API key (deterministic stubs). */
export const MOCK_MODE =
  process.env.PIPELINE_MOCK === "1" || !process.env.ANTHROPIC_API_KEY;

export type CallType = "extract-text" | "extract-pdf" | "score" | "backtest" | "brief-email";

export type UserContent = string | Anthropic.MessageParam["content"];

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

/**
 * Audit log: every Claude call records the EXACT payload sent, so we can verify
 * the hard rule — personal details never reach the scoring prompt.
 */
function logCall(entry: Record<string, unknown>): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.appendFileSync(CLAUDE_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

function previewOf(content: UserContent): string {
  if (typeof content === "string") return content;
  // Content blocks: record text blocks verbatim; note (not embed) documents/images.
  return content
    .map((b) => {
      if (b.type === "text") return b.text;
      if (b.type === "document") return "[document:pdf]";
      if (b.type === "image") return "[image]";
      return `[${b.type}]`;
    })
    .join("\n");
}

function stripFences(s: string): string {
  const t = s.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  return (m ? m[1] : t).trim();
}

export interface CallOpts<T> {
  callType: CallType;
  subjectId: string; // candidate/hire id, for the audit log
  system: string;
  user: UserContent;
  schema: z.ZodType<T>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  /** Deterministic stub used in MOCK_MODE (and logged as mock). */
  mock: () => T;
}

/**
 * One Claude call returning schema-validated JSON, with a single retry on
 * invalid JSON / schema failure. Records the full payload to the audit log.
 */
export async function callClaudeJson<T>(opts: CallOpts<T>): Promise<T> {
  const auditPayload = previewOf(opts.user);
  const containsPii = /squad_\d+@|@[\w.-]+\.\w|\+91/.test(auditPayload);

  if (MOCK_MODE) {
    logCall({
      callType: opts.callType,
      subjectId: opts.subjectId,
      model: "MOCK",
      mock: true,
      systemChars: opts.system.length,
      userPayloadContainsContactInfo: containsPii,
      userPayload: auditPayload,
    });
    return opts.schema.parse(opts.mock());
  }

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: opts.user as Anthropic.MessageParam["content"] },
  ];

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const sys =
      attempt === 0
        ? opts.system
        : `${opts.system}\n\nYour previous reply could not be parsed as valid JSON matching the schema (${lastErr}). Respond again with ONLY the JSON object, no prose, no markdown fences.`;

    const resp = await getClient().messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 8000,
      system: sys,
      output_config: opts.effort ? { effort: opts.effort } : undefined,
      messages,
    });

    logCall({
      callType: opts.callType,
      subjectId: opts.subjectId,
      model: MODEL,
      attempt,
      usage: resp.usage,
      systemChars: sys.length,
      userPayloadContainsContactInfo: containsPii,
      userPayload: auditPayload,
    });

    const textBlock = resp.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? stripFences(textBlock.text) : "";
    try {
      return opts.schema.parse(JSON.parse(raw));
    } catch (e) {
      lastErr = e instanceof Error ? e.message.slice(0, 200) : String(e);
    }
  }
  throw new Error(`callClaudeJson(${opts.callType}/${opts.subjectId}) failed: ${lastErr}`);
}

/** Read the audit log back for verification/reporting. */
export function readAuditLog(): Array<Record<string, unknown>> {
  if (!fs.existsSync(CLAUDE_LOG)) return [];
  return fs
    .readFileSync(CLAUDE_LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

export function resetAuditLog(): void {
  if (fs.existsSync(CLAUDE_LOG)) fs.rmSync(CLAUDE_LOG);
  fs.mkdirSync(path.dirname(CLAUDE_LOG), { recursive: true });
}
