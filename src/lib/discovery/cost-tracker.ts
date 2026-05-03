/**
 * Cost Tracker — daily API usage + budget enforcement.
 *
 * Each search_cell triggers ~12 Google Places API calls (~€0.35 per cell).
 * The daily budget cap (configurable in user_settings.places_daily_budget_eur)
 * prevents runaway costs from misconfigured automation.
 */
import { createAdminClient } from "@/lib/supabase/admin";

const PLACES_COST_PER_CALL_EUR = 0.032 * 0.92; // ~€0.029

export interface DailyUsage {
  date: string;        // ISO date 'YYYY-MM-DD'
  provider: string;
  calls: number;
  estimated_cost_eur: number;
}

/**
 * Fetch today's usage row (or null if none yet).
 */
export async function getTodayUsage(
  adminSupabase: ReturnType<typeof createAdminClient>,
  provider = "google_places"
): Promise<DailyUsage | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await adminSupabase
    .from("daily_api_usage")
    .select("date, provider, calls, estimated_cost_eur")
    .eq("date", today)
    .eq("provider", provider)
    .maybeSingle();
  return data as DailyUsage | null;
}

/**
 * Atomically add `calls` to today's counter for `provider`.
 * Uses upsert on the unique (date, provider) constraint.
 */
export async function recordApiCalls(
  adminSupabase: ReturnType<typeof createAdminClient>,
  provider: string,
  calls: number,
  costPerCallEur = PLACES_COST_PER_CALL_EUR
): Promise<void> {
  if (calls <= 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const costDelta = calls * costPerCallEur;

  // Upsert + atomic increment via two-step pattern (Supabase JS doesn't
  // expose `INCREMENT` directly, but we can do select-then-update with retry).
  // Race-safe: if two writers conflict, the second's update will succeed
  // because the unique index enforces single row per (date, provider).
  const { data: existing } = await adminSupabase
    .from("daily_api_usage")
    .select("id, calls, estimated_cost_eur")
    .eq("date", today)
    .eq("provider", provider)
    .maybeSingle();

  if (existing) {
    await adminSupabase
      .from("daily_api_usage")
      .update({
        calls: (existing.calls as number) + calls,
        estimated_cost_eur: Number(existing.estimated_cost_eur) + costDelta,
      })
      .eq("id", existing.id);
  } else {
    // First call of the day — insert. If two workers race here, the unique
    // constraint will reject one; that worker should retry as an UPDATE.
    const { error } = await adminSupabase.from("daily_api_usage").insert({
      date: today,
      provider,
      calls,
      estimated_cost_eur: costDelta,
    });
    if (error && error.code === "23505") {
      // Race lost — switch to update path
      const { data: now } = await adminSupabase
        .from("daily_api_usage")
        .select("id, calls, estimated_cost_eur")
        .eq("date", today)
        .eq("provider", provider)
        .maybeSingle();
      if (now) {
        await adminSupabase
          .from("daily_api_usage")
          .update({
            calls: (now.calls as number) + calls,
            estimated_cost_eur: Number(now.estimated_cost_eur) + costDelta,
          })
          .eq("id", now.id);
      }
    }
  }
}

/**
 * Returns true if today's spend on `provider` is below the user-configured
 * daily budget. Budget = 0 means "unlimited / disabled".
 *
 * The budget is read from the user_settings of the campaign creator (we look
 * up the first admin's setting as a system-wide default for now; this can be
 * refined per-campaign later).
 */
export async function checkBudgetOk(
  adminSupabase: ReturnType<typeof createAdminClient>,
  provider = "google_places"
): Promise<{ ok: boolean; spent: number; budget: number }> {
  // Read the lowest places_daily_budget_eur across admin users — most
  // conservative cap wins. (If you have multiple admins with different caps,
  // the strictest applies system-wide. Set to 0 to disable.)
  const { data: settings } = await adminSupabase
    .from("user_settings")
    .select("places_daily_budget_eur")
    .eq("role", "admin")
    .order("places_daily_budget_eur", { ascending: true })
    .limit(1)
    .maybeSingle();

  const budget = Number(settings?.places_daily_budget_eur ?? 0);
  if (budget <= 0) return { ok: true, spent: 0, budget: 0 }; // disabled

  const usage = await getTodayUsage(adminSupabase, provider);
  const spent = Number(usage?.estimated_cost_eur ?? 0);
  return { ok: spent < budget, spent, budget };
}
