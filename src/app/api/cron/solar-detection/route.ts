/**
 * GET /api/cron/solar-detection
 *
 * Nächtlicher OSM-Solar-Check: Prüft alle aktiven Leads (status != existing_solar)
 * mit GPS-Koordinaten gegen die OpenStreetMap Overpass API.
 * Leads mit Solar-Anlage in 150 m Umkreis werden als "existing_solar" markiert.
 *
 * Läuft als Fire-and-Forget im Hintergrund — Antwort kommt sofort.
 * Gesichert mit CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkExistingSolarOsm } from "@/lib/providers/mastr/overpass";

// Einfache Sperre gegen parallele Läufe (in-memory, reicht für Singleton-Prozess)
let isRunning = false;

export async function GET(req: NextRequest) {
  // Authentifizierung
  const secret =
    req.headers.get("x-cron-secret") ?? req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isRunning) {
    return NextResponse.json({ ok: true, skipped: true, reason: "Vorheriger Lauf noch aktiv" });
  }

  // Fire-and-forget: sofort antworten, im Hintergrund verarbeiten
  setImmediate(() => runSolarDetection());

  return NextResponse.json({ ok: true, started: true, message: "OSM Solar-Check gestartet" });
}

async function runSolarDetection(): Promise<void> {
  if (isRunning) return;
  isRunning = true;

  const supabase = createAdminClient();
  const startedAt = new Date().toISOString();
  let checked = 0, marked = 0, errors = 0;

  try {
    console.log("[SolarCron] Start OSM Solar-Check");

    // Alle aktiven Leads mit GPS laden (paginiert)
    const leads: Array<{ id: string; latitude: number; longitude: number }> = [];
    let page = 0;
    while (true) {
      const { data, error } = await supabase
        .from("solar_lead_mass")
        .select("id, latitude, longitude")
        .neq("status", "existing_solar")
        .not("latitude", "is", null)
        .not("longitude", "is", null)
        .range(page * 1000, (page + 1) * 1000 - 1);

      if (error || !data?.length) break;
      leads.push(...(data as typeof leads));
      if (data.length < 1000) break;
      page++;
    }

    console.log(`[SolarCron] ${leads.length} Leads zu prüfen`);

    const now = new Date().toISOString();

    for (const lead of leads) {
      try {
        const result = await checkExistingSolarOsm(lead.latitude, lead.longitude);

        if (result.hasSolar) {
          await supabase
            .from("solar_lead_mass")
            .update({ status: "existing_solar", updated_at: now })
            .eq("id", lead.id);
          marked++;
        }

        checked++;

        // Fortschritt alle 50 Leads loggen
        if (checked % 50 === 0) {
          console.log(`[SolarCron] ${checked}/${leads.length} geprüft, ${marked} markiert`);
        }

        // 350 ms Pause — Overpass Rate-Limit schonen
        await new Promise((r) => setTimeout(r, 350));
      } catch (e) {
        errors++;
        console.warn(`[SolarCron] Fehler bei Lead ${lead.id}:`, e);
      }
    }

    console.log(
      `[SolarCron] Fertig — geprüft: ${checked}, markiert: ${marked}, Fehler: ${errors}, ` +
      `gestartet: ${startedAt}, beendet: ${new Date().toISOString()}`
    );
  } catch (e) {
    console.error("[SolarCron] Kritischer Fehler:", e);
  } finally {
    isRunning = false;
  }
}
