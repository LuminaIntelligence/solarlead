/**
 * Lease / Pacht utilities — single source of truth for all email templates.
 *
 * Business rule (GreenScout e.V.):
 *   Estimated annual roof lease = (m² / 5) × 100 €, rounded to nearest 100 €.
 *   Rationale: ~1 panel per 5 m², 100 € lease per panel per year.
 *
 *   Example: 1 000 m²  →  1000 / 5 = 200 panels  →  200 × 100 = 20 000 €/year
 *
 * Both the copy-to-clipboard/mailto path (greenscout-email-templates.tsx)
 * and the Mailgun send path (providers/email/templates.ts) import from here
 * so recipients always see the same figure regardless of how the email is sent.
 */

/** Formats annual lease estimate as a German-locale number string (no € symbol). */
export function formatLease(roofAreaM2: number): string {
  const value = Math.round(roofAreaM2 / 5) * 100;
  return value.toLocaleString("de-DE");
}

/** Formats a roof area as a rounded, German-locale number string (no unit). */
export function formatArea(m2: number): string {
  return Math.round(m2).toLocaleString("de-DE");
}
