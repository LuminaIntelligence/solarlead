/**
 * Personalisierungs-Tokens für LinkedIn-Templates.
 * Wird sowohl im UI-Preview als auch beim "Erledigt"-Mark verwendet.
 */

export interface TemplateContext {
  firstname?: string | null;
  lastname?: string | null;
  fullname?: string | null;
  company?: string | null;
  city?: string | null;
  title?: string | null;
  roof_m2?: number | null;
  category?: string | null;
}

const TOKEN_REGEX = /\{(firstname|lastname|fullname|company|city|title|roof_m2|category)\}/g;

export function renderTemplate(
  template: string,
  ctx: TemplateContext
): string {
  return template.replace(TOKEN_REGEX, (_, key: keyof TemplateContext) => {
    const val = ctx[key];
    if (val === null || val === undefined) {
      // Fallback: leerer String für saubere Anzeige
      // (lieber "Guten Tag ," als "Guten Tag {firstname},")
      return "";
    }
    return String(val);
  }).replace(/  +/g, " ").replace(/ +,/g, ",").replace(/\n /g, "\n");
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

export function contextFromJob(job: {
  contact_name?: string | null;
  contact_title?: string | null;
  company_name?: string | null;
  company_city?: string | null;
  company_category?: string | null;
  roof_area_m2?: number | null;
}): TemplateContext {
  const { firstname, lastname } = splitFullname(job.contact_name);
  return {
    firstname,
    lastname,
    fullname: job.contact_name ?? null,
    title: job.contact_title ?? null,
    company: job.company_name ?? null,
    city: job.company_city ?? null,
    category: job.company_category ?? null,
    roof_m2: job.roof_area_m2 ?? null,
  };
}
