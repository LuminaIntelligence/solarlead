/**
 * Impressum Scraper — kostenloser Fallback-Contact-Provider für deutsche Firmen.
 *
 * Strategie (in Reihenfolge):
 * 1. Homepage laden → Impressum/Kontakt-Link dynamisch entdecken
 * 2. Bekannte Pfade ausprobieren (/impressum, /kontakt, etc.)
 * 3. HTML nach mailto-Links, data-email, Klartext-E-Mails durchsuchen
 * 4. Obfuskierte E-Mails erkennen: info[at]firma.de, info (at) firma DOT de
 * 5. http:// Fallback wenn https:// scheitert
 *
 * Deutsche Firmen haben Impressumspflicht (§5 TMG) — dort steht meist die E-Mail.
 */

import type { ContactProvider, ContactQuery, ContactResult } from "./types";

export interface ScraperDebugLog {
  tried_urls: string[];
  found_on_url: string | null;
  emails_raw: string[];
  error?: string;
}

// Pfade die wir ausprobieren (in Reihenfolge, nach Homepage-Scan)
const IMPRESSUM_PATHS = [
  "/impressum",
  "/impressum/",
  "/impressum.html",
  "/impressum.php",
  "/de/impressum",
  "/ueber-uns/impressum",
  "/about/impressum",
  "/rechtliches/impressum",
  "/legal-notice",
  "/legal",
  "/kontakt",
  "/kontakt/",
  "/kontakt.html",
  "/contact",
  "/contact.html",
  "/contact-us",
  "/ueber-uns",
  "/ueber-uns/kontakt",
  "/about",
  "/about-us",
];

// E-Mail-Regex — erkennt typische deutsche Firmen-Mails
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Diese E-Mails ignorieren — generische/System-Adressen
const IGNORE_PREFIXES = [
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "mailer", "bounce", "postmaster", "webmaster",
  "support", "help", "abuse", "spam",
  "datenschutz", "privacy", "dsgvo",
  "newsletter", "marketing", "sales@sales",
];

// Domains die wir als fremde Domains ignorieren
const IGNORE_DOMAINS = [
  "example.com", "sentry.io", "googleapis.com", "gstatic.com",
  "cloudflare.com", "facebook.com", "twitter.com", "instagram.com",
  "linkedin.com", "xing.com", "google.com", "w3.org",
  "schema.org", "ogp.me", "apple.com", "microsoft.com",
];

// Keywords die auf einen Impressum/Kontakt-Link hinweisen
const IMPRESSUM_LINK_KEYWORDS = [
  "impressum", "legal-notice", "legal notice", "rechtliches",
  "kontakt", "contact", "über uns", "ueber-uns",
];

// Titel-Keywords die auf Entscheider hinweisen
const DECISION_MAKER_KEYWORDS = [
  "geschäftsführer", "geschäftsführerin", "inhaber", "inhaberin",
  "ceo", "cto", "cfo", "coo",
  "managing director", "director",
  "leiter", "leiterin", "chef", "chefin",
  "vorstand", "vorständin", "gesellschafter",
  "eigentümer", "eigentümerin", "prokurist", "prokuristen",
];

function isIgnoredEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const local = lower.split("@")[0];
  const domain = lower.split("@")[1] ?? "";
  if (IGNORE_PREFIXES.some((p) => local.startsWith(p))) return true;
  if (IGNORE_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) return true;
  return false;
}

