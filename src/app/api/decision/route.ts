import { getStorage, type Decision, type RoleChoice } from "@/lib/server/storage";
import { getCandidate } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { candidateId?: string; decision?: Decision; role?: RoleChoice | null; rationale?: string };
  const { candidateId, decision } = body;
  if (!candidateId || !decision || !["forward", "pass", "pending"].includes(decision)) {
    return Response.json({ error: "candidateId and a valid decision are required" }, { status: 400 });
  }
  const cand = getCandidate(candidateId);
  if (!cand) return Response.json({ error: "unknown candidate" }, { status: 404 });

  // Record the rubric rationale alongside the human decision for the audit log.
  const rationale = body.rationale ?? cand.scores?.rationale ?? "";
  const record = getStorage().setDecision(candidateId, decision, body.role ?? null, rationale);
  return Response.json({ ok: true, decision: record });
}
