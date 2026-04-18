import type { ContactProvider, ContactQuery, ContactResult } from "./types";

const MOCK_CONTACTS = [
  {
    apollo_id: "mock_001",
    name: "Thomas Bauer",
    title: "Geschäftsführer",
    email: "t.bauer@example.de",
    phone: "+49 89 12345678",
    linkedin_url: "https://linkedin.com/in/thomas-bauer-example",
    seniority: "c_suite",
    department: "c_suite",
  },
  {
    apollo_id: "mock_002",
    name: "Sandra Hoffmann",
    title: "Facility Managerin",
    email: "s.hoffmann@example.de",
    phone: "+49 89 12345679",
    linkedin_url: "https://linkedin.com/in/sandra-hoffmann-example",
    seniority: "manager",
    department: "operations",
  },
  {
    apollo_id: "mock_003",
    name: "Klaus Weber",
    title: "Technischer Leiter",
    email: "k.weber@example.de",
    phone: null,
    linkedin_url: null,
    seniority: "director",
    department: "engineering",
  },
];

export class MockContactProvider implements ContactProvider {
  name = "mock";

  async findContacts(query: ContactQuery): Promise<ContactResult> {
    // Simulierte Verzögerung
    await new Promise((r) => setTimeout(r, 400));

    // Passe den Mock-Firmennamen an den Query an
    const domain = query.domain.replace(/\.(de|com|org|net)$/, "");
    const contacts = MOCK_CONTACTS.map((c) => ({
      ...c,
      email: c.email?.replace("example", domain) ?? null,
      linkedin_url:
        c.linkedin_url?.replace("example", domain.replace(/\./g, "-")) ?? null,
    }));

    return {
      contacts,
      company: {
        estimated_num_employees: 120,
        annual_revenue: 15_000_000,
        industry: "Logistics & Supply Chain",
        description: `${query.company_name} ist ein mittelständisches Unternehmen in ${query.city ?? "Deutschland"} mit Fokus auf Logistik und Lagerhaltung.`,
        linkedin_url: `https://www.linkedin.com/company/${query.domain.replace(/\.(de|com|org|net)$/, "")}`,
      },
    };
  }
}
