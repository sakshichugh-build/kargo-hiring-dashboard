"use client";

import { useState } from "react";
import type { CandidateRecord } from "@/lib/types";
import type { AppState } from "@/components/Dashboard";

export default function ActivityLog({
  state, candidates, onClose,
}: {
  state: AppState;
  candidates: CandidateRecord[];
  onClose: () => void;
}) {
  const [view, setView] = useState<"log" | "emails">("log");
  const nameOf = (id: string) => candidates.find((c) => c.id === id)?.pii.name ?? id;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Activity log</h2>
          <button onClick={onClose} className="rounded-md border border-slate-200 px-2 py-1 text-sm hover:bg-slate-50">Close</button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Every decision, its rationale, and every email (sent or dry-run) is recorded — so there is always a record of why.
        </p>

        <div className="mb-3 inline-flex rounded-lg border border-slate-200 p-1 text-sm">
          <button onClick={() => setView("log")} className={`rounded-md px-3 py-1 ${view === "log" ? "bg-slate-900 text-white" : "text-slate-600"}`}>
            Decisions ({state.log.length})
          </button>
          <button onClick={() => setView("emails")} className={`rounded-md px-3 py-1 ${view === "emails" ? "bg-slate-900 text-white" : "text-slate-600"}`}>
            Emails ({state.emails.length})
          </button>
        </div>

        {view === "log" ? (
          state.log.length === 0 ? (
            <Empty>No decisions recorded yet.</Empty>
          ) : (
            <ul className="space-y-2">
              {state.log.map((l) => (
                <li key={l.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{nameOf(l.candidateId)}</span>
                    <span className="text-xs text-slate-400">{new Date(l.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-xs text-slate-500">
                    <span className="font-mono">{l.action}</span>{l.detail ? ` — ${l.detail}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : state.emails.length === 0 ? (
          <Empty>No emails sent yet.</Empty>
        ) : (
          <ul className="space-y-2">
            {state.emails.map((e) => (
              <li key={e.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{nameOf(e.candidateId)} · {e.type}</span>
                  <span className={`text-xs ${e.status === "failed" ? "text-rose-600" : e.status === "sent" ? "text-emerald-600" : "text-amber-600"}`}>{e.status}</span>
                </div>
                <div className="text-xs text-slate-500">to {e.actualTo} (intended {e.intendedTo})</div>
                <div className="text-xs text-slate-400">{e.subject}</div>
                {e.error && <div className="text-xs text-rose-500">{e.error}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">{children}</div>;
}
