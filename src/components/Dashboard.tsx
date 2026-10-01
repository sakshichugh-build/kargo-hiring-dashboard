"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import type { ResultsFile } from "@/lib/data";
import type { CandidateRecord } from "@/lib/types";
import { defaultRole, fillName, scoreFor, scoreBand } from "@/lib/view";
import CandidateCard from "@/components/CandidateCard";
import ActivityLog from "@/components/ActivityLog";

export interface DecisionRecord {
  candidateId: string;
  decision: "forward" | "pass" | "pending";
  role: "pm" | "spm" | null;
  rationale: string;
  updatedAt: string;
}
export interface EmailRecord {
  id: number;
  candidateId: string;
  type: "invite" | "rejection";
  intendedTo: string;
  actualTo: string;
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
export interface AppState {
  decisions: DecisionRecord[];
  emails: EmailRecord[];
  log: LogRecord[];
  emailMode: string;
  resendConfigured: boolean;
  testRecipient: string | null;
}

export default function Dashboard({ results }: { results: ResultsFile }) {
  const [tab, setTab] = useState<"pm" | "spm">("pm");
  const [state, setState] = useState<AppState | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/state", { cache: "no-store" });
    setState(await r.json());
  }, []);

  // Load state on mount. setState runs in an async callback (not synchronously
  // in the effect body), and we guard against setting state after unmount.
  useEffect(() => {
    let active = true;
    (async () => {
      const r = await fetch("/api/state", { cache: "no-store" });
      const json = await r.json();
      if (active) setState(json);
    })();
    return () => {
      active = false;
    };
  }, []);

  const decisionMap = useMemo(() => {
    const m = new Map<string, DecisionRecord>();
    state?.decisions.forEach((d) => m.set(d.candidateId, d));
    return m;
  }, [state]);

  const emailsByCandidate = useMemo(() => {
    const m = new Map<string, EmailRecord[]>();
    state?.emails.forEach((e) => {
      const arr = m.get(e.candidateId) ?? [];
      arr.push(e);
      m.set(e.candidateId, arr);
    });
    return m;
  }, [state]);

  // A candidate's current role = override, else default (label or recommended).
  const roleOf = useCallback(
    (c: CandidateRecord): "pm" | "spm" => decisionMap.get(c.id)?.role ?? defaultRole(c),
    [decisionMap],
  );

  const tabCandidates = useMemo(() => {
    return results.candidates
      .filter((c) => roleOf(c) === tab)
      .sort((a, b) => scoreFor(b, tab) - scoreFor(a, tab));
  }, [results.candidates, roleOf, tab]);

  const pmCount = results.candidates.filter((c) => roleOf(c) === "pm").length;
  const spmCount = results.candidates.filter((c) => roleOf(c) === "spm").length;

  const pendingRejections = useMemo(() => {
    if (!state) return 0;
    const rejected = new Set(state.emails.filter((e) => e.type === "rejection" && e.status !== "failed").map((e) => e.candidateId));
    return state.decisions.filter((d) => d.decision === "pass" && !rejected.has(d.candidateId)).length;
  }, [state]);

  const post = useCallback(async (url: string, body: unknown) => {
    setBusy(true);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      await refresh();
      return await r.json();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const setDecision = (c: CandidateRecord, decision: "forward" | "pass" | "pending") =>
    post("/api/decision", { candidateId: c.id, decision, rationale: c.scores?.rationale ?? "" });
  const overrideRole = (c: CandidateRecord, role: "pm" | "spm") => post("/api/role", { candidateId: c.id, role });
  const sendEmail = (c: CandidateRecord, type: "invite" | "rejection", subject: string, body: string) =>
    post("/api/send", { candidateId: c.id, type, subject, body });

  const sendAllRejections = async () => {
    setConfirmReject(false);
    await post("/api/send-all-rejections", { confirm: true });
  };

  const m = results.meta;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      {/* Header */}
      <header className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Kargo Hiring Dashboard</h1>
            <p className="text-sm text-slate-500">
              60 candidates ranked against Kargo&apos;s success pattern. You decide — the system drafts everything, sends nothing without your click.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge tone={m.mock ? "amber" : "green"}>{m.mock ? "MOCK DATA" : `live · ${m.model}`}</Badge>
            <Badge tone={m.backtest.pass ? "green" : "red"}>
              backtest {m.backtest.pass ? "PASS" : "FAIL"} ({m.backtest.lowestExceeds}&gt;{m.backtest.highestLower})
            </Badge>
            <Badge tone={m.audit.scoringPayloadsWithPii === 0 ? "green" : "red"}>
              PII in scoring: {m.audit.scoringPayloadsWithPii}
            </Badge>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <TabButton active={tab === "pm"} onClick={() => setTab("pm")}>Product Manager <span className="ml-1 text-slate-400">({pmCount})</span></TabButton>
            <TabButton active={tab === "spm"} onClick={() => setTab("spm")}>Senior PM <span className="ml-1 text-slate-400">({spmCount})</span></TabButton>
          </div>
          <div className="flex items-center gap-2">
            {state && (
              <span className="text-xs text-slate-500">
                {state.emailMode === "live" ? "LIVE email" : "TEST email"}
                {state.resendConfigured ? "" : " · no RESEND key (dry-run)"}
                {state.testRecipient ? ` → ${state.testRecipient}` : ""}
              </span>
            )}
            <button onClick={() => setShowLog(true)} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-slate-50">
              Activity log
            </button>
            <button
              onClick={() => setConfirmReject(true)}
              disabled={pendingRejections === 0 || busy}
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-sm text-rose-700 shadow-sm hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Send all pending rejections{pendingRejections ? ` (${pendingRejections})` : ""}
            </button>
          </div>
        </div>
      </header>

      {/* Candidate list */}
      <div className="space-y-3">
        {tabCandidates.map((c, i) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            rank={i + 1}
            tab={tab}
            decision={decisionMap.get(c.id) ?? null}
            emails={emailsByCandidate.get(c.id) ?? []}
            expanded={expanded === c.id}
            busy={busy}
            onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
            onDecision={(d) => setDecision(c, d)}
            onOverrideRole={(r) => overrideRole(c, r)}
            onSend={(type, subject, body) => sendEmail(c, type, subject, body)}
            fillName={(body) => fillName(body, c)}
          />
        ))}
      </div>

      {showLog && state && <ActivityLog state={state} candidates={results.candidates} onClose={() => setShowLog(false)} />}

      {confirmReject && (
        <Modal onClose={() => setConfirmReject(false)}>
          <h3 className="text-lg font-semibold">Send all pending rejections?</h3>
          <p className="mt-2 text-sm text-slate-600">
            This will email the rejection draft to <strong>{pendingRejections}</strong> candidate{pendingRejections === 1 ? "" : "s"} currently marked <em>Pass</em> who haven&apos;t been emailed yet.
            {state && (state.emailMode !== "live" || !state.resendConfigured) && (
              <> They will be routed to the test recipient{state.resendConfigured ? "" : " (or dry-run, since no Resend key is set)"}.</>
            )}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setConfirmReject(false)} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">Cancel</button>
            <button onClick={sendAllRejections} disabled={busy} className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50">
              Yes, send {pendingRejections}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
    >
      {children}
    </button>
  );
}

export function Badge({ tone, children }: { tone: "green" | "amber" | "red" | "slate"; children: React.ReactNode }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    red: "bg-rose-50 text-rose-700 border-rose-200",
    slate: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-medium ${tones[tone]}`}>{children}</span>;
}

export function ScorePill({ score }: { score: number }) {
  const band = scoreBand(score);
  const tone = band === "high" ? "bg-emerald-500" : band === "mid" ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex flex-col items-center">
      <div className={`flex h-12 w-12 items-center justify-center rounded-full text-white ${tone}`}>
        <span className="text-base font-bold">{Math.round(score)}</span>
      </div>
      <span className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">/ 100</span>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
