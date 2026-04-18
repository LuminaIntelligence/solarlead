import type { ContactProvider, ContactQuery, ContactResult, Contact, CompanyEnrichment } from "./types";

// Entscheidungsrelevante Jobtitel für Solar-Vertrieb (DE + EN)
const SOLAR_RELEVANT_TITLES = [
  "geschäftsführer",
  "inhaber",
  "ceo",
  "chief executive officer",
  "cfo",
  "chief financial officer",
  "kaufmännischer leiter",
  "kaufmännische leitung",
  "facility manager",
  "facility management",
  "gebäudemanager",
  "betriebsleiter",
  "operations manager",
  "technischer leiter",
  "technical director",
  "energiebeauftragter",
  "energiemanager",
  "energy manager",
  "nachhaltigkeitsbeauftragter",
  "head of sustainability",
  "umweltbeauftragter",
  "infrastrukturleiter",
  "head of facilities",
  "vorstand",
  "managing director",
  "general manager",
];

const APOLLO_BASE = "https://api.apollo.io/v1";

export class ApolloContactProvider implements ContactProvider {
  name = "apollo";

  constructor(private readonly apiKey: string) {}

  async findContacts(query: ContactQuery): Promise<ContactResult> {
    // Schritt 1: Organisation anreichern → ID + Firmendaten
    const companyResult = await this.enrichOrganization(query.domain).catch(
      (err) => {
        console.error("[Apollo] Organization enrich failed:", err);
        return null;
      }
    );

    // Schritt 2: Personen über organization_id suchen + aufdecken
    const orgId = companyResult?.apollo_org_id ?? null;
    const contactResult = await this.searchAndRevealPeople(
      query.domain,
      orgId
    ).catch((err) => {
      console.error("[Apollo] People search failed:", err);
      return [] as Contact[];
    });

    // apollo_org_id nicht nach außen geben
    const company = companyResult
      ? { ...companyResult, apollo_org_id: undefined }
      : null;

    return { contacts: contactResult, company };
  }

  private async searchAndRevealPeople(
    domain: string,
    orgId: string | null
  ): Promise<Contact[]> {
    // Suche: entweder nach organization_id (genauer) oder nach Domain
    const searchBody = orgId
      ? { organization_ids: [orgId], per_page: 10 }
      : { q_organization_domains: [domain], per_page: 10 };

    const searchRes = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify(searchBody),
      signal: AbortSignal.timeout(10000),
    });

    if (!searchRes.ok) {
      const text = await searchRes.text().catch(() => "");
      throw new Error(`Apollo api_search ${searchRes.status}: ${text}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const searchData: any = await searchRes.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const people: any[] = searchData?.people ?? [];

    if (people.length === 0) return [];

    // Titel-Relevanz filtern (api_search unterstützt keinen Titel-Filter direkt)
    const lowerTitles = SOLAR_RELEVANT_TITLES.map((t) => t.toLowerCase());
    const relevant = people.filter((p) => {
      const title = (p.title ?? "").toLowerCase();
      return lowerTitles.some((t) => title.includes(t));
    });

    // Falls kein Titel-Match → trotzdem die ersten 5 nehmen
    const toReveal = (relevant.length > 0 ? relevant : people).slice(0, 5);

    // Schritt 2: Jeden Kontakt aufdecken (kostet Export-Credits)
    const revealed = await Promise.allSettled(
      toReveal.map((p) => this.revealPerson(p.id))
    );

    return revealed
      .map((r, i) => {
        if (r.status === "fulfilled" && r.value) return r.value;
        // Fallback: Teildaten aus der Suche
        const p = toReveal[i];
        return {
          apollo_id: p.id ?? null,
          name: [p.first_name, p.last_name_obfuscated].filter(Boolean).join(" "),
          title: p.title ?? null,
          email: null,
          phone: null,
          linkedin_url: null,
          seniority: p.seniority ?? null,
          department: (p.departments as string[] | undefined)?.[0] ?? null,
        } as Contact;
      })
      .filter(Boolean) as Contact[];
  }

  private async revealPerson(personId: string): Promise<Contact | null> {
    const res = await fetch(`${APOLLO_BASE}/people/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": this.apiKey },
      body: JSON.stringify({ id: personId, reveal_personal_emails: false }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const p = data?.person;
    if (!p) return null;

    return {
      apollo_id: p.id ?? null,
      name: [p.first_name, p.last_name].filter(Boolean).join(" "),
      title: p.title ?? null,
      email: p.email ?? null,
      phone:
        (p.phone_numbers as { sanitized_number?: string }[] | undefined)?.[0]
          ?.sanitized_number ?? null,
      linkedin_url: p.linkedin_url ?? null,
      seniority: p.seniority ?? null,
      department: (p.departments as string[] | undefined)?.[0] ?? null,
    };
  }

  private async enrichOrganization(
    domain: string
  ): Promise<CompanyEnrichment | null> {
    const res = await fetch(`${APOLLO_BASE}/organizations/enrich`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Apollo Org API ${res.status}: ${text}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json();
    const org = data?.organization ?? null;

    if (!org) return null;

    return {
      apollo_org_id: org.id ?? null,
      estimated_num_employees: org.estimated_num_employees ?? null,
      annual_revenue: org.annual_revenue ?? null,
      industry: org.industry ?? null,
      description: org.short_description ?? org.description ?? null,
      linkedin_url: org.linkedin_url ?? null,
    };
  }
}
