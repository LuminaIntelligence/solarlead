/**
 * Firecrawl Contact Provider
 * Uses headless Chrome rendering to scrape Impressum/Kontakt pages.
 * Handles JS-rendered sites, Cloudflare protection, SPAs.
 * https://docs.firecrawl.dev/api-reference
 */

import type { ContactProvider, ContactQuery, ContactResult } from "./types";
import { ImpressumScraperProvider } from "./impressum";

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";

// Paths to try (Impressum is most important for German companies)
const PATHS_TO_TRY = [
  "/impressum",
  "/de/impressum",
  "/kontakt",
  "/de/kontakt",
  "/contact",
  "/legal-notice",
];

export class FirecrawlContactProvider implements ContactProvider {
  name = "firecrawl";

  constructor(private readonly apiKey: string) {}

  async findContacts(query: ContactQuery): Promise<ContactResult> {
    const rawDomain = query.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
    const baseUrl = `https://${rawDomain}`;

    // First: try to find the right URL via scraping the homepage
    const homepageMarkdown = await this.scrapeUrl(baseUrl);
    let targetUrl: string | null = null;

    if (homepageMarkdown) {
      // Look for impressum/kontakt links in the markdown
      const linkPattern = /\[(?:Impressum|Kontakt|Contact|Legal)[^\]]*\]\(([^)]+)\)/gi;
      for (const m of homepageMarkdown.matchAll(linkPattern)) {
        const href = m[1];
        targetUrl = href.startsWith("http") ? href : `${baseUrl}${href}`;
        break;
      }
    }

    // If no link found on homepage, try known paths
    const urlsToTry = targetUrl
      ? [targetUrl, ...PATHS_TO_TRY.map((p) => `${baseUrl}${p}`)]
      : PATHS_TO_TRY.map((p) => `${baseUrl}${p}`);

    for (const url of urlsToTry) {
      const markdown = await this.scrapeUrl(url);
      if (!markdown) continue;

      // Use the Impressum scraper's email/phone extraction on the rendered content
      const contacts = extractContactsFromMarkdown(markdown, query.company_name);
      if (contacts.length > 0) {
        console.log(`[Firecrawl] ${contacts.length} Kontakt(e) für ${rawDomain} von ${url}`);
        return { contacts, company: null };
      }
    }

    console.log(`[Firecrawl] Keine Kontakte gefunden für ${rawDomain}`);
    return { contacts: [], company: null };
  }

  private async scrapeUrl(url: string): Promise<string | null> {
    try {
      const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ["markdown"],
          onlyMainContent: false,
          timeout: 15000,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        if (res.status === 401) console.warn("[Firecrawl] API key invalid or expired");
        if (res.status === 429) console.warn("[Firecrawl] Rate limit hit");
        return null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      return data?.data?.markdown ?? data?.markdown ?? null;
    } catch (e) {
      console.warn(`[Firecrawl] Scrape failed for ${url}:`, e);
      return null;
    }
  }
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const IGNORE_PREFIXES = ["noreply", "no-reply", "datenschutz", "privacy", "webmaster", "postmaster"];

function isIgnoredEmail(email: string): boolean {
  const local = email.split("@")[0].toLowerCase();
  return IGNORE_PREFIXES.some((p) => local.startsWith(p));
}

function extractContactsFromMarkdown(
  markdown: string,
  companyName: string
): Array<{
  apollo_id: null;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: null;
  seniority: string | null;
  department: null;
}> {
  const contacts = [];

  // Extract emails
  const emails = new Set<string>();
  for (const m of markdown.matchAll(EMAIL_REGEX)) {
    if (!isIgnoredEmail(m[0])) emails.add(m[0].toLowerCase());
  }

  // Extract phones: tel: links, +49 patterns, Telefon: keywords
  const phones: string[] = [];
  for (const m of markdown.matchAll(/tel:([+\d\s\-().]{7,20})/gi)) {
    phones.push(m[1].trim());
  }
  for (const m of markdown.matchAll(/(?:Tel(?:efon)?|Phone|Fon)\s*[:.]?\s*([+\d][\d\s\-().]{6,20})/gi)) {
    phones.push(m[1].trim());
  }

  // Build contact entries
  const emailList = Array.from(emails);
  for (let i = 0; i < emailList.length; i++) {
    const email = emailList[i];
    // Try to extract name from email prefix
    const local = email.split("@")[0];
    let name = companyName;
    if (local.includes(".")) {
      const parts = local.split(".");
      if (parts.length === 2 && parts[0].length > 1 && parts[1].length > 1) {
        name = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
      }
    }

    contacts.push({
      apollo_id: null,
      name,
      title: null,
      email,
      phone: i === 0 && phones.length > 0 ? phones[0] : null,
      linkedin_url: null,
      seniority: null,
      department: null,
    });
  }

  // Phone-only entry if no emails found
  if (contacts.length === 0 && phones.length > 0) {
    contacts.push({
      apollo_id: null,
      name: companyName,
      title: null,
      email: null,
      phone: phones[0],
      linkedin_url: null,
      seniority: null,
      department: null,
    });
  }

  return contacts;
}

/** Quick health check — verifies the API key works */
export async function testFirecrawlKey(apiKey: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url: "https://example.com", formats: ["markdown"] }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.status === 401) return { ok: false, message: "API Key ungültig oder abgelaufen" };
    if (res.status === 429) return { ok: false, message: "Rate Limit erreicht" };
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };

    return { ok: true, message: "API Key funktioniert" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Netzwerkfehler" };
  }
}
