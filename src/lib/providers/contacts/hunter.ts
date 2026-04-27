/**
 * Hunter.io Contact Provider
 * Finds email addresses by company domain — no scraping needed.
 * https://hunter.io/api-documentation/v2
 */

import type { ContactProvider, ContactQuery, ContactResult, Contact } from "./types";

const HUNTER_BASE = "https://api.hunter.io/v2";

export class HunterContactProvider implements ContactProvider {
  name = "hunter";

  constructor(private readonly apiKey: string) {}

  async findContacts(query: ContactQuery): Promise<ContactResult> {
    const domain = query.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();

    try {
      const url = new URL(`${HUNTER_BASE}/domain-search`);
      url.searchParams.set("domain", domain);
      url.searchParams.set("api_key", this.apiKey);
      url.searchParams.set("limit", "10");
      url.searchParams.set("type", "personal"); // Prefer personal over generic

      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`[Hunter] API error ${res.status}: ${text}`);
        return { contacts: [], company: null };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      const emails: any[] = data?.data?.emails ?? [];

      if (emails.length === 0) {
        console.log(`[Hunter] Keine E-Mails für ${domain}`);
        return { contacts: [], company: null };
      }

      // Score ≥ 50 bevorzugen, darunter ignorieren
      const qualified = emails
        .filter((e) => (e.confidence ?? 0) >= 50)
        .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));

      if (qualified.length === 0) {
        console.log(`[Hunter] Nur unzuverlässige E-Mails für ${domain} (max confidence: ${emails[0]?.confidence ?? 0})`);
        return { contacts: [], company: null };
      }

      const contacts: Contact[] = qualified.slice(0, 5).map((e) => ({
        apollo_id: null,
        name: [e.first_name, e.last_name].filter(Boolean).join(" ") || query.company_name,
        title: e.position ?? null,
        email: e.value ?? null,
        phone: e.phone_number ?? null,
        linkedin_url: e.linkedin ?? null,
        seniority: e.seniority ?? null,
        department: e.department ?? null,
      }));

      console.log(
        `[Hunter] ${contacts.length} E-Mail(s) für ${domain}: ${contacts.map((c) => c.email).join(", ")}`
      );

      return { contacts, company: null };
    } catch (e) {
      console.warn("[Hunter] Request failed:", e);
      return { contacts: [], company: null };
    }
  }
}
