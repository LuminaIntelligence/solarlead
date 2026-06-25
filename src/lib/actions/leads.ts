"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculateScore } from "@/lib/scoring";
import type {
  Lead,
  LeadWithRelations,
  SolarAssessment,
  LeadEnrichment,
} from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Liefert Scope-Info für den aktuell eingeloggten User.
 * - `mustScope=true` → Nutzer ist Field-Member (role='user'), darf nur
 *   eigene oder zugewiesene Leads sehen
 * - `mustScope=false` → Admin/Team-Lead/Reply-Specialist sieht alles
 */
async function getUserScope(supabase: SupabaseClient): Promise<{
  userId: string | null;
  role: string;
  mustScope: boolean;
}> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { userId: null, role: "anonymous", mustScope: true };
  const { data: settings } = await supabase
    .from("user_settings")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();
  const role = (settings?.role as string) ?? "user";
  const mustScope = role === "user" || !role;
  return { userId: user.id, role, mustScope };
}

export async function getLeads(filters?: {
  status?: string;
  category?: string;
  city?: string;
  minScore?: number;
  maxScore?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
}): Promise<Lead[]> {
  try {
    const supabase = await createClient();
    const scope = await getUserScope(supabase);
    let query = supabase.from("solar_lead_mass").select("*");

    // Role-Scope: Field-Member sieht nur eigene + zugewiesene Leads
    if (scope.mustScope && scope.userId) {
      query = query.or(
        `user_id.eq.${scope.userId},assigned_to.eq.${scope.userId}`
      );
    }

    if (filters?.status) {
      query = query.eq("status", filters.status);
    } else {
      // Never show archived leads (existing_solar) in the default list
      query = query.neq("status", "existing_solar");
    }
    if (filters?.category) {
      query = query.eq("category", filters.category);
    }
    if (filters?.city) {
      query = query.eq("city", filters.city);
    }
    if (filters?.minScore !== undefined) {
      query = query.gte("total_score", filters.minScore);
    }
    if (filters?.maxScore !== undefined) {
      query = query.lte("total_score", filters.maxScore);
    }
    if (filters?.search) {
      query = query.or(
        `company_name.ilike.%${filters.search}%,address.ilike.%${filters.search}%,city.ilike.%${filters.search}%`
      );
    }

    const sortBy = filters?.sortBy || "total_score";
    const sortOrder = filters?.sortOrder || "desc";
    query = query.order(sortBy, { ascending: sortOrder === "asc" });

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching leads:", error);
      return [];
    }

    return data as Lead[];
  } catch (error) {
    console.error("Error in getLeads:", error);
    return [];
  }
}

