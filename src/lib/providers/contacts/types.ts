export interface ContactQuery {
  /** Unternehmens-Domain, z.B. "muellerlogistik.de" */
  domain: string;
  /** Unternehmensname als Fallback / Zusatzfilter */
  company_name: string;
  /** Stadtname für bessere Zuordnung */
  city?: string;
}

export interface Contact {
  /** Apollo-interne ID */
  apollo_id: string | null;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  seniority: string | null;
  department: string | null;
}

export interface CompanyEnrichment {
  apollo_org_id?: string | null;
  estimated_num_employees: number | null;
  annual_revenue: number | null;
  industry: string | null;
  description: string | null;
  linkedin_url: string | null;
}

export interface ContactResult {
  contacts: Contact[];
  company: CompanyEnrichment | null;
}

export interface ContactProvider {
  name: string;
  findContacts(query: ContactQuery): Promise<ContactResult>;
}