/** Deobfuskiert gängige deutsche E-Mail-Verschlüsselungen */
function deobfuscateEmails(text: string): string[] {
  const results: string[] = [];

  // info[at]firma.de  /  info (at) firma.de  /  info{at}firma.de
  for (const m of text.matchAll(/([a-zA-Z0-9._%+\-]+)\s*[\[\(\{]at[\]\)\}]\s*([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi)) {
    results.push(`${m[1]}@${m[2]}`.toLowerCase());
  }

  // info AT firma DOT de  /  info at firma dot de
  for (const m of text.matchAll(/([a-zA-Z0-9._%+\-]+)\s+(?:AT|at)\s+([a-zA-Z0-9.\-]+)\s+(?:DOT|dot|PUNKT|punkt)\s+([a-zA-Z]{2,})/g)) {
    results.push(`${m[1]}@${m[2]}.${m[3]}`.toLowerCase());
  }

  // Leerzeichen statt @ (häufig in Bildalternativen): info @ firma.de
  for (const m of text.matchAll(/([a-zA-Z0-9._%+\-]+)\s+@\s+([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g)) {
    results.push(`${m[1]}@${m[2]}`.toLowerCase());
  }

  // CF7-Obfuskierung: &#105;&#110;&#102;&#111; (HTML entities)
  // Entitäten zuerst dekodieren und dann nochmal checken
  const decoded = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
  for (const m of decoded.matchAll(EMAIL_REGEX)) {
    if (!isIgnoredEmail(m[0])) results.push(m[0].toLowerCase());
  }

  return results.filter((e) => !isIgnoredEmail(e));
}

function extractTitle(html: string, email: string): string | null {
  const idx = html.toLowerCase().indexOf(email.toLowerCase());
  if (idx === -1) return null;
  const context = html
    .slice(Math.max(0, idx - 400), idx + 200)
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  for (const kw of DECISION_MAKER_KEYWORDS) {
    if (context.includes(kw)) {
      const match = context.match(new RegExp(`(${kw}[\\w\\s/-]{0,40})`, "i"));
      if (match) return match[1].trim();
      return kw.charAt(0).toUpperCase() + kw.slice(1);
    }
  }
  return null;
}

function extractName(html: string, email: string): string | null {
  // E-Mail-Prefix als Name: max.mustermann@firma.de → Max Mustermann
  const local = email.split("@")[0];
  if (local.includes(".")) {
    const parts = local.split(".");
    if (parts.length === 2 && parts[0].length > 1 && parts[1].length > 1) {
      return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
    }
  }

  // Suche nach Vorname Nachname vor der E-Mail
  const idx = html.indexOf(email);
  if (idx === -1) return null;
  const before = html
    .slice(Math.max(0, idx - 200), idx)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = before.split(" ").filter((w) => w.length > 2 && /^[A-ZÄÖÜ]/.test(w));
  if (words.length >= 2) return words.slice(-2).join(" ");
  return null;
}

async function fetchPage(url: string, timeoutMs = 10000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "de-DE,de;q=0.9,en;q=0.5",
        "Cache-Control": "no-cache",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("text/plain")) return null;
    const text = await res.text();
    return text.length > 10 ? text : null;
  } catch {
    return null;
  }
}

/** Versucht https:// und http:// */
async function fetchPageWithFallback(url: string): Promise<string | null> {
  const html = await fetchPage(url);
  if (html) return html;
  // http:// Fallback
  if (url.startsWith("https://")) {
    return await fetchPage(url.replace("https://", "http://"));
  }
  return null;
}

/** Sucht auf der Homepage nach Impressum/Kontakt-Links */
function findImpressumLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  const base = baseUrl.replace(/\/$/, "");

  // href-Attribute mit Impressum-Keywords
  for (const m of html.matchAll(/href=["']([^"'#][^"']*(?:impressum|legal|kontakt|contact|ueber-uns|about)[^"']*)["']/gi)) {
    const href = m[1].trim();
    if (href.startsWith("http")) {
      links.push(href);
    } else if (href.startsWith("/")) {
      links.push(`${base}${href}`);
    } else if (!href.startsWith("mailto:") && !href.startsWith("tel:")) {
      links.push(`${base}/${href}`);
    }
  }

  // Link-Text mit Impressum-Keywords (href zuerst extrahieren)
  for (const m of html.matchAll(/href=["']([^"'#][^"']*)["'][^>]*>([^<]{1,40})<\/a>/gi)) {
    const href = m[1].trim();
    const text = m[2].toLowerCase().trim();
    if (IMPRESSUM_LINK_KEYWORDS.some((kw) => text.includes(kw))) {
      if (href.startsWith("http")) {
        links.push(href);
      } else if (href.startsWith("/")) {
        links.push(`${base}${href}`);
      }
    }
  }

  return [...new Set(links)];
}

function extractEmailsFromHtml(html: string): string[] {
  const found = new Set<string>();

  // 1. mailto: Links (höchste Priorität)
  for (const m of html.matchAll(/href=["']mailto:([^"'?&\s]+)/gi)) {
    const email = m[1].trim().toLowerCase();
    if (email.includes("@") && !isIgnoredEmail(email)) found.add(email);
  }

  // 2. data-email / data-cfemail Attribute
  for (const m of html.matchAll(/data-(?:email|cfemail|mail)=["']([^"']+)["']/gi)) {
    const val = m[1].trim().toLowerCase();
    if (val.includes("@") && !isIgnoredEmail(val)) found.add(val);
  }

  // 3. Plaintext E-Mails
  const stripped = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const m of stripped.matchAll(EMAIL_REGEX)) {
    const email = m[0].toLowerCase();
    if (!isIgnoredEmail(email)) found.add(email);
  }

  // 4. Obfuskierte E-Mails
  for (const email of deobfuscateEmails(html)) {
    if (!isIgnoredEmail(email)) found.add(email);
  }

  return Array.from(found);
}

export class ImpressumScraperProvider implements ContactProvider {
  name = "impressum_scraper";

  async findContacts(
    query: ContactQuery,
    debug?: ScraperDebugLog
  ): Promise<ContactResult> {
    const rawDomain = query.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    // Normalisierung: www. hinzufügen wenn kein Subdomain vorhanden
    const domain = rawDomain;
    const baseUrl = `https://${domain}`;

    const log: ScraperDebugLog = debug ?? { tried_urls: [], found_on_url: null, emails_raw: [] };
    const allEmails: { email: string; source_url: string; html: string }[] = [];

    // ── Schritt 1: Homepage laden und Impressum-Link suchen ──────────────────
    const homepageHtml = await fetchPageWithFallback(baseUrl);
    log.tried_urls.push(baseUrl);

    let discoveredUrls: string[] = [];
    if (homepageHtml) {
      discoveredUrls = findImpressumLinks(homepageHtml, baseUrl);
      // Auch www-Variante versuchen
      if (discoveredUrls.length === 0 && !domain.startsWith("www.")) {
        const wwwHtml = await fetchPageWithFallback(`https://www.${domain}`);
        log.tried_urls.push(`https://www.${domain}`);
        if (wwwHtml) {
          discoveredUrls = findImpressumLinks(wwwHtml, `https://www.${domain}`);
        }
      }
    } else {
      // https scheiterte — www Fallback versuchen
      const wwwHtml = await fetchPageWithFallback(`https://www.${domain}`);
      log.tried_urls.push(`https://www.${domain}`);
      if (wwwHtml) {
        discoveredUrls = findImpressumLinks(wwwHtml, `https://www.${domain}`);
      }
    }

    // ── Schritt 2: Entdeckte Impressum-Links zuerst prüfen ───────────────────
    const urlsToTry: string[] = [
      ...discoveredUrls,
      ...IMPRESSUM_PATHS.map((p) => `${baseUrl}${p}`),
    ];

    // Deduplizieren
    const seen = new Set<string>();
    const uniqueUrls = urlsToTry.filter((u) => {
      if (seen.has(u)) return false;
      seen.add(u);
      return true;
    });

    for (const url of uniqueUrls) {
      if (log.tried_urls.includes(url)) {
        // Bereits geladen (z.B. Homepage)
      }
      log.tried_urls.push(url);

      const html = await fetchPageWithFallback(url);
      if (!html) continue;

      const emails = extractEmailsFromHtml(html);
      if (emails.length > 0) {
        for (const email of emails) {
          const emailDomain = email.split("@")[1] ?? "";
          const baseDomain = domain.replace(/^www\./, "");
          const isOwnDomain =
            emailDomain === baseDomain ||
            emailDomain === `www.${baseDomain}` ||
            baseDomain.endsWith(emailDomain) ||
            emailDomain.endsWith(baseDomain);

          // Eigene Domain priorisieren, fremde auch aufnehmen
          if (isOwnDomain || allEmails.length === 0) {
            allEmails.push({ email, source_url: url, html });
          } else {
            allEmails.push({ email, source_url: url, html });
          }
        }

        // Auf Impressum/Kontakt-Seite gefunden → reicht
        const urlLower = url.toLowerCase();
        if (
          urlLower.includes("impressum") ||
          urlLower.includes("kontakt") ||
          urlLower.includes("legal") ||
          urlLower.includes("contact")
        ) {
          log.found_on_url = url;
          break;
        }
      }
    }

    log.emails_raw = [...new Set(allEmails.map((e) => e.email))];

    if (allEmails.length === 0) {
      console.log(`[ImpressumScraper] Keine E-Mails gefunden für ${domain} (${log.tried_urls.length} URLs versucht)`);
      return { contacts: [], company: null };
    }

    // Deduplizieren und in Contacts umwandeln
    const seenEmails = new Set<string>();
    const contacts = [];

    // Eigene-Domain-E-Mails zuerst
    const sorted = [...allEmails].sort((a, b) => {
      const baseDomain = domain.replace(/^www\./, "");
      const aOwn = a.email.split("@")[1]?.endsWith(baseDomain) ? 0 : 1;
      const bOwn = b.email.split("@")[1]?.endsWith(baseDomain) ? 0 : 1;
      return aOwn - bOwn;
    });

    for (const { email, html } of sorted) {
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);

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
      `[ImpressumScraper] ${contacts.length} E-Mail(s) für ${domain} (gefunden auf: ${log.found_on_url ?? "unbekannt"}): ${contacts.map((c) => c.email).join(", ")}`
    );

    return { contacts, company: null };
  }
}
