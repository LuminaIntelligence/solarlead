/**
 * Lead-Access-Helper.
 *
 * Ein User darf einen Lead lesen/bearbeiten wenn:
 *   1. Er Admin / Team-Lead / Reply-Specialist ist (systemweiter Zugriff), ODER
 *   2. Er den Lead selbst angelegt hat (solar_lead_mass.user_id = self), ODER
 *   3. Der Lead ihm zugewiesen wurde (solar_lead_mass.assigned_to = self).
 *
 * Ersetzt die alten `.eq("user_id", user.id)`-Checks in Endpoints wie
 * /api/activities, /api/enrich, /api/leads/[id]/contacts, etc. — die
 * blockierten Field-Members wie Jan Schoner obwohl der Lead ihnen zugewiesen
 * ist.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const PRIVILEGED_ROLES = ["admin", "team_lead", "reply_specialist"] as const;

/**
 * Prüft ob der aktuelle User Zugriff auf den Lead hat.
 * Führt bis zu 2 DB-Roundtrips durch: 1× user_settings.role, 1× solar_lead_mass.
 * Kann getrost mehrfach aufgerufen werden — die Kosten sind minimal.
 */
export async function hasLeadAccess(
  supabase: SupabaseClient,
  leadId: string,
  userId: string
): Promise<boolean> {
  // 1) Privilegierte Rollen sehen alles
  const { data: settings } = await supabase
    .from("user_settings")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  const role = settings?.role as string | undefined;
  if (role && PRIVILEGED_ROLES.includes(role as (typeof PRIVILEGED_ROLES)[number])) {
    // Existiert der Lead überhaupt?
    const { data: exists } = await supabase
      .from("solar_lead_mass")
      .select("id")
      .eq("id", leadId)
      .maybeSingle();
    return !!exists;
  }

  // 2) Owner oder Assignee?
  const { data: lead } = await supabase
    .from("solar_lead_mass")
    .select("id")
    .eq("id", leadId)
    .or(`user_id.eq.${userId},assigned_to.eq.${userId}`)
    .maybeSingle();
  return !!lead;
}
