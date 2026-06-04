/**
 * GET  /api/admin/leads/existing-solar
 *
 * Liefert alle Leads mit status='existing_solar' inkl. Detection-Quelle und
 * Stats (Total, diese Woche, aufgeschlüsselt nach Quelle).
 *
 * POST /api/admin/leads/existing-solar/reactivate
 *   Wird über separate Route gehandhabt; diese Datei ist nur die Liste.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin-gate";

export async function GET(req: Request) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { supabase } = gate;

  const url = new URL(req.url);
  const sourceFilter = url.searchParams.get("source");
  const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit") ?? 500)));

  let q = supabase
    .from("solar_lead_mass")
    .select(
      "id, company_name, city, category, total_score, existing_solar_at, existing_solar_source, updated_at"
    )
    .eq("status", "existing_solar")
    .order("existing_solar_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (sourceFilter) q = q.eq("existing_solar_source", sourceFilter);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Counts: total + diese Woche + nach Quelle
  const { data: allRows } = await supabase
    .from("solar_lead_mass")
    .select("existing_solar_at, existing_solar_source")
    .eq("status", "existing_solar");

  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const counts = {
    total: allRows?.length ?? 0,
    this_week: 0,
    by_source: {} as Record<string, number>,
  };
  for (const r of allRows ?? []) {
    const src = (r.existing_solar_source as string | null) ?? "unbekannt";
    counts.by_source[src] = (counts.by_source[src] ?? 0) + 1;
    if (r.existing_solar_at && new Date(r.existing_solar_at).getTime() > oneWeekAgo) {
      counts.this_week++;
    }
  }

  return NextResponse.json({
    rows: rows ?? [],
    counts,
  });
}
