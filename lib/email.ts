// Resend wrapper. Gracefully no-ops if RESEND_API_KEY is missing so the rest
// of the app keeps working when the email path isn't fully configured.

import { Resend } from "resend";

let _resend: Resend | null | undefined;

function getResend(): Resend | null {
  if (_resend !== undefined) return _resend;
  const key = process.env.RESEND_API_KEY?.trim();
  _resend = key ? new Resend(key) : null;
  return _resend;
}

export interface SendEmailArgs {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;          // defaults to RESEND_FROM_EMAIL or "The Terminal <onboarding@resend.dev>"
  replyTo?: string;
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const client = getResend();
  if (!client) {
    return { ok: false, skipped: true, reason: "RESEND_API_KEY not set" };
  }
  const from = args.from ?? process.env.RESEND_FROM_EMAIL?.trim() ?? "The Terminal <onboarding@resend.dev>";
  try {
    const { data, error } = await client.emails.send({
      from,
      to: Array.isArray(args.to) ? args.to : [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
      replyTo: args.replyTo,
    });
    if (error) {
      return { ok: false, error: error.message ?? String(error) };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}
