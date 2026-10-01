import { callClaudeJson } from "../claude";
import { cacheGet, cacheSet } from "../cache";
import { CRITERIA } from "../rubric";
import { BriefEmailSchema, type BriefEmail, type Profile, type ComputedScores } from "../types";

const PROMPT_VERSION = "brief-v1";

export const BRIEF_SYSTEM = `You prepare an interview brief and two draft emails for Kargo's founder, Arjun Mehta, about one candidate. You get the candidate's professional profile, their rubric scores, and which criteria are WEAKEST. No personal details beyond a first-name placeholder.

Produce:
1. probe_questions: 3–5 sharp interview questions, each tied to the candidate's WEAKEST rubric criteria — questions that would confirm or kill the doubt. Specific to this person's background, not generic.
2. invite_body: a warm, specific email inviting them to talk. Reference something concrete from their actual experience. No fake promises, no fabricated detail. Begin "Hi {{first_name}}," and sign exactly:
Arjun Mehta
Founder, Kargo
3. rejection_body: a warm, respectful decline. Specific enough that it clearly isn't a form letter, honest, no false "we'll keep you on file" promises unless neutral. Begin "Hi {{first_name}}," and sign exactly:
Arjun Mehta
Founder, Kargo
4. invite_subject and rejection_subject: short, human subject lines.

Write like a founder who read the CV himself — direct, specific, no HR boilerplate, no buzzwords.

Respond with ONLY this JSON (no prose, no fences):
{"probe_questions": ["..."], "invite_subject": "...", "invite_body": "...", "rejection_subject": "...", "rejection_body": "..."}`;

function weakestCriteria(s: ComputedScores): string[] {
  const entries = [
    { name: CRITERIA[0].name, score: s.crit.operations_exposure.score },
    { name: CRITERIA[1].name, score: s.crit.self_started_build.score },
    { name: CRITERIA[2].name, score: s.crit.ownership_without_structure.score },
    { name: CRITERIA[3].name, score: s.crit.ships_kills_learns.score },
  ];
  return entries.sort((a, b) => a.score - b.score).slice(0, 2).map((e) => `${e.name} (scored ${e.score}/3)`);
}

function mockBriefEmail(role: string, weakest: string[]): BriefEmail {
  return {
    probe_questions: [
      `Walk me through a time your work put you inside ${weakest[0]?.includes("operations") ? "a freight/logistics operation" : "the day-to-day operation"} — what did you actually do?`,
      `Tell me about something you built that nobody asked for. Did anyone else end up using it?`,
      `Describe a product or feature you killed. What was the signal, and how fast did you act?`,
    ],
    invite_subject: `Kargo — let's talk about the ${role} role`,
    invite_body: `Hi {{first_name}},\n\nI read your CV myself and a few things stood out — I'd like to talk. Could we find 30 minutes this week?\n\nArjun Mehta\nFounder, Kargo`,
    rejection_subject: `Kargo — update on your application`,
    rejection_body: `Hi {{first_name}},\n\nThank you for applying to Kargo and for the time you put in. After a close read, we're not moving forward for this role — the fit with what we need right now isn't quite there. I genuinely appreciated your interest.\n\nArjun Mehta\nFounder, Kargo`,
  };
}

export async function briefAndEmail(
  id: string,
  profileHash: string,
  profile: Profile,
  scores: ComputedScores,
  role: "pm" | "spm",
): Promise<BriefEmail> {
  const cacheKey = `${PROMPT_VERSION}-${profileHash}-${role}`;
  const cached = cacheGet<BriefEmail>(cacheKey);
  if (cached) return cached;

  const weakest = weakestCriteria(scores);
  const roleName = role === "spm" ? "Senior Product Manager" : "Product Manager";

  const result = await callClaudeJson<BriefEmail>({
    callType: "brief-email",
    subjectId: id,
    system: BRIEF_SYSTEM,
    user: `ROLE BEING CONSIDERED: ${roleName}\n\nWEAKEST CRITERIA (target probe questions here): ${weakest.join("; ")}\n\nRUBRIC RATIONALE: ${scores.rationale}\n\nRED FLAGS: ${scores.redFlags.join("; ") || "none"}\n\nPROFILE:\n${JSON.stringify(profile, null, 2)}`,
    schema: BriefEmailSchema,
    maxTokens: 4000,
    effort: "medium",
    mock: () => mockBriefEmail(roleName, weakest),
  });

  cacheSet(cacheKey, result);
  return result;
}
