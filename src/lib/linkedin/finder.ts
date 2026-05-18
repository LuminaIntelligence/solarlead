/**
 * LinkedIn-Profil-Discovery via Google CSE.
 *
 * Zwei Modi:
 *   A) findProfileForPerson({firstName, lastName, company}) — wir haben
 *      einen Namen, wollen sein/ihr LinkedIn-Profil
 *   B) findProfileAtCompany({company, roles?}) — wir haben nur eine
 *      Firma, wollen einen Entscheidungsträger finden
 *
 * Confidence (0..1):
 *   - Position im Result (Top 1 = +0.4, Top 2 = +0.2)
 *   - Vor+Nachname im URL-Slug `/in/firstname-lastname-...` (+0.4)
 *   - Firma im Snippet erwähnt (+0.2)
 *   - Title-Match aus Rolle (+0.2 bei Modus B)
 */

import { searchCse, type CseResult } from "@/lib/providers/search/googleCse";

const DECISION_MAKER_ROLES = [
  "Geschäftsführer",
  "CEO",
  "Inhaber",
  "Vorstand",
  "COO",
  "Managing Director",
  "Standortleiter",
  "Operations Manager",
  "Operations",
];

export interface FoundProfile {
  url: string;             // linkedin.com/in/...
  name: string | null;     // extrahiert aus Title/Snippet
  title: string | null;    // Job-Title aus Snippet (Modus B)
  snippet: string;
  confidence: number;      // 0..1
  query: string;
  source: "google_cse";
}

export interface FinderResult {
  ok: boolean;
  profile: FoundProfile | null;
  alternatives: FoundProfile[]; // bei Modus B die 2.+3. Treffer
  error?: string;
  quotaExceeded?: boolean;
  searchedQuery: string;
}

/** Test: ist diese URL ein persönliches /in/... LinkedIn-Profil? */
export function isPersonalLinkedInUrl(url: string): boolean {
  return /linkedin\.com\/in\//i.test(url);
}

/** Slug-Vergleich: enthält der URL-Slug Vor- und Nachname? */
function urlSlugMatchesName(url: string, firstName: string, lastName: string): boolean {
  const slug = url.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1]?.toLowerCase() ?? "";
  if (!slug) return false;
  // Diakritika weg, lowercase, Trennzeichen normalisieren
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // diacritics
      .replace(/[ß]/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const fn = norm(firstName);
  const ln = norm(lastName);
  if (!fn || !ln) return false;
  return slug.includes(fn) && slug.includes(ln);
}

/**
 * Extrahiert Name + Title aus einem CSE-Result.
 * LinkedIn-Titles haben typisch Format:
 *   "Max Mustermann - Geschäftsführer - Firma GmbH | LinkedIn"
 *   "Max Mustermann | LinkedIn"
 *   "Max Mustermann – CEO bei Firma GmbH – LinkedIn"
 */
function parseNameAndTitle(result: CseResult): { name: string | null; title: string | null } {
  const t = result.title.replace(/\s*[-–|·]\s*LinkedIn\s*$/i, "").trim();
  // Schema 1: "Name - Title - Company"
  const parts = t.split(/\s*[-–|·]\s*/);
  if (parts.length === 0) return { name: null, title: null };
  const name = parts[0]?.trim() || null;
  const title = parts.length > 1 ? parts[1]?.trim() || null : null;
  return { name, title };
}

function calcConfidenceA(
  result: CseResult,
  firstName: string,
  lastName: string,
  company: string,
  position: number
): number {
  let score = 0;
  if (position === 0) score += 0.4;
  else if (position === 1) score += 0.2;
  if (urlSlugMatchesName(result.link, firstName, lastName)) score += 0.4;
  const companyNorm = company.toLowerCase().replace(/\s*(gmbh|ag|kg|e\.v\.|holding|& co.*).*$/i, "").trim();
  if (companyNorm && (result.snippet.toLowerCase().includes(companyNorm) || result.title.toLowerCase().includes(companyNorm))) {
    score += 0.2;
  }
  return Math.min(1, score);
}

