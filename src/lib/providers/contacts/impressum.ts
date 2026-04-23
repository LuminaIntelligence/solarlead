/**
 * Impressum Scraper — kostenloser Fallback-Contact-Provider für deutsche Firmen.
 *
 * Strategie:
 * 1. Bekannte Impressum-Pfade ausprobieren (/impressum, /kontakt, etc.)
 * 2. HTML nach mailto:-Links und E-Mail-Mustern durchsuchen
 * 3. Ergebnis als Contact mit source="impressum" zurückgeben
 *
 * Warum das funktioniert: Deutsche Firmen haben Impressumspflicht (§5 TMG).
 * Dort steht oft direkt die E-Mail des Inhabers / Geschäftsführers.
 */

import type { ContactProvider, ContactQuery, ContactResult } from "./types";

// Pfade die wir ausprobieren (in Reihenfolge)
const IMPRESSUM_PATHS = [
  "/impressum",
  "/impressum.html",
  "/impressum.php",
  "/impressum/",
  "/legal-notice",
  "/legal",
  "/about/impressum",
  "/ueber-uns/impressum",
  "/kontakt",
  "/contact",
  "/kontakt.html",
  "/contact.html",
];

// E-Mail-Regex — erkennt typische deutsche Firmen-Mails
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Diese E-Mails ignorieren — generische/System-Adressen
const IGNORE_PREFIXES = [
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "mailer", "bounce", "postmaster", "webmaster",
  "support", "help", "abuse", "spam",
  "datenschutz", "privacy", "dsgvo",
];

// Titel-Keywords die auf Entscheider hinweisen (für spätere Anreicherung)
const DECISION_MAKER_KEYWORDS = [
  "geschäftsführer", "inhaber", "ceo", "cto", "cfo",
  "managing director", "director", "leiter", "chef",
  "vorstand", "gesellschafter", "eigentümer",
];

function isIgnoredEmail(email: string): boolean {
  const local = email.split("@")[0].toLowerCase();
  return IGNORE_PREFIXES.some((prefix) => local.startsWith(prefix));
}

function extractTitle(html: string, email: string): string | null {
  // Suche nach Entscheider-Keywords in der Nähe der E-Mail (±300 Zeichen)
  const idx = html.toLowerCase().indexOf(email.toLowerCase());
  if (idx === -1) return null;
  const context = html
    .slice(Math.max(0, idx - 300), idx + 300)
    .toLowerCase()
    .replace(/<[^>]+>/g, " "); // Tags entfernen

  for (const kw of DECISION_MAKER_KEYWORDS) {
    if (context.includes(kw)) {
      // Versuche den Titel-Text zu extrahieren
      const match = context.match(new RegExp(`(${kw}[\\w\\s/-]{0,40})`, "i"));
      if (match) return match[1].trim();
      return kw.charAt(0).toUpperCase() + kw.slice(1);
    }
  }
  return null;
}

function extractName(html: string, email: string): string | null {
  // E-Mail-Prefix oft == Name (z.B. max.mustermann@firma.de → Max Mustermann)
  const local = email.split("@")[0];
  if (local.includes(".")) {
    const parts = local.split(".");
    if (parts.length === 2 && parts[0].length > 1 && parts[1].length > 1) {
      return parts
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(" ");
    }
  }

  // Suche nach Name vor/nach der E-Mail im HTML
  const idx = html.indexOf(email);
  if (idx === -1) return null;
  const before = html
    .slice(Math.max(0, idx - 150), idx)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Letztes Wortpaar vor der E-Mail als möglicher Name
  const words = before.split(" ").filter((w) => w.length > 1 && /^[A-ZÄÖÜ]/.test(w));
  if (words.length >= 2) {
    return words.slice(-2).join(" ");
  }
  return null;
}

async function fetchPage(url: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SolarLead-Bot/1.0; contact: info@solarlead.de)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();

  // 1. mailto: Links (höchste Priorität — explizit verlinkt)
  const mailtoMatches = html.matchAll(/href=["']mailto:([^"'?]+)/gi);
  for (const m of mailtoMatches) {
    const email = m[1].trim().toLowerCase();
    if (email.includes("@") && !isIgnoredEmail(email)) {
      found.add(email);
    }
  }

  // 2. Obfuscated mailto (z.B. data-email Attribute)
  const dataEmailMatches = html.matchAll(/data-email=["']([^"']+)["']/gi);
  for (const m of dataEmailMatches) {
    const email = m[1].trim().toLowerCase();
    if (email.includes("@") && !isIgnoredEmail(email)) {
      found.add(email);
    }
  }

  // 3. Plaintext E-Mails im sichtbaren Text
  const stripped = html.replace(/<[^>]+>/g, " ");
  const textMatches = stripped.matchAll(EMAIL_REGEX);
  for (const m of textMatches) {
    const email = m[0].toLowerCase();
    if (!isIgnoredEmail(email)) {
      found.add(email);
    }
  }

  return Array.from(found);
}

export class ImpressumScraperProvider implements ContactProvider {
  name = "impressum_scraper";

  async findContacts(query: ContactQuery): Promise<ContactResult> {
    const domain = query.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    const baseUrl = `https://${domain}`;

    const allEmails: { email: string; source_url: string; html: string }[] = [];

    // Alle Impressum-Pfade durchprobieren
    for (const path of IMPRESSUM_PATHS) {
      const url = `${baseUrl}${path}`;
      const html = await fetchPage(url);
      if (!html) continue;

      const emails = extractEmailsFromHtml(html);
      for (const email of emails) {
        // Nur Emails der eigenen Domain bevorzugen
        const emailDomain = email.split("@")[1];
        if (emailDomain && (domain.endsWith(emailDomain) || emailDomain.endsWith(domain.replace(/^www\./, "")))) {
          allEmails.push({ email, source_url: url, html });
        } else {
          // Fremde Domain (z.B. gmail.com) auch aufnehmen, aber niedriger prio
          allEmails.push({ email, source_url: url, html });
        }
      }

      // Wenn wir E-Mails auf Impressum/Kontakt-Seite gefunden haben, reicht das
      if (allEmails.length > 0 && (path.includes("impressum") || path.includes("kontakt"))) {
        break;
      }
    }

    if (allEmails.length === 0) {
      console.log(`[ImpressumScraper] Keine E-Mails gefunden für ${domain}`);
      return { contacts: [], company: null };
    }

    // Deduplizieren und in Contacts umwandeln
    const seen = new Set<string>();
    const contacts = [];

    for (const { email, html } of allEmails) {
      if (seen.has(email)) continue;
      seen.add(email);

      const title = extractTitle(html, email);
      const name = extractName(html, email);

      contacts.push({
        apollo_id: null,
        name: name ?? query.company_name,
        title: title ?? "Kontakt",
        email,
        phone: null,
        linkedin_url: null,
        seniority: title ? "senior" : null,
        department: null,
      });
    }

    console.log(
      `[ImpressumScraper] ${contacts.length} E-Mail(s) für ${domain}: ${contacts.map((c) => c.email).join(", ")}`
    );

    return { contacts, company: null };
  }
}