export async function getLead(
  id: string
): Promise<LeadWithRelations | null> {
  try {
    const supabase = await createClient();
    const scope = await getUserScope(supabase);
    let q = supabase
      .from("solar_lead_mass")
      .select("*, solar_assessments(*), lead_enrichment(*), lead_contacts(*), lead_activities(*)")
      .eq("id", id);

    // Field-Member darf nur eigene + zugewiesene Leads öffnen
    if (scope.mustScope && scope.userId) {
      q = q.or(`user_id.eq.${scope.userId},assigned_to.eq.${scope.userId}`);
    }

    const { data, error } = await q.single();

    if (error) {
      console.error("Error fetching lead:", error);
      return null;
    }

    const lead = data as LeadWithRelations;

    // Sort assessments: prefer the most complete one (with panel data), then newest
    if ((lead.solar_assessments?.length ?? 0) > 1) {
      lead.solar_assessments!.sort((a, b) => {
        const aComplete = a.max_array_panels_count != null ? 1 : 0;
        const bComplete = b.max_array_panels_count != null ? 1 : 0;
        if (bComplete !== aComplete) return bComplete - aComplete;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    }

    // Fallback: if no solar assessment saved, try to show data from linked discovery_lead
    if (!lead.solar_assessments?.length) {
      const { data: dl } = await supabase
        .from("discovery_leads")
        .select("solar_quality, max_array_area_m2, roof_area_m2, latitude, longitude")
        .eq("lead_id", id)
        .maybeSingle();

      if (dl?.max_array_area_m2) {
        lead.solar_assessments = [
          {
            id: "discovery_fallback",
            lead_id: id,
            provider: "google_solar",
            latitude: dl.latitude ?? null,
            longitude: dl.longitude ?? null,
            solar_quality: dl.solar_quality ?? null,
            max_array_area_m2: dl.max_array_area_m2,
            max_array_panels_count: null,
            annual_energy_kwh: null,
            sunshine_hours: null,
            carbon_offset: null,
            segment_count: null,
            panel_capacity_watts: null,
            raw_response_json: null,
            created_at: new Date().toISOString(),
          },
        ];
      }
    }

    return lead;
  } catch (error) {
    console.error("Error in getLead:", error);
    return null;
  }
}

export async function updateLead(
  id: string,
  data: Partial<Pick<Lead, "status" | "notes" | "linkedin_url">>
): Promise<Lead | null> {
  try {
    const supabase = await createClient();

    // Sonderfall: Status wechselt auf 'existing_solar' → über zentralen Helper
    // routen, damit Outreach-Jobs konsistent storniert werden und Tracking-
    // Spalten (existing_solar_at, source='manual') gesetzt werden.
    if (data.status === "existing_solar") {
      const { markLeadAsExistingSolar } = await import(
        "@/lib/leads/mark-existing-solar"
      );
      await markLeadAsExistingSolar(supabase, id, "manual");
      // Andere Felder (notes, linkedin_url) trotzdem separat speichern wenn vorhanden
      const otherData: Partial<Pick<Lead, "notes" | "linkedin_url">> = {};
      if (data.notes !== undefined) otherData.notes = data.notes;
      if (data.linkedin_url !== undefined) otherData.linkedin_url = data.linkedin_url;
      if (Object.keys(otherData).length > 0) {
        await supabase.from("solar_lead_mass").update(otherData).eq("id", id);
      }
      const { data: updated } = await supabase
        .from("solar_lead_mass")
        .select()
        .eq("id", id)
        .single();
      revalidatePath("/leads");
      revalidatePath(`/leads/${id}`);
      revalidatePath("/dashboard");
      return updated as Lead;
    }

    const { data: updated, error } = await supabase
      .from("solar_lead_mass")
      .update(data)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Error updating lead:", error);
      return null;
    }

    revalidatePath("/leads");
    revalidatePath(`/leads/${id}`);
    revalidatePath("/dashboard");

    return updated as Lead;
  } catch (error) {
    console.error("Error in updateLead:", error);
    return null;
  }
}

export async function deleteLead(id: string): Promise<boolean> {
  try {
    const supabase = await createClient();
    // Rolle prüfen — nur 'admin' darf löschen
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      console.warn("[deleteLead] no auth user");
      return false;
    }
    const { data: settings } = await supabase
      .from("user_settings")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (settings?.role !== "admin") {
      console.warn(`[deleteLead] user ${user.id} role=${settings?.role} not allowed`);
      return false;
    }
    const { error } = await supabase.from("solar_lead_mass").delete().eq("id", id);

    if (error) {
      console.error("Error deleting lead:", error);
      return false;
    }

    revalidatePath("/leads");
    revalidatePath("/dashboard");

    return true;
  } catch (error) {
    console.error("Error in deleteLead:", error);
    return false;
  }
}

/**
 * Result-Type für saveLead/checkLeadDuplicate.
 * Statt einfach null bei Duplikaten geben wir Kontext zurück (existing lead +
 * wer ihm zugewiesen ist) damit das Frontend dem Field-Member sagen kann
 * "schon im System, gehört Mitglied X" statt nur "Fehler".
 */
export interface SaveLeadResult {
  ok: boolean;
  lead?: Lead;
  duplicate?: {
    lead_id: string;
    company_name: string | null;
    assigned_to_user_id: string | null;
    assigned_to_email: string | null;
    is_own: boolean;
  };
  error?: string;
}

/**
 * Prüft ob bereits ein Lead mit gleichem place_id / postal_code+company existiert.
 * Liefert Info über aktuelle Zuweisung zurück, ohne neuen Lead anzulegen.
 */
