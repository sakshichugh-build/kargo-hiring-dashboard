import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Thin storage interface for decisions + the email/decision audit log.
 *
 * Local/dev uses Node's built-in SQLite (no native module). For a Vercel
 * deployment, implement this same interface against a hosted store (Neon
 * Postgres, Vercel KV, etc.) and swap it in `getStorage()`. The rest of the app
 * depends only on the StorageAdapter shape — nothing else changes.
 */

export type Decision = "forward" | "pass" | "pending";
export type RoleChoice = "pm" | "spm";

export interface DecisionRecord {
  candidateId: string;
  decision: Decision;
  role: RoleChoice | null; // role override; null = use default
  rationale: string;
  updatedAt: string;
}

export interface EmailRecord {
  id: number;
  candidateId: string;
  type: "invite" | "rejection";
  intendedTo: string; // the real candidate address
  actualTo: string; // where it was actually sent (TEST_RECIPIENT in test mode)
  subject: string;
  body: string;
  status: "sent" | "dry-run" | "failed";
  providerId: string | null;
  error: string | null;
  createdAt: string;
}

export interface LogRecord {
  id: number;
  candidateId: string;
  action: string;
  detail: string;
  createdAt: string;
}

export interface StorageAdapter {
  getDecisions(): DecisionRecord[];
  getDecision(candidateId: string): DecisionRecord | null;
  setDecision(candidateId: string, decision: Decision, role: RoleChoice | null, rationale: string): DecisionRecord;
  setRole(candidateId: string, role: RoleChoice): void;
  logEmail(e: Omit<EmailRecord, "id" | "createdAt">): EmailRecord;
  getEmails(): EmailRecord[];
  getEmailsFor(candidateId: string): EmailRecord[];
  appendLog(candidateId: string, action: string, detail: string): void;
  getLog(): LogRecord[];
}

class SqliteStorage implements StorageAdapter {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS decisions (
        candidate_id TEXT PRIMARY KEY,
        decision TEXT NOT NULL,
        role TEXT,
        rationale TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL,
        type TEXT NOT NULL,
        intended_to TEXT,
        actual_to TEXT,
        subject TEXT,
        body TEXT,
        status TEXT NOT NULL,
        provider_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS decision_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        candidate_id TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  getDecisions(): DecisionRecord[] {
    return (this.db.prepare(`SELECT * FROM decisions`).all() as unknown as RawDecision[]).map(mapDecision);
  }
  getDecision(candidateId: string): DecisionRecord | null {
    const r = this.db.prepare(`SELECT * FROM decisions WHERE candidate_id = ?`).get(candidateId) as unknown as RawDecision | undefined;
    return r ? mapDecision(r) : null;
  }
  setDecision(candidateId: string, decision: Decision, role: RoleChoice | null, rationale: string): DecisionRecord {
    const now = new Date().toISOString();
    const existing = this.getDecision(candidateId);
    const finalRole = role ?? existing?.role ?? null;
    this.db.prepare(
      `INSERT INTO decisions (candidate_id, decision, role, rationale, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(candidate_id) DO UPDATE SET decision=excluded.decision, role=excluded.role, rationale=excluded.rationale, updated_at=excluded.updated_at`,
    ).run(candidateId, decision, finalRole, rationale, now);
    this.appendLog(candidateId, `decision:${decision}`, rationale);
    return { candidateId, decision, role: finalRole, rationale, updatedAt: now };
  }
  setRole(candidateId: string, role: RoleChoice): void {
    const now = new Date().toISOString();
    const existing = this.getDecision(candidateId);
    this.db.prepare(
      `INSERT INTO decisions (candidate_id, decision, role, rationale, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(candidate_id) DO UPDATE SET role=excluded.role, updated_at=excluded.updated_at`,
    ).run(candidateId, existing?.decision ?? "pending", role, existing?.rationale ?? "", now);
    this.appendLog(candidateId, "override-role", role);
  }
  logEmail(e: Omit<EmailRecord, "id" | "createdAt">): EmailRecord {
    const now = new Date().toISOString();
    const info = this.db.prepare(
      `INSERT INTO emails (candidate_id, type, intended_to, actual_to, subject, body, status, provider_id, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(e.candidateId, e.type, e.intendedTo, e.actualTo, e.subject, e.body, e.status, e.providerId, e.error, now);
    this.appendLog(e.candidateId, `email:${e.type}:${e.status}`, `to ${e.actualTo} (intended ${e.intendedTo})`);
    return { ...e, id: Number(info.lastInsertRowid), createdAt: now };
  }
  getEmails(): EmailRecord[] {
    return (this.db.prepare(`SELECT * FROM emails ORDER BY id DESC`).all() as unknown as RawEmail[]).map(mapEmail);
  }
  getEmailsFor(candidateId: string): EmailRecord[] {
    return (this.db.prepare(`SELECT * FROM emails WHERE candidate_id = ? ORDER BY id DESC`).all(candidateId) as unknown as RawEmail[]).map(mapEmail);
  }
  appendLog(candidateId: string, action: string, detail: string): void {
    this.db.prepare(`INSERT INTO decision_log (candidate_id, action, detail, created_at) VALUES (?, ?, ?, ?)`)
      .run(candidateId, action, detail, new Date().toISOString());
  }
  getLog(): LogRecord[] {
    return (this.db.prepare(`SELECT * FROM decision_log ORDER BY id DESC`).all() as unknown as RawLog[]).map((r) => ({
      id: r.id, candidateId: r.candidate_id, action: r.action, detail: r.detail, createdAt: r.created_at,
    }));
  }
}

interface RawDecision { candidate_id: string; decision: string; role: string | null; rationale: string | null; updated_at: string; }
interface RawEmail { id: number; candidate_id: string; type: string; intended_to: string; actual_to: string; subject: string; body: string; status: string; provider_id: string | null; error: string | null; created_at: string; }
interface RawLog { id: number; candidate_id: string; action: string; detail: string; created_at: string; }

function mapDecision(r: RawDecision): DecisionRecord {
  return { candidateId: r.candidate_id, decision: r.decision as Decision, role: (r.role as RoleChoice | null) ?? null, rationale: r.rationale ?? "", updatedAt: r.updated_at };
}
function mapEmail(r: RawEmail): EmailRecord {
  return { id: r.id, candidateId: r.candidate_id, type: r.type as EmailRecord["type"], intendedTo: r.intended_to, actualTo: r.actual_to, subject: r.subject, body: r.body, status: r.status as EmailRecord["status"], providerId: r.provider_id, error: r.error, createdAt: r.created_at };
}

let instance: StorageAdapter | null = null;
export function getStorage(): StorageAdapter {
  if (!instance) {
    const dbPath = process.env.KARGO_DB_PATH || path.join(process.cwd(), ".data", "kargo.db");
    instance = new SqliteStorage(dbPath);
  }
  return instance;
}
