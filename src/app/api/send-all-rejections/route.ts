import { getStorage } from "@/lib/server/storage";
import { sendEmail } from "@/lib/server/email";
import { getCandidate, fillName } from "@/lib/data";

export const dynamic = "force-dynamic";

/**
 * Sends rejection emails to every candidate currently marked "pass" that has not
 * already been emailed a rejection. Requires an explicit confirm flag (the UI
 * shows a confirmation step; this is the server-side guard). Never auto-runs.
 */
export async function POST(request: Request) {
  const { confirm } = (await request.json().catch(() => ({}))) as { confirm?: boolean };
  if (confirm !== true) {
    return Response.json({ error: "confirmation required" }, { status: 400 });
  }

  const s = getStorage();
  const decisions = s.getDecisions();
  const alreadyRejected = new Set(
    s.getEmails().filter((e) => e.type === "rejection" && e.status !== "failed").map((e) => e.candidateId),
  );

  const pending = decisions.filter((d) => d.decision === "pass" && !alreadyRejected.has(d.candidateId));
  const sent: Array<{ candidateId: string; status: string }> = [];

  for (const d of pending) {
    const cand = getCandidate(d.candidateId);
    if (!cand?.brief) continue;
    const subject = cand.brief.rejection_subject;
    const body = fillName(cand.brief.rejection_body, cand);
    const intendedTo = cand.pii.email || "(no email on CV)";
    const result = await sendEmail({ intendedTo, subject, body });
    s.logEmail({
      candidateId: d.candidateId,
      type: "rejection",
      intendedTo,
      actualTo: result.actualTo,
      subject: result.subject,
      body,
      status: result.status,
      providerId: result.providerId,
      error: result.error,
    });
    sent.push({ candidateId: d.candidateId, status: result.status });
  }

  return Response.json({ ok: true, count: sent.length, sent });
}
