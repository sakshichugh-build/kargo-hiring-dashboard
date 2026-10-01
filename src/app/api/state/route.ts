import { getStorage } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = getStorage();
  return Response.json({
    decisions: s.getDecisions(),
    emails: s.getEmails(),
    log: s.getLog(),
    emailMode: (process.env.EMAIL_MODE || "test").toLowerCase(),
    resendConfigured: !!process.env.RESEND_API_KEY,
    testRecipient: process.env.TEST_RECIPIENT || null,
  });
}
