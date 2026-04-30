/**
 * Lease / Pacht utilities — single source of truth for all email templates.
 *
 * Business rule (GreenScout e.V.):
 *   Estimated annual roof lease = 4 € per m² of total roof area,
 *   rounded to the nearest 500 € increment.
 *
 *   Example: 1 200 m²  →  1200 × 4 = 4 800  →  rounded to 5 000 €/year
 *
 * Both the copy-to-clipboard/mailto path (greenscout-email-templates.tsx)
 * and the Mailgun send path (providers/email/templates.ts) import from here
 * so recipients always see the same figure regardless of how the email is sent.
 */

/** Formats annual lease estimate as a German-locale number string (no € symbol). */
export function formatLease(roofAreaM2: number): string {
  const raw = roofAreaM2 * 4;
  const rounded = Math.round(raw / 500) * 500;
  return rounded.toLocaleString("de-DE");
}

/** Formats a roof area as a rounded, German-locale number string (no unit). */
export function formatArea(m2: number): string {
  return Math.round(m2).toLocaleString("de-DE");
}
