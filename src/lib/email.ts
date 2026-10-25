// One place that decides what an email address means, so invitations, sign-in, and share
// lists all compare the same normalised form.

/** Trims and lower-cases. Display names keep their own casing; lookups never do. */
export function normalizeEmail(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const normalized = normalizeEmail(value);
  if (normalized.length === 0 || normalized.length > 254) return false;
  if (!normalized.includes("@")) return false;
  const [local, domain, ...rest] = normalized.split("@");
  if (rest.length > 0) return false;
  if (local.length === 0 || local.length > 64) return false;
  if (domain.length < 4 || !domain.includes(".")) return false;
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local);
}

/** Deterministic display name for share lists and audit output. */
export function displayName(user: { email: string; firstName?: string | null; lastName?: string | null }): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : user.email;
}