function calcConfidenceB(
  result: CseResult,
  company: string,
  position: number,
  roles: string[]
): number {
  let score = 0;
  if (position === 0) score += 0.3;
  else if (position === 1) score += 0.2;
  else if (position === 2) score += 0.1;

  const companyNorm = company.toLowerCase().replace(/\s*(gmbh|ag|kg|e\.v\.|holding|& co.*).*$/i, "").trim();
  if (companyNorm && (result.snippet.toLowerCase().includes(companyNorm) || result.title.toLowerCase().includes(companyNorm))) {
    score += 0.3;
  }

  // Title-Match: einer der Decision-Maker-Rollen im Snippet/Title
  const textLower = (result.title + " " + result.snippet).toLowerCase();
  if (roles.some((r) => textLower.includes(r.toLowerCase()))) {
    score += 0.3;
  }

  // Wenn ein erkennbarer Personenname im Title steht (mind. 2 Worte mit Großbuchstaben)
  const { name } = parseNameAndTitle(result);
  if (name && /^[A-ZÄÖÜ][a-zäöüß]+ [A-ZÄÖÜ][a-zäöüß]+/.test(name)) {
    score += 0.1;
  }

  return Math.min(1, score);
}

/** Modus A: Profil für eine bekannte Person finden. */
export async function findProfileForPerson(args: {
  firstName: string;
  lastName: string;
  company: string;
}): Promise<FinderResult> {
  const { firstName, lastName, company } = args;
  const query = `"${firstName} ${lastName}" "${company}" site:linkedin.com/in`;
  const r = await searchCse(query, 5);
  if (!r.ok) {
    return {
      ok: false,
      profile: null,
      alternatives: [],
      error: r.error,
      quotaExceeded: r.quotaExceeded,
      searchedQuery: query,
    };
  }
  const personalResults = r.results.filter((res) => isPersonalLinkedInUrl(res.link));
  if (personalResults.length === 0) {
    return { ok: true, profile: null, alternatives: [], searchedQuery: query };
  }
  const scored = personalResults.map((res, i) => ({
    url: res.link,
    name: parseNameAndTitle(res).name ?? `${firstName} ${lastName}`,
    title: parseNameAndTitle(res).title,
    snippet: res.snippet,
    confidence: calcConfidenceA(res, firstName, lastName, company, i),
    query,
    source: "google_cse" as const,
  }));
  scored.sort((a, b) => b.confidence - a.confidence);
  return {
    ok: true,
    profile: scored[0] ?? null,
    alternatives: scored.slice(1, 3),
    searchedQuery: query,
  };
}

/** Modus B: Entscheidungsträger bei einer Firma finden. */
export async function findProfileAtCompany(args: {
  company: string;
  roles?: string[];
}): Promise<FinderResult> {
  const roles = args.roles ?? DECISION_MAKER_ROLES;
  // Bauen die Rollen-OR-Klausel: maximal 5 Roles um die Query kurz zu halten
  const roleQ = roles
    .slice(0, 5)
    .map((r) => `"${r}"`)
    .join(" OR ");
  const query = `"${args.company}" site:linkedin.com/in (${roleQ})`;
  const r = await searchCse(query, 8);
  if (!r.ok) {
    return {
      ok: false,
      profile: null,
      alternatives: [],
      error: r.error,
      quotaExceeded: r.quotaExceeded,
      searchedQuery: query,
    };
  }
  const personalResults = r.results.filter((res) => isPersonalLinkedInUrl(res.link));
  if (personalResults.length === 0) {
    return { ok: true, profile: null, alternatives: [], searchedQuery: query };
  }
  const scored = personalResults.map((res, i) => {
    const { name, title } = parseNameAndTitle(res);
    return {
      url: res.link,
      name,
      title,
      snippet: res.snippet,
      confidence: calcConfidenceB(res, args.company, i, roles),
      query,
      source: "google_cse" as const,
    };
  });
  scored.sort((a, b) => b.confidence - a.confidence);
  return {
    ok: true,
    profile: scored[0] ?? null,
    alternatives: scored.slice(1, 3),
    searchedQuery: query,
  };
}

const GENERIC_EMAIL_PREFIXES = [
  "info", "kontakt", "hallo", "hello", "office", "mail", "post", "anfrage",
  "service", "support", "vertrieb", "sales", "contact", "webmaster", "admin",
  "management", "buero", "büro", "team", "presse", "marketing",
];

export function isGenericEmail(email: string | null | undefined): boolean {
  if (!email) return true;
  const localPart = email.split("@")[0]?.toLowerCase() ?? "";
  return GENERIC_EMAIL_PREFIXES.some(
    (p) => localPart === p || localPart.startsWith(p + ".") || localPart.startsWith(p + "-")
  );
}

/** Personen-Indikator: Kontakt hat klaren Vor+Nachnamen UND keine generische Mail. */
export function isPersonContact(c: { name?: string | null; email?: string | null }): boolean {
  if (!c.name) return false;
  const parts = c.name.trim().split(/\s+/);
  if (parts.length < 2) return false;
  if (isGenericEmail(c.email)) return false;
  return true;
}
