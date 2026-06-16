/**
 * Personalisierungs-Tokens für LinkedIn-Templates.
 * Wird sowohl im UI-Preview als auch beim "Erledigt"-Mark verwendet.
 *
 * Verfügbare Tokens:
 *   {firstname}          — Vorname
 *   {lastname}           — Nachname
 *   {fullname}           — kompletter Name
 *   {company}            — Firmenname
 *   {city}               — Stadt
 *   {title}              — Job-Titel (Geschäftsführer, CEO, ...)
 *   {salutation_lastname}— „Herr Mustermann" / „Frau Müller" / „Herr/Frau X"
 *                          (Genus aus dem Titel erkannt)
 *   {roof_m2}            — Dachfläche m², roh
 *   {roof_m2_formatted}  — Dachfläche m² mit Tausender-Punkt (z.B. „7.758")
 *   {lease}              — geschätzte Jahres-Pacht in € (Tausender-Punkt)
 *   {category}           — Branche
 */

import { formatLease, formatArea } from "@/lib/utils/lease";

export interface TemplateContext {
  firstname?: string | null;
  lastname?: string | null;
  fullname?: string | null;
  company?: string | null;
  city?: string | null;
  title?: string | null;
  salutation_lastname?: string | null;
  roof_m2?: number | null;
  roof_m2_formatted?: string | null;
  lease?: string | null;
  category?: string | null;
}

const TOKEN_REGEX =
  /\{(firstname|lastname|fullname|company|city|title|salutation_lastname|roof_m2|roof_m2_formatted|lease|category)\}/g;

export function renderTemplate(
  template: string,
  ctx: TemplateContext
): string {
  return template
    .replace(TOKEN_REGEX, (_, key: keyof TemplateContext) => {
      const val = ctx[key];
      if (val === null || val === undefined) return "";
      return String(val);
    })
    .replace(/  +/g, " ")
    .replace(/ +,/g, ",")
    .replace(/\n /g, "\n");
}

export function splitFullname(name: string | null | undefined): {
  firstname: string;
  lastname: string;
} {
  if (!name) return { firstname: "", lastname: "" };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstname: parts[0], lastname: "" };
  return {
    firstname: parts[0],
    lastname: parts.slice(1).join(" "),
  };
}

/**
 * Erkennt Genus aus dem Job-Titel.
 * "Geschäftsführerin" / "Frau ..." → Frau, "Geschäftsführer" / "Herr ..." → Herr,
 * sonst "Herr/Frau".
 */
function detectSalutation(title: string | null | undefined): "Herr" | "Frau" | "Herr/Frau" {
  const t = (title ?? "").toLowerCase();
  const female = [
    "in ", "inhaberin", "geschäftsführerin", "direktorin", "leiterin",
    "vorständin", "frau ",
  ];
  const male = [
    "inhaber", "geschäftsführer", "direktor", "leiter", "vorstand", "herr ",
  ];
  if (female.some((f) => t.includes(f))) return "Frau";
  if (male.some((m) => t.includes(m))) return "Herr";
  return "Herr/Frau";
}

function buildSalutationLastname(
  contactName: string | null | undefined,
  title: string | null | undefined
): string {
  if (!contactName) return "";
  const { lastname } = splitFullname(contactName);
  const ln = lastname || contactName.trim();
  const sal = detectSalutation(title);
  return `${sal} ${ln}`.trim();
}

export function contextFromJob(job: {
  contact_name?: string | null;
  contact_title?: string | null;
  company_name?: string | null;
  company_city?: string | null;
  company_category?: string | null;
  roof_area_m2?: number | null;
}): TemplateContext {
  const { firstname, lastname } = splitFullname(job.contact_name);
  const roof = job.roof_area_m2 ?? null;
  return {
    firstname,
    lastname,
    fullname: job.contact_name ?? null,
    title: job.contact_title ?? null,
    salutation_lastname: buildSalutationLastname(job.contact_name, job.contact_title),
    company: job.company_name ?? null,
    city: job.company_city ?? null,
    category: job.company_category ?? null,
    roof_m2: roof,
    roof_m2_formatted: roof ? formatArea(roof) : null,
    lease: roof ? formatLease(roof) : null,
  };
}
