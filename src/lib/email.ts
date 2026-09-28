/**
 * Sends email through Postmark's HTTP API. Used for sign-in links and trip notifications.
 * Needs POSTMARK_SERVER_TOKEN, EMAIL_FROM and (optionally) POSTMARK_MESSAGE_STREAM.
 */
export type Email = {
  to: string;
  subject: string;
  text: string;
  html: string;
  tag?: string;
};

export async function sendEmail({ to, subject, text, html, tag }: Email): Promise<void> {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  const from = process.env.EMAIL_FROM;
  if (!token || !from) throw new Error("POSTMARK_SERVER_TOKEN and EMAIL_FROM must be set");

  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: from,
      To: to,
      Subject: subject,
      TextBody: text,
      HtmlBody: html,
      Tag: tag,
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM ?? "outbound",
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { ErrorCode?: number; Message?: string };
    throw new Error(`Postmark send failed (${res.status}, code ${body.ErrorCode}): ${body.Message}`);
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function signInEmail(url: string): Pick<Email, "subject" | "text" | "html"> {
  const safeUrl = escapeHtml(url);
  return {
    subject: "Your Trip Planner sign-in link",
    text: `Sign in to Trip Planner:\n${url}\n\nThe link works once and expires in 24 hours. If you didn't ask for it, ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f5f4;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1c1917">
<table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
<tr><td>
<h1 style="margin:0 0 16px;font-size:20px">Sign in to Trip Planner</h1>
<p style="margin:0 0 24px;line-height:1.5">Tap the button to sign in. The link works once and expires in 24 hours.</p>
<p style="margin:0 0 24px"><a href="${safeUrl}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:14px 24px;border-radius:8px;font-weight:600">Sign in</a></p>
<p style="margin:0;font-size:13px;color:#57534e;line-height:1.5">If you didn't ask for this, ignore this email.</p>
</td></tr></table></body></html>`,
  };
}
