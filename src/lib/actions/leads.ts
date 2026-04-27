"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  Lead,
  LeadWithRelations,
  SolarAssessment,
  LeadEnrichment,
} from "@/types/database";

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
    let query = supabase.from("solar_lead_mass").select("*");

    if (filters?.status) {
      query = query.eq("status", filters.status);
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
    const { data, error } = await supabase
      .from("solar_lead_mass")
      .select("*, solar_assessments(*), lead_enrichment(*), lead_contacts(*), lead_activities(*)")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Error fetching lead:", error);
      return null;
    }

    const lead = data as LeadWithRelations;

    // Sort assessments: prefer the most complete one (with panel data), then newest
    if ((lead.solar_assessments?.length ?? 0) > 1) {
      lead.solar_assessments.sort((a, b) => {
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

export async function saveLead(
  lead: Omit<Lead, "id" | "created_at" | "updated_at" | "user_id">
): Promise<Lead | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.error("Error in saveLead: user not authenticated");
      return null;
    }

    const { data, error } = await supabase
      .from("solar_lead_mass")
      .insert({ ...lead, user_id: user.id })
      .select()
      .single();

    if (error) {
      console.error("Error saving lead:", error);
      return null;
    }

    revalidatePath("/leads");
    revalidatePath("/dashboard");

    return data as Lead;
  } catch (error) {
    console.error("Error in saveLead:", error);
    return null;
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
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const today = new Date().toISOString().slice(0, 10);

    const [leadsRes, newThisWeekRes, overdueRes] = await Promise.all([
      supabase.from("solar_lead_mass").select("status, category, total_score"),
      supabase
        .from("solar_lead_mass")
        .select("id", { count: "exact", head: true })
        .gte("created_at", oneWeekAgo.toISOString()),
      supabase
        .from("solar_lead_mass")
        .select("id", { count: "exact", head: true })
        .lte("next_contact_date", today)
        .neq("status", "rejected")
        .neq("status", "qualified")
        .not("next_contact_date", "is", null),
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