export async function checkLeadDuplicate(args: {
  place_id?: string | null;
  company_name: string;
  postal_code?: string | null;
  city?: string | null;
}): Promise<SaveLeadResult["duplicate"] | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // 1. Exact match via place_id
  if (args.place_id) {
    const { data: byPlace } = await supabase
      .from("solar_lead_mass")
      .select("id, company_name, assigned_to, user_id")
      .eq("place_id", args.place_id)
      .maybeSingle();
    if (byPlace) {
      return await enrichDuplicate(supabase, byPlace, user.id);
    }
  }

  // 2. Fuzzy match: company_name + (postal_code OR city)
  let q = supabase
    .from("solar_lead_mass")
    .select("id, company_name, assigned_to, user_id")
    .ilike("company_name", args.company_name);
  if (args.postal_code) q = q.eq("postal_code", args.postal_code);
  else if (args.city) q = q.eq("city", args.city);
  const { data: matches } = await q.limit(1);
  if (matches && matches.length > 0) {
    return await enrichDuplicate(supabase, matches[0], user.id);
  }
  return null;
}

async function enrichDuplicate(
  supabase: SupabaseClient,
  row: { id: string; company_name: string | null; assigned_to: string | null; user_id: string },
  currentUserId: string
): Promise<NonNullable<SaveLeadResult["duplicate"]>> {
  let email: string | null = null;
  const assigneeId = row.assigned_to ?? row.user_id;
  if (assigneeId) {
    try {
      const admin = createAdminClient();
      const { data } = await admin.auth.admin.getUserById(assigneeId);
      email = data?.user?.email ?? null;
    } catch { /* ignore */ }
  }
  return {
    lead_id: row.id,
    company_name: row.company_name,
    assigned_to_user_id: assigneeId,
    assigned_to_email: email,
    is_own: assigneeId === currentUserId,
  };
}

export async function saveLead(
  lead: Omit<Lead, "id" | "created_at" | "updated_at" | "user_id">
): Promise<SaveLeadResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { ok: false, error: "Nicht angemeldet" };
    }

    // Duplikat-Check zuerst — wenn schon vorhanden, KEIN neuer Lead, sondern
    // Hinweis zurück (gehört Mitglied X / dir selbst).
    const dup = await checkLeadDuplicate({
      place_id: lead.place_id ?? null,
      company_name: lead.company_name,
      postal_code: lead.postal_code ?? null,
      city: lead.city ?? null,
    });
    if (dup) return { ok: false, duplicate: dup };

    const { data, error } = await supabase
      .from("solar_lead_mass")
      .insert({ ...lead, user_id: user.id })
      .select()
      .single();

    if (error) {
      console.error("Error saving lead:", error);
      return { ok: false, error: error.message };
    }

    revalidatePath("/leads");
    revalidatePath("/dashboard");

    return { ok: true, lead: data as Lead };
  } catch (error) {
    console.error("Error in saveLead:", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveLeads(
  leads: Omit<Lead, "id" | "created_at" | "updated_at" | "user_id">[]
): Promise<number> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("Error in saveLeads: user not authenticated");
      return 0;
    }

    // Fetch existing place_ids for deduplication
    const placeIds = leads
      .map((l) => l.place_id)
      .filter((id): id is string => id !== null);

    let existingPlaceIds = new Set<string>();
    if (placeIds.length > 0) {
      const { data: existing } = await supabase
        .from("solar_lead_mass")
        .select("place_id")
        .in("place_id", placeIds);

      existingPlaceIds = new Set(
        (existing || []).map((row) => row.place_id as string)
      );
    }

    // Filter out duplicates
    const newLeads = leads
      .filter(
        (lead) => !lead.place_id || !existingPlaceIds.has(lead.place_id)
      )
      .map((lead) => ({ ...lead, user_id: user.id }));

    if (newLeads.length === 0) {
      return 0;
    }

    const { data, error } = await supabase
      .from("solar_lead_mass")
      .insert(newLeads)
      .select("id");

    if (error) {
      console.error("Error saving leads in bulk:", error);
      return 0;
    }

    revalidatePath("/leads");
    revalidatePath("/dashboard");

    return data?.length ?? 0;
  } catch (error) {
    console.error("Error in saveLeads:", error);
    return 0;
  }
}

