/**
 * Impressum Scraper — kostenloser Fallback-Contact-Provider für deutsche Firmen.
 *
 * Strategie (in Reihenfolge):
 * 1. Homepage laden → Sprach-Basispfad erkennen (/de/, /en/, etc.) + Impressum-Links entdecken
 * 2. Bekannte Pfade ausprobieren inkl. Sprachpräfixe
 * 3. HTML nach mailto-Links, tel:-Links, data-email, Klartext-E-Mails durchsuchen
 * 4. Obfuskierte E-Mails erkennen: info[at]firma.de, info (at) firma DOT de
 * 5. Telefonnummern extrahieren (Tel:, +49, etc.)
 * 6. http:// Fallback wenn https:// scheitert
 */

import type { ContactProvider, ContactQuery, ContactResult } from "./types";

export interface ScraperDebugLog {
  tried_urls: string[];
  found_on_url: string | null;
  emails_raw: string[];
  phones_raw: string[];
  error?: string;
}

// Basis-Pfade (ohne Sprachpräfix) — werden auch mit erkanntem Präfix versucht
const BASE_PATHS = [
  "/impressum",
  "/impressum/",
  "/impressum.html",
  "/impressum.php",
  "/rechtliches/impressum",
  "/ueber-uns/impressum",
  "/about/impressum",
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
];

// Sprachpräfixe die wir berücksichtigen
const LANG_PREFIXES = ["/de", "/en", "/at", "/ch"];

// E-Mail-Regex
const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

// Diese E-Mail-Prefixe ignorieren
const IGNORE_PREFIXES = [
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "mailer", "bounce", "postmaster", "webmaster",
  "support", "help", "abuse", "spam",
  "datenschutz", "privacy", "dsgvo",
  "newsletter", "marketing",
];

// Diese Domains ignorieren
const IGNORE_DOMAINS = [
  "example.com", "sentry.io", "googleapis.com", "gstatic.com",
  "cloudflare.com", "facebook.com", "twitter.com", "instagram.com",
  "linkedin.com", "xing.com", "google.com", "w3.org",
  "schema.org", "ogp.me", "apple.com", "microsoft.com",
];

// Keywords die auf Impressum/Kontakt-Links hinweisen
const IMPRESSUM_LINK_KEYWORDS = [
  "impressum", "legal-notice", "legal notice", "rechtliches",
  "kontakt", "contact", "über uns", "ueber-uns", "about-us",
];

// Entscheider-Keywords
const DECISION_MAKER_KEYWORDS = [
  "geschäftsführer", "geschäftsführerin", "inhaber", "inhaberin",
  "ceo", "cto", "cfo", "coo",
  "managing director", "director",
  "leiter", "leiterin", "chef", "chefin",
  "vorstand", "vorständin", "gesellschafter",
  "eigentümer", "eigentümerin", "prokurist",
];

function isIgnoredEmail(email: string): boolean {
  const lower = email.toLowerCase();
  const local = lower.split("@")[0];
  const domain = lower.split("@")[1] ?? "";
  if (IGNORE_PREFIXES.some((p) => local.startsWith(p))) return true;
  if (IGNORE_DOMAINS.some((d) => domain === d || domain.endsWith("." + d))) return true;
  return false;
}

