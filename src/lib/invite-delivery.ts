// Invitation delivery.
//
// The repository has no production email provider, so this module keeps a single narrow
// integration point and is explicit about what is not wired up:
//
//   * INVITE_EMAIL_WEBHOOK_URL set -> the link is POSTed to that endpoint (transactional
//     email service, SES bridge, or an internal mailer). Only that service sees the token.
//   * development -> the link is returned to the inviter only, so a local stack can complete
//     the acceptance flow without any provider. It is never returned to the invitee.
//   * production with no webhook configured -> delivery reports "unavailable". The
//     invitation still exists, and the API response tells the operator to configure a
//     provider. Production delivery is reported as incomplete in the handoff notes.
//
// The raw token must never be logged. Only the recipient address and a channel name appear
// in any log line here.

import { invitationPath } from "./invitations";

export type InvitationDelivery =
  | { channel: "webhook"; sent: true }
  | { channel: "webhook-failed" }
  | { channel: "development-link"; path: string }
  | { channel: "unavailable" };

function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";
  return configured.replace(/\/$/, "");
}

export function isDevelopmentDelivery(): boolean {
  return process.env.NODE_ENV !== "production";
}

export async function deliverInvitation(input: {
  token: string | null;
  email: string;
  targetName: string;
  inviterId: string;
}): Promise<InvitationDelivery> {
  const webhook = process.env.INVITE_EMAIL_WEBHOOK_URL;

  if (webhook) {
    if (!input.token) return { channel: "development-link", path: invitationPath("re-send-required") };
    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: input.email,
          subject: "You have been invited to Runes AI",
          url: appUrl() + invitationPath(input.token),
          scope: input.targetName,
        }),
      });
      return response.ok ? { channel: "webhook", sent: true } : { channel: "webhook-failed" };
    } catch {
      // No token or address in the log: the failure is reported to the caller instead.
      return { channel: "webhook-failed" };
    }
  }

  if (isDevelopmentDelivery() && input.token) {
    return { channel: "development-link", path: invitationPath(input.token) };
  }

  return { channel: "unavailable" };
}