export async function saveSolarAssessment(
  assessment: Omit<SolarAssessment, "id" | "created_at">
): Promise<SolarAssessment | null> {
  try {
    const supabase = await createClient();

    // Idempotency guard: never create a second complete assessment for the same lead.
    // A complete assessment has non-null max_array_panels_count (i.e. real data).
    // no_coverage placeholders (null panels) are always replaceable.
    if (assessment.max_array_panels_count !== null) {
      const { data: existing } = await supabase
        .from("solar_assessments")
        .select("id")
        .eq("lead_id", assessment.lead_id)
        .not("max_array_panels_count", "is", null)
        .maybeSingle();

      if (existing) {
        console.warn(
          `[saveSolarAssessment] Lead ${assessment.lead_id} already has a complete assessment — skipping insert.`
        );
        return existing as unknown as SolarAssessment;
      }
    }

    const { data, error } = await supabase
      .from("solar_assessments")
      .insert(assessment)
      .select()
      .single();

    if (error) {
      console.error("Error saving solar assessment:", error);
      return null;
    }

    revalidatePath(`/leads/${assessment.lead_id}`);

    return data as SolarAssessment;
  } catch (error) {
    console.error("Error in saveSolarAssessment:", error);
    return null;
  }
}

export async function saveEnrichment(
  enrichment: Omit<LeadEnrichment, "id" | "created_at">
): Promise<LeadEnrichment | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("lead_enrichment")
      .insert(enrichment)
      .select()
      .single();

    if (error) {
      console.error("Error saving enrichment:", error);
      return null;
    }

    revalidatePath(`/leads/${enrichment.lead_id}`);

    return data as LeadEnrichment;
  } catch (error) {
    console.error("Error in saveEnrichment:", error);
    return null;
  }
}

export async function getLeadStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byCategory: Record<string, number>;
  avgScore: number;
  highScoreCount: number;
  newThisWeek: number;
  overdueFollowups: number;
}> {
  const defaultStats = {
    total: 0,
    byStatus: {},
    byCategory: {},
    avgScore: 0,
    highScoreCount: 0,
    newThisWeek: 0,
    overdueFollowups: 0,
  };

  try {
    const supabase = await createClient();
    const scope = await getUserScope(supabase);
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const today = new Date().toISOString().slice(0, 10);

    // Helper: applies role-scope to a Supabase query builder.
    const scopeClause =
      scope.mustScope && scope.userId
        ? `user_id.eq.${scope.userId},assigned_to.eq.${scope.userId}`
        : null;
    const scoped = <T extends { or: (clause: string) => T }>(q: T): T => {
      return scopeClause ? q.or(scopeClause) : q;
    };

    const [leadsRes, newThisWeekRes, overdueRes] = await Promise.all([
      scoped(supabase.from("solar_lead_mass").select("status, category, total_score").limit(10000)),
      scoped(
        supabase
          .from("solar_lead_mass")
          .select("id", { count: "exact", head: true })
          .gte("created_at", oneWeekAgo.toISOString())
      ),
      scoped(
        supabase
          .from("solar_lead_mass")
          .select("id", { count: "exact", head: true })
          .lte("next_contact_date", today)
          .neq("status", "rejected")
          .neq("status", "qualified")
          .not("next_contact_date", "is", null)
      ),
    ]);

    const leads = leadsRes.data;
    if (!leads || leads.length === 0) return defaultStats;

    const byStatus: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    let totalScore = 0;
    let highScoreCount = 0;

    for (const lead of leads) {
      byStatus[lead.status] = (byStatus[lead.status] || 0) + 1;
      byCategory[lead.category] = (byCategory[lead.category] || 0) + 1;
      totalScore += lead.total_score ?? 0;
      if ((lead.total_score ?? 0) >= 70) highScoreCount++;
    }

    return {
      total: leads.length,
      byStatus,
      byCategory,
      avgScore: Math.round(totalScore / leads.length),
      highScoreCount,
      newThisWeek: newThisWeekRes.count ?? 0,
      overdueFollowups: overdueRes.count ?? 0,
    };
  } catch (error) {
    console.error("Error in getLeadStats:", error);
    return defaultStats;
  }
}

