"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Lead, UserSettings, SearchRun } from "@/types/database";

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  role: string;
  lead_count: number;
  is_banned: boolean;
}

interface SystemStats {
  totalUsers: number;
  totalLeads: number;
  leadsByStatus: Record<string, number>;
  leadsByCategory: Record<string, number>;
  avgScore: number;
  newUsersLast7Days: number;
  searchRunsLast7Days: number;
}

// ---------------------------------------------------------------------------
// Hilfsfunktion: Admin-Berechtigung pruefen
// ---------------------------------------------------------------------------

async function requireAdmin(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Nicht authentifiziert");

  // DB-backed role check (server-controlled, immutable by user).
  // user_metadata.role is kept as a fallback for legacy admins whose
  // user_settings row hasn't been seeded yet.
  const adminClient = createAdminClient();
  const { data: profile } = await adminClient
    .from("user_settings")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  const role = (profile?.role as string | undefined) ?? user.user_metadata?.role;
  if (role !== "admin") throw new Error("Keine Admin-Berechtigung");

  return user.id;
}

// ---------------------------------------------------------------------------
// Alle Benutzer abrufen
// ---------------------------------------------------------------------------

export async function getAllUsers(): Promise<AdminUser[]> {
  try {
    await requireAdmin();
    const adminClient = createAdminClient();

    const {
      data: { users },
      error,
    } = await adminClient.auth.admin.listUsers();

    if (error) {
      console.error("Fehler beim Abrufen der Benutzer:", error.message);
      throw new Error("Benutzer konnten nicht abgerufen werden");
    }

    // Lead-Anzahl pro Benutzer zaehlen
    const { data: leadCounts, error: countError } = await adminClient
      .from("solar_lead_mass")
      .select("user_id");

    if (countError) {
      console.error("Fehler beim Zaehlen der Leads:", countError.message);
    }

    const countMap: Record<string, number> = {};
    if (leadCounts) {
      for (const row of leadCounts) {
        countMap[row.user_id] = (countMap[row.user_id] || 0) + 1;
      }
    }

    // Pull DB-backed roles in one batch
    const { data: settingsRows } = await adminClient
      .from("user_settings")
      .select("user_id, role");
    const roleMap: Record<string, string> = {};
    for (const r of settingsRows ?? []) {
      roleMap[r.user_id as string] = r.role as string;
    }

    return users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      // DB-backed first, legacy user_metadata fallback (so unmigrated users still appear)
      role: roleMap[u.id] ?? (u.user_metadata?.role as string) ?? "user",
      lead_count: countMap[u.id] ?? 0,
      is_banned: !!u.banned_until,
    }));
  } catch (err) {
    console.error("getAllUsers fehlgeschlagen:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Benutzer-Details abrufen
// ---------------------------------------------------------------------------

export async function getUserDetail(
  userId: string
): Promise<{
  user: AdminUser;
  leads: Lead[];
  settings: UserSettings | null;
  searchRuns: SearchRun[];
} | null> {
  try {
    await requireAdmin();
    const adminClient = createAdminClient();

    // Benutzer abrufen
    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.admin.getUserById(userId);

    if (userError || !user) {
      console.error(
        "Fehler beim Abrufen des Benutzers:",
        userError?.message ?? "Benutzer nicht gefunden"
      );
      return null;
    }

    // Leads abrufen
    const { data: leads, error: leadsError } = await adminClient
      .from("solar_lead_mass")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (leadsError) {
      console.error("Fehler beim Abrufen der Leads:", leadsError.message);
    }

    // Einstellungen abrufen
    const { data: settings, error: settingsError } = await adminClient
      .from("user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (settingsError) {
      console.error(
        "Fehler beim Abrufen der Einstellungen:",
        settingsError.message
      );
    }

    // Letzte Suchlaeufe abrufen
    const { data: searchRuns, error: searchError } = await adminClient
      .from("search_runs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (searchError) {
      console.error(
        "Fehler beim Abrufen der Suchlaeufe:",
        searchError.message
      );
    }

    // Lead-Anzahl
    const leadCount = leads?.length ?? 0;

    const adminUser: AdminUser = {
      id: user.id,
      email: user.email ?? "",
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at ?? null,
      role: (user.user_metadata?.role as string) ?? "user",
      lead_count: leadCount,
      is_banned: !!user.banned_until,
    };

    return {
      user: adminUser,
      leads: (leads as Lead[]) ?? [],
      settings: (settings as UserSettings) ?? null,
      searchRuns: (searchRuns as SearchRun[]) ?? [],
    };
  } catch (err) {
    console.error("getUserDetail fehlgeschlagen:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// System-Statistiken abrufen
// ---------------------------------------------------------------------------

export async function getSystemStats(): Promise<SystemStats> {
  try {
    await requireAdmin();
    const adminClient = createAdminClient();

    // Benutzer-Gesamtzahl
    const {
      data: { users },
      error: usersError,
    } = await adminClient.auth.admin.listUsers();

    if (usersError) {
      console.error("Fehler beim Abrufen der Benutzer:", usersError.message);
    }

    const totalUsers = users?.length ?? 0;

    // Neue Benutzer der letzten 7 Tage
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString();

    const newUsersLast7Days =
      users?.filter((u) => u.created_at >= sevenDaysAgoISO).length ?? 0;

    // Alle Leads abrufen fuer Statistiken
    const { data: allLeads, error: leadsError } = await adminClient
      .from("solar_lead_mass")
      .select("status, category, total_score");

    if (leadsError) {
      console.error("Fehler beim Abrufen der Leads:", leadsError.message);
    }

    const totalLeads = allLeads?.length ?? 0;

    // Leads nach Status
    const leadsByStatus: Record<string, number> = {};
    if (allLeads) {
      for (const lead of allLeads) {
        const status = lead.status ?? "unbekannt";
        leadsByStatus[status] = (leadsByStatus[status] || 0) + 1;
      }
    }

    // Leads nach Kategorie
    const leadsByCategory: Record<string, number> = {};
    if (allLeads) {
      for (const lead of allLeads) {
        const category = lead.category ?? "unbekannt";
        leadsByCategory[category] = (leadsByCategory[category] || 0) + 1;
      }
    }

    // Durchschnittlicher Score
    let avgScore = 0;
    if (allLeads && allLeads.length > 0) {
      const totalScore = allLeads.reduce(
        (sum, lead) => sum + (lead.total_score ?? 0),
        0
      );
      avgScore = Math.round((totalScore / allLeads.length) * 100) / 100;
    }

    // Suchlaeufe der letzten 7 Tage
    const { count: searchRunCount, error: searchError } = await adminClient
      .from("search_runs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgoISO);

    if (searchError) {
      console.error(
        "Fehler beim Zaehlen der Suchlaeufe:",
        searchError.message
      );
    }

    return {
      totalUsers,
      totalLeads,
      leadsByStatus,
      leadsByCategory,
      avgScore,
      newUsersLast7Days,
      searchRunsLast7Days: searchRunCount ?? 0,
    };
  } catch (err) {
    console.error("getSystemStats fehlgeschlagen:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Benutzer-Rolle aktualisieren
// ---------------------------------------------------------------------------

export type AppRole = "user" | "reply_specialist" | "team_lead" | "admin";

export async function updateUserRole(
  userId: string,
  role: AppRole
): Promise<boolean> {
  try {
    await requireAdmin();
    const adminClient = createAdminClient();

    // Source of truth: user_settings.role (DB-backed, server-controlled).
    // We upsert the row so users without a settings row get one.
    const { error: settingsErr } = await adminClient
      .from("user_settings")
      .upsert(
        { user_id: userId, role },
        { onConflict: "user_id" }
      );
    if (settingsErr) {
      console.error("Fehler beim Aktualisieren von user_settings.role:", settingsErr.message);
      return false;
    }

    // Best-effort: keep user_metadata.role in sync for legacy code paths still
    // reading from there. Failures are non-fatal.
    try {
      await adminClient.auth.admin.updateUserById(userId, {
        user_metadata: { role },
      });
    } catch (e) {
      console.warn("[updateUserRole] could not sync user_metadata:", e);
    }

    return true;
  } catch (err) {
    console.error("updateUserRole fehlgeschlagen:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Benutzer sperren
// ---------------------------------------------------------------------------

export async function banUser(userId: string): Promise<boolean> {
  try {
    await requireAdmin();
    const adminClient = createAdminClient();

    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: "876600h",
    });

    if (error) {
      console.error("Fehler beim Sperren des Benutzers:", error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error("banUser fehlgeschlagen:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Benutzer entsperren
// ---------------------------------------------------------------------------

export async function unbanUser(userId: string): Promise<boolean> {
  try {
    await requireAdmin();
    const adminClient = createAdminClient();

    const { error } = await adminClient.auth.admin.updateUserById(userId, {
      ban_duration: "none",
    });

    if (error) {
      console.error("Fehler beim Entsperren des Benutzers:", error.message);
      return false;
    }

    return true;
  } catch (err) {
    console.error("unbanUser fehlgeschlagen:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Alle Leads eines Benutzers loeschen
// ---------------------------------------------------------------------------

export async function deleteUserLeads(userId: string): Promise<number> {
  try {
    await requireAdmin();
    const adminClient = createAdminClient();

    // Zuerst zaehlen
    const { count, error: countError } = await adminClient
      .from("solar_lead_mass")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) {
      console.error("Fehler beim Zaehlen der Leads:", countError.message);
      throw new Error("Leads konnten nicht gezaehlt werden");
    }

    // Dann loeschen
    const { error: deleteError } = await adminClient
      .from("solar_lead_mass")
      .delete()
      .eq("user_id", userId);

    if (deleteError) {
      console.error("Fehler beim Loeschen der Leads:", deleteError.message);
      throw new Error("Leads konnten nicht geloescht werden");
    }

    return count ?? 0;
  } catch (err) {
    console.error("deleteUserLeads fehlgeschlagen:", err);
    throw err;
  }
}
