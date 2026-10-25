// Invitation link delivery.
//
// The repository has no production email provider, so this module is deliberately honest about
// what it can do: in development it reports the link back to the inviter through the API, and in
// production it refuses to pretend a message was sent. Adding a provider means implementing
// `sendEmail` below and setting INVITE_EMAIL_FROM; nothing else in the product changes.
//
// A live token is never written to a log, a database column or a file. Only the inviter receives
// it, once, in the response that created the invitation.

export type DeliveryResult =
  | { delivered: true; channel: 'email' }
  | { delivered: false; reason: 'not-configured' | 'disabled' | 'send-failed' };

export function invitationBaseUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || '').trim();
  return configured.replace(/\/+$/, '') || 'http://localhost:3000';
}

/** Builds the acceptance link. The token stays in the fragment-free path so it is a normal route. */
export function invitationUrl(token: string): string {
  return invitationBaseUrl() + '/invite/' + encodeURIComponent(token);
}

/** True only when an operator has actually configured a sender address. */
export function emailDeliveryConfigured(): boolean {
  return (process.env.INVITE_EMAIL_FROM || '').trim().length > 0;
}

export function canShowInviteLinkToInviter(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.INVITE_LINK_DISPLAY !== '0';
}

async function sendEmail(_input: { to: string; subject: string; body: string }): Promise<boolean> {
  // No provider is wired up. Return false so the caller reports the truth instead of a lie.
  return false;
}

export async function deliverInvitation(input: {
  to: string;
  inviterName: string;
  targetLabel: string;
  token: string;
}): Promise<DeliveryResult> {
  if (!emailDeliveryConfigured()) return { delivered: false, reason: 'not-configured' };
  const sent = await sendEmail({
    to: input.to,
    subject: input.inviterName + ' shared "' + input.targetLabel + '" with you',
    body: 'Open ' + invitationUrl(input.token) + ' to accept view access.',
  });
  return sent ? { delivered: true, channel: 'email' } : { delivered: false, reason: 'send-failed' };
}