/** Deutsche und internationale Telefonnummern extrahieren */
function extractPhonesFromHtml(html: string): string[] {
  const found = new Set<string>();

  // 1. tel: href Links (zuverlässigste Quelle)
  for (const m of html.matchAll(/href=["']tel:([^"'\s]+)/gi)) {
    const raw = m[1].replace(/[^\d+\-\s()]/g, "").trim();
    if (raw.length >= 7) found.add(normalizePhone(raw));
  }

  // 2. Text nach Telefon-Keywords (Tel:, Telefon:, Fon:, Phone:, T:)
  const stripped = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const keywordPattern = /(?:Tel(?:efon)?|Fon|Phone|Mobil|Fax)\s*[:.]?\s*([\+\d][\d\s\-\/\(\)\.]{6,20})/gi;
  for (const m of stripped.matchAll(keywordPattern)) {
    const raw = m[1].trim().replace(/\s+/g, " ");
    if (raw.replace(/\D/g, "").length >= 7) {
      found.add(normalizePhone(raw));
    }
  }

  // 3. Bekannte deutsche Muster direkt: +49..., 0\d{3,5}[\s-]\d{3,}
  const phonePattern = /(?:\+49|0049|0)[\s\-]?\(?[\d]{2,5}\)?[\s\-]?[\d]{2,6}[\s\-]?[\d]{0,6}/g;
  for (const m of stripped.matchAll(phonePattern)) {
    const raw = m[0].trim();
    if (raw.replace(/\D/g, "").length >= 8) {
      found.add(normalizePhone(raw));
    }
  }

  // Fax-Nummern herausfiltern (stehen oft direkt nach Fax:)
  const faxPattern = /Fax\s*[:.]?\s*([\+\d][\d\s\-\/\(\)\.]{6,20})/gi;
  const faxNumbers = new Set<string>();
  for (const m of stripped.matchAll(faxPattern)) {
    faxNumbers.add(normalizePhone(m[1].trim()));
  }

  return Array.from(found)
    .filter((p) => !faxNumbers.has(p))
    .filter((p) => p.replace(/\D/g, "").length >= 7)
    .slice(0, 3); // Max 3 Telefonnummern
}

function normalizePhone(raw: string): string {
  // Leerzeichen normalisieren, führende/folgende Zeichen entfernen
  return raw.replace(/\s+/g, " ").replace(/^[\s\-./]+|[\s\-./]+$/g, "").trim();
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

  // Leerzeichen statt @: info @ firma.de
  for (const m of text.matchAll(/([a-zA-Z0-9._%+\-]+)\s+@\s+([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g)) {
    results.push(`${m[1]}@${m[2]}`.toLowerCase());
  }

  // HTML-Entities dekodieren: &#105;&#110;&#102;&#111;...
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
  const local = email.split("@")[0];
  if (local.includes(".")) {
    const parts = local.split(".");
    if (parts.length === 2 && parts[0].length > 1 && parts[1].length > 1) {
      return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
    }
  }

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

async function fetchPage(url: string, timeoutMs = 5000): Promise<string | null> {
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

async function fetchPageWithFallback(url: string): Promise<{ html: string; finalUrl: string } | null> {
  // https:// Versuch
  const html = await fetchPage(url);
  if (html) return { html, finalUrl: url };
  // http:// Fallback
  if (url.startsWith("https://")) {
    const httpUrl = url.replace("https://", "http://");
    const html2 = await fetchPage(httpUrl);
    if (html2) return { html: html2, finalUrl: httpUrl };
  }
  return null;
}

/**
 * Erkennt den Sprach-Basispfad aus der Homepage-URL oder dem HTML.
 * z.B. bkr-regus.de/de/ → basePath = "/de"
 */
function detectLangBasePath(html: string, finalUrl: string): string | null {
  // Aus der finalen URL (nach Redirect)
  const urlPath = new URL(finalUrl).pathname;
  for (const lang of LANG_PREFIXES) {
    if (urlPath.startsWith(lang + "/") || urlPath === lang) {
      return lang;
    }
  }

  // Aus canonical oder hreflang Links
  for (const m of html.matchAll(/hreflang=["']de["'][^>]*href=["']([^"']+)["']/gi)) {
    const href = m[1];
    try {
      const path = new URL(href).pathname;
      for (const lang of LANG_PREFIXES) {
        if (path.startsWith(lang + "/") || path === lang || path === lang + "/") return lang;
      }
    } catch { /* ignore */ }
  }

  // Aus <html lang="de"> + nav-Links die /de/ enthalten
  const deLinks = html.match(/href=["'][^"']*\/de\/[^"']*["']/i);
  if (deLinks) return "/de";

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

  // Link-Text mit Impressum-Keywords
  for (const m of html.matchAll(/href=["']([^"'#][^"']*)["'][^>]*>([^<]{1,50})<\/a>/gi)) {
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

  // 1. mailto: Links
  for (const m of html.matchAll(/href=["']mailto:([^"'?&\s]+)/gi)) {
    const email = m[1].trim().toLowerCase();
    if (email.includes("@") && !isIgnoredEmail(email)) found.add(email);
  }

  // 2. data-email / data-cfemail
  for (const m of html.matchAll(/data-(?:email|cfemail|mail)=["']([^"']+)["']/gi)) {
    const val = m[1].trim().toLowerCase();
    if (val.includes("@") && !isIgnoredEmail(val)) found.add(val);
  }

  // 3. Plaintext
  const stripped = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  for (const m of stripped.matchAll(EMAIL_REGEX)) {
    const email = m[0].toLowerCase();
    if (!isIgnoredEmail(email)) found.add(email);
  }

  // 4. Obfuskiert
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
    const domain = rawDomain;
    const baseHttps = `https://${domain}`;

    const log: ScraperDebugLog = debug ?? { tried_urls: [], found_on_url: null, emails_raw: [], phones_raw: [] };

    type EmailEntry = { email: string; source_url: string; html: string };
    const allEmails: EmailEntry[] = [];
    const allPhones: string[] = [];

    // ── Schritt 1: Homepage laden, Sprach-Basispfad + Links erkennen ─────────
    let detectedBase = baseHttps;
    let langPrefix: string | null = null;

    const homepageResult = await fetchPageWithFallback(baseHttps);
    log.tried_urls.push(baseHttps);

    // www.-Variante falls direkte Domain nicht lädt
    let homepageHtml: string | null = homepageResult?.html ?? null;
    if (!homepageHtml && !domain.startsWith("www.")) {
      const wwwResult = await fetchPageWithFallback(`https://www.${domain}`);
      log.tried_urls.push(`https://www.${domain}`);
      if (wwwResult) {
        homepageHtml = wwwResult.html;
        detectedBase = `https://www.${domain}`;
        langPrefix = detectLangBasePath(wwwResult.html, wwwResult.finalUrl);
      }
    } else if (homepageResult) {
      langPrefix = detectLangBasePath(homepageResult.html, homepageResult.finalUrl);
      if (homepageResult.finalUrl !== baseHttps) {
        detectedBase = new URL(homepageResult.finalUrl).origin;
      }
    }

    // ── Schritt 2: Pfade zusammenbauen ───────────────────────────────────────
    const discoveredLinks = homepageHtml ? findImpressumLinks(homepageHtml, detectedBase) : [];

    // Pfade mit und ohne Sprachpräfix
    const pathsToTry: string[] = [
      ...discoveredLinks,
      ...BASE_PATHS.map((p) => `${detectedBase}${p}`),
    ];

    // Sprachpräfix-Varianten hinzufügen
    if (langPrefix) {
      for (const p of BASE_PATHS) {
        pathsToTry.push(`${detectedBase}${langPrefix}${p}`);
      }
    } else {
      // Alle Sprachpräfixe als Fallback versuchen (nur für Impressum/Kontakt)
      for (const lp of LANG_PREFIXES) {
        pathsToTry.push(`${detectedBase}${lp}/impressum`);
        pathsToTry.push(`${detectedBase}${lp}/kontakt`);
        pathsToTry.push(`${detectedBase}${lp}/contact`);
      }
    }

    // Deduplizieren
    const seenUrls = new Set<string>(log.tried_urls);
    const uniquePaths = pathsToTry.filter((u) => {
      if (seenUrls.has(u)) return false;
      seenUrls.add(u);
      return true;
    });

    // ── Schritt 3: Jede URL abrufen und auswerten ─────────────────────────────
    for (const url of uniquePaths) {
      log.tried_urls.push(url);
      const result = await fetchPageWithFallback(url);
      if (!result) continue;

      const emails = extractEmailsFromHtml(result.html);
      const phones = extractPhonesFromHtml(result.html);

      if (emails.length > 0 || phones.length > 0) {
        for (const email of emails) {
          allEmails.push({ email, source_url: url, html: result.html });
        }
        allPhones.push(...phones);

        // Auf Impressum/Kontakt-Seite → fertig
        const urlLower = url.toLowerCase();
        if (
          urlLower.includes("impressum") ||
          urlLower.includes("kontakt") ||
          urlLower.includes("legal") ||
          urlLower.includes("contact")
        ) {
          if (!log.found_on_url) log.found_on_url = url;
          if (emails.length > 0) break; // Nur bei E-Mail-Fund stoppen
        }
      }
    }

    log.emails_raw = [...new Set(allEmails.map((e) => e.email))];
    log.phones_raw = [...new Set(allPhones)];

    if (allEmails.length === 0 && allPhones.length === 0) {
      console.log(`[ImpressumScraper] Nichts gefunden für ${domain} (${log.tried_urls.length} URLs, langPrefix=${langPrefix})`);
      return { contacts: [], company: null };
    }

    // ── Schritt 4: Kontakte zusammenbauen ─────────────────────────────────────
    // Eigene Domain priorisieren
    const baseDomain = domain.replace(/^www\./, "");
    const sortedEmails = [...allEmails].sort((a, b) => {
      const aOwn = a.email.split("@")[1]?.endsWith(baseDomain) ? 0 : 1;
      const bOwn = b.email.split("@")[1]?.endsWith(baseDomain) ? 0 : 1;
      return aOwn - bOwn;
    });

    const seenEmailSet = new Set<string>();
    const contacts = [];
    const deduplicatedPhones = [...new Set(allPhones)];

    for (let i = 0; i < sortedEmails.length; i++) {
      const { email, html } = sortedEmails[i];
      if (seenEmailSet.has(email)) continue;
      seenEmailSet.add(email);

      const title = extractTitle(html, email);
      const name = extractName(html, email);

      // Erste Telefonnummer dem ersten Kontakt zuweisen
      const phone = i === 0 && deduplicatedPhones.length > 0 ? deduplicatedPhones[0] : null;

      contacts.push({
        apollo_id: null,
        name: name ?? query.company_name,
        title: title ?? "Kontakt",
        email,
        phone,
        linkedin_url: null,
        seniority: title ? "senior" : null,
        department: null,
      });
    }

    // Falls nur Telefon, kein E-Mail gefunden — trotzdem speichern
    if (contacts.length === 0 && deduplicatedPhones.length > 0) {
      contacts.push({
        apollo_id: null,
        name: query.company_name,
        title: "Kontakt",
        email: null,
        phone: deduplicatedPhones[0],
        linkedin_url: null,
        seniority: null,
        department: null,
      });
    }

    console.log(
      `[ImpressumScraper] ${contacts.length} Kontakt(e) für ${domain} | E-Mails: ${log.emails_raw.join(", ")} | Tel: ${log.phones_raw.join(", ")}`
    );

    return { contacts, company: null };
  }
}
