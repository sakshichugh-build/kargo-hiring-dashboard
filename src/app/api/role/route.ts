import { getStorage, type RoleChoice } from "@/lib/server/storage";
import { getCandidate } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { candidateId, role } = (await request.json()) as { candidateId?: string; role?: RoleChoice };
  if (!candidateId || (role !== "pm" && role !== "spm")) {
    return Response.json({ error: "candidateId and role (pm|spm) required" }, { status: 400 });
  }
  if (!getCandidate(candidateId)) return Response.json({ error: "unknown candidate" }, { status: 404 });
  getStorage().setRole(candidateId, role);
  return Response.json({ ok: true });
}