export async function bulkUpdateStatus(
  ids: string[],
  status: string
): Promise<number> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;

    const { data, error } = await supabase
      .from("solar_lead_mass")
      .update({ status })
      .in("id", ids)
      .eq("user_id", user.id)
      .select("id");

    if (error) { console.error("Error in bulkUpdateStatus:", error); return 0; }
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard");
    return data?.length ?? 0;
  } catch (error) {
    console.error("Error in bulkUpdateStatus:", error);
    return 0;
  }
}

export async function bulkUpdateCategory(
  ids: string[],
  category: string
): Promise<number> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 0;

    const { data, error } = await supabase
      .from("solar_lead_mass")
      .update({
        category,
        last_edited_by: user.id,
        last_edited_at: new Date().toISOString(),
      })
      .in("id", ids)
      .eq("user_id", user.id)
      .select("id");

    if (error) {
      // Retry without audit columns if migration hasn't applied yet
      if (error.message?.includes("last_edited_")) {
        const retry = await supabase
          .from("solar_lead_mass")
          .update({ category })
          .in("id", ids)
          .eq("user_id", user.id)
          .select("id");
        if (retry.error) { console.error("bulkUpdateCategory retry:", retry.error); return 0; }
        revalidatePath("/dashboard/leads");
        revalidatePath("/dashboard");
        return retry.data?.length ?? 0;
      }
      console.error("Error in bulkUpdateCategory:", error);
      return 0;
    }
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard");
    return data?.length ?? 0;
  } catch (error) {
    console.error("Error in bulkUpdateCategory:", error);
    return 0;
  }
}

export async function bulkDeleteLeads(ids: string[]): Promise<boolean> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await supabase
      .from("solar_lead_mass")
      .delete()
      .in("id", ids)
      .eq("user_id", user.id);

    if (error) { console.error("Error in bulkDeleteLeads:", error); return false; }
    revalidatePath("/dashboard/leads");
    revalidatePath("/dashboard");
    return true;
  } catch (error) {
    console.error("Error in bulkDeleteLeads:", error);
    return false;
  }
}

/**
 * Recalculates solar_score + total_score for a lead based on current
 * solar_assessments + lead_enrichment data and persists the result.
 *
 * Uses admin client so it can be safely called from batch/backfill routes
 * that have no user session context.
 *
 * Returns true on success.
 */
export async function recalculateLeadScore(leadId: string): Promise<boolean> {
  try {
    const adminClient = createAdminClient();

    // Load lead
    const { data: lead, error: leadError } = await adminClient
      .from("solar_lead_mass")
      .select("id, category, website, phone, email")
      .eq("id", leadId)
      .single();

    if (leadError || !lead) {
      console.error("[recalculateLeadScore] Lead not found:", leadId, leadError);
      return false;
    }

    // Load latest solar assessment
    const { data: solarData } = await adminClient
      .from("solar_assessments")
      .select("solar_quality, max_array_panels_count, max_array_area_m2, annual_energy_kwh")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Load latest enrichment
    const { data: enrichmentData } = await adminClient
      .from("lead_enrichment")
      .select("detected_keywords, enrichment_score")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const scoring = calculateScore({
      category: lead.category,
      solarData: solarData ?? null,
      enrichmentData: enrichmentData ?? null,
      hasWebsite: !!lead.website,
      hasPhone: !!lead.phone,
      hasEmail: !!lead.email,
    });

    const { error: updateError } = await adminClient
      .from("solar_lead_mass")
      .update({
        business_score: scoring.business_score,
        electricity_score: scoring.electricity_score,
        outreach_score: scoring.outreach_score,
        solar_score: scoring.solar_score,
        total_score: scoring.total_score,
      })
      .eq("id", leadId);

    if (updateError) {
      console.error("[recalculateLeadScore] Update error:", leadId, updateError);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[recalculateLeadScore] Unexpected error:", leadId, error);
    return false;
  }
}

export async function saveSearchRun(
  query: string,
  filters: Record<string, unknown>,
  resultsCount: number
): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("Error in saveSearchRun: user not authenticated");
      return;
    }

    const { error } = await supabase.from("search_runs").insert({
      user_id: user.id,
      query,
      filters,
      results_count: resultsCount,
    });

    if (error) {
      console.error("Error saving search run:", error);
    }
  } catch (error) {
    console.error("Error in saveSearchRun:", error);
  }
}
