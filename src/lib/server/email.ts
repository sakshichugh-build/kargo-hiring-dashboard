import { Resend } from "resend";

/**
 * Sends one email via Resend — ONLY ever called from an explicit user action
 * (a Send click). There is no auto-send, scheduled send, or auto-reject anywhere
 * in this codebase.
 *
 * EMAIL_MODE=test (default): every email is routed to TEST_RECIPIENT, with the
 * intended recipient shown in the subject. (Resend without a verified domain
 * only delivers to the account owner's address.)
 *
 * If RESEND_API_KEY is unset, we DRY-RUN: nothing is sent, but the attempt is
 * logged so the dashboard and decision log are fully demoable without a key.
 */

export interface SendInput {
  intendedTo: string;
  subject: string;
  body: string;
}

export interface SendOutput {
  status: "sent" | "dry-run" | "failed";
  actualTo: string;
  subject: string;
  providerId: string | null;
  error: string | null;
}

export async function sendEmail(input: SendInput): Promise<SendOutput> {
  const mode = (process.env.EMAIL_MODE || "test").toLowerCase();
  const from = process.env.EMAIL_FROM || "onboarding@resend.dev";
  const testRecipient = process.env.TEST_RECIPIENT || "";
  const apiKey = process.env.RESEND_API_KEY;

  const isTest = mode !== "live";
  const actualTo = isTest ? testRecipient : input.intendedTo;
  const subject = isTest ? `[TEST → ${input.intendedTo}] ${input.subject}` : input.subject;

  if (!apiKey) {
    return { status: "dry-run", actualTo: actualTo || "(no TEST_RECIPIENT set)", subject, providerId: null, error: null };
  }
  if (!actualTo) {
    return { status: "failed", actualTo: "", subject, providerId: null, error: "No recipient (set TEST_RECIPIENT for test mode)." };
  }

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: actualTo,
      subject,
      text: input.body,
    });
    if (error) return { status: "failed", actualTo, subject, providerId: null, error: error.message };
    return { status: "sent", actualTo, subject, providerId: data?.id ?? null, error: null };
  } catch (e) {
    return { status: "failed", actualTo, subject, providerId: null, error: e instanceof Error ? e.message : String(e) };
  }
}
