"use client";

import { useState } from "react";
import type { CandidateRecord, CriterionScore } from "@/lib/types";
import { scoreFor } from "@/lib/view";
import { Badge, ScorePill } from "@/components/Dashboard";
import type { DecisionRecord, EmailRecord } from "@/components/Dashboard";

const CRITERIA_META = [
  { key: "operations_exposure", label: "Ground-level ops exposure", weight: 30 },
  { key: "self_started_build", label: "Self-started build others adopted", weight: 20 },
  { key: "ownership_without_structure", label: "Ownership without structure", weight: 15 },
  { key: "ships_kills_learns", label: "Ships, kills, learns", weight: 15 },
] as const;

export default function CandidateCard(props: {
  candidate: CandidateRecord;
  rank: number;
  tab: "pm" | "spm";
  decision: DecisionRecord | null;
  emails: EmailRecord[];
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onDecision: (d: "forward" | "pass" | "pending") => void;
  onOverrideRole: (r: "pm" | "spm") => void;
  onSend: (type: "invite" | "rejection", subject: string, body: string) => void;
  fillName: (body: string) => string;
}) {
  const { candidate: c, rank, tab, decision, emails, expanded } = props;
  const s = c.scores!;
  const score = scoreFor(c, tab);
  const status = decision?.decision ?? "pending";
  const roleFit = tab === "spm" ? s.crit.role_fit_spm : s.crit.role_fit_pm;
  const otherRole = tab === "pm" ? "spm" : "pm";

  return (
    <div className={`rounded-xl border bg-white shadow-sm transition ${status === "pass" ? "border-slate-200 opacity-70" : "border-slate-200"}`}>
      {/* Collapsed header */}
      <button onClick={props.onToggle} className="flex w-full items-center gap-4 px-4 py-3 text-left">
        <span className="w-6 shrink-0 text-center text-sm font-semibold text-slate-400">{rank}</span>
        <ScorePill score={score} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{c.pii.name ?? c.id}</span>
            <Badge tone="slate">{c.profile.domain}</Badge>
            {c.roleLabel === "unlabelled" && <Badge tone="slate">unlabelled → rec: {s.recommendedRole.toUpperCase()}</Badge>}
            <Badge tone={s.confidence === "high" ? "green" : s.confidence === "med" ? "amber" : "red"}>{s.confidence} conf</Badge>
          </div>
          <p className="mt-0.5 line-clamp-1 text-sm text-slate-500">{s.rationale}</p>
        </div>
        <div className="shrink-0">
          <StatusBadge status={status} />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-4">
          {/* Score breakdown */}
          <div className="grid gap-2">
            {CRITERIA_META.map((cm) => (
              <CriterionRow key={cm.key} label={cm.label} weight={cm.weight} crit={s.crit[cm.key as keyof typeof s.crit] as CriterionScore} />
            ))}
            <CriterionRow label={`Role fit — ${tab === "spm" ? "Senior PM" : "PM"}`} weight={20} crit={roleFit} />
          </div>

          <div className="mt-2 text-xs text-slate-400">
            PM score {s.totalPm} · SPM score {s.totalSpm} · extraction: {c.extractionMethod}
            {c.extractionNotes ? ` (${c.extractionNotes})` : ""}
          </div>

          {/* Red flags */}
          {s.redFlags.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Red flags (surfaced, not auto-rejected)</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-amber-800">
                {s.redFlags.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}

          {/* Interview brief */}
          {c.brief && (
            <div className="mt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Interview brief — probe the weakest areas</p>
              <ol className="mt-1 list-decimal pl-5 text-sm text-slate-700">
                {c.brief.probe_questions.map((q, i) => <li key={i} className="mb-1">{q}</li>)}
              </ol>
            </div>
          )}

          {/* Decision controls */}
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <button
              onClick={() => props.onDecision("forward")}
              disabled={props.busy}
              className={`rounded-md px-3 py-1.5 text-sm font-medium shadow-sm disabled:opacity-50 ${status === "forward" ? "bg-emerald-600 text-white" : "border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"}`}
            >
              Move forward
            </button>
            <button
              onClick={() => props.onDecision("pass")}
              disabled={props.busy}
              className={`rounded-md px-3 py-1.5 text-sm font-medium shadow-sm disabled:opacity-50 ${status === "pass" ? "bg-rose-600 text-white" : "border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"}`}
            >
              Pass
            </button>
            {status !== "pending" && (
              <button onClick={() => props.onDecision("pending")} disabled={props.busy} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                Reset
              </button>
            )}
            <span className="mx-1 text-slate-300">|</span>
            <button onClick={() => props.onOverrideRole(otherRole)} disabled={props.busy} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Override role → {otherRole === "spm" ? "Senior PM" : "PM"}
            </button>
          </div>

          {/* Email editor */}
          {status === "forward" && c.brief && (
            <EmailEditor
              key={`invite-${c.id}`}
              type="invite"
              subject={c.brief.invite_subject}
              body={props.fillName(c.brief.invite_body)}
              emails={emails.filter((e) => e.type === "invite")}
              busy={props.busy}
              onSend={(subj, body) => props.onSend("invite", subj, body)}
            />
          )}
          {status === "pass" && c.brief && (
            <EmailEditor
              key={`rejection-${c.id}`}
              type="rejection"
              subject={c.brief.rejection_subject}
              body={props.fillName(c.brief.rejection_body)}
              emails={emails.filter((e) => e.type === "rejection")}
              busy={props.busy}
              onSend={(subj, body) => props.onSend("rejection", subj, body)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: "forward" | "pass" | "pending" }) {
  if (status === "forward") return <Badge tone="green">Moving forward</Badge>;
  if (status === "pass") return <Badge tone="red">Passed</Badge>;
  return <Badge tone="slate">Pending</Badge>;
}

function CriterionRow({ label, weight, crit }: { label: string; weight: number; crit: CriterionScore }) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-3 rounded-lg bg-slate-50 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-xs text-slate-400">{weight}%</span>
      </div>
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-2 w-5 rounded-sm ${i < crit.score ? "bg-slate-800" : "bg-slate-200"}`} />
        ))}
        <span className="ml-1 text-xs font-semibold text-slate-600">{crit.score}/3</span>
      </div>
      <p className="col-span-2 mt-1 text-xs text-slate-500">
        <span className="italic">{crit.evidence === "no evidence" ? "No evidence in CV." : `“${crit.evidence}”`}</span>
        {crit.reasoning ? <span className="text-slate-400"> — {crit.reasoning}</span> : null}
      </p>
    </div>
  );
}

function EmailEditor({
  type, subject: subj0, body: body0, emails, busy, onSend,
}: {
  type: "invite" | "rejection";
  subject: string;
  body: string;
  emails: EmailRecord[];
  busy: boolean;
  onSend: (subject: string, body: string) => void;
}) {
  // Initial state is seeded from the draft; the parent remounts this component
  // (via `key`) when the underlying draft changes, so no reseed effect is needed.
  const [subject, setSubject] = useState(subj0);
  const [body, setBody] = useState(body0);

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Draft {type === "invite" ? "invitation" : "rejection"} — edit before sending
        </p>
        {emails.length > 0 && (
          <span className="text-xs text-slate-500">
            {emails.length} sent · last {emails[0].status}
          </span>
        )}
      </div>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={9}
        className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm leading-relaxed"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate-400">Nothing is sent until you click Send.</span>
        <button
          onClick={() => onSend(subject, body)}
          disabled={busy}
          className="rounded-md bg-slate-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          Send {type === "invite" ? "invite" : "rejection"}
        </button>
      </div>
      {emails.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-slate-500">
          {emails.map((e) => (
            <li key={e.id}>
              {new Date(e.createdAt).toLocaleString()} → {e.actualTo} · <span className="font-medium">{e.status}</span>
              {e.error ? ` (${e.error})` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
