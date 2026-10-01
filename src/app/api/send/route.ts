import { getStorage } from "@/lib/server/storage";
import { sendEmail } from "@/lib/server/email";
import { getCandidate } from "@/lib/data";

export const dynamic = "force-dynamic";

/** Sends one email — invoked ONLY by an explicit Send click in the UI. */
export async function POST(request: Request) {
  const { candidateId, type, subject, body } = (await request.json()) as {
    candidateId?: string;
    type?: "invite" | "rejection";
    subject?: string;
    body?: string;
  };
  if (!candidateId || (type !== "invite" && type !== "rejection") || !subject || !body) {
    return Response.json({ error: "candidateId, type (invite|rejection), subject, body required" }, { status: 400 });
  }
  const cand = getCandidate(candidateId);
  if (!cand) return Response.json({ error: "unknown candidate" }, { status: 404 });

  const intendedTo = cand.pii.email || "(no email on CV)";
  const result = await sendEmail({ intendedTo, subject, body });

  const email = getStorage().logEmail({
    candidateId,
    type,
    intendedTo,
    actualTo: result.actualTo,
    subject: result.subject,
    body,
    status: result.status,
    providerId: result.providerId,
    error: result.error,
  });

  return Response.json({ ok: result.status !== "failed", email });
}
