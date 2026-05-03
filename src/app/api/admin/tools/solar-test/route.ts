/**
 * GET /api/admin/tools/solar-test
 * Testet den Google Solar API Key mit einem echten Request (München Marienplatz).
 * Gibt status, latenz und Fehlerdetails zurück.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";


import { requireAdmin } from "@/lib/auth/admin-gate";
export async function GET(req: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  const { user, supabase } = gate;

  const apiKey = process.env.GOOGLE_SOLAR_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      status: "missing_key",
      message: "GOOGLE_SOLAR_API_KEY ist nicht als Server-Umgebungsvariable gesetzt.",
      hint: "Füge GOOGLE_SOLAR_API_KEY=... in die .env.local auf dem Server ein und starte PM2 neu.",
    });
  }

  // Test mit München Marienplatz (gut abgedeckter Standort)
  const testLat = 48.1374;
  const testLng = 11.5755;
  const start = Date.now();

  try {
    const params = new URLSearchParams({
      "location.latitude": testLat.toString(),
      "location.longitude": testLng.toString(),
      requiredQuality: "LOW",
      key: apiKey,
    });

    const res = await fetch(
      `https://solar.googleapis.com/v1/buildingInsights:findClosest?${params}`,
      { signal: AbortSignal.timeout(15_000) }
    );

    const latencyMs = Date.now() - start;

    if (res.status === 403) {
      const body = await res.text().catch(() => "");
      return NextResponse.json({
        ok: false,
        status: "invalid_key",
        httpStatus: 403,
        latencyMs,
        message: "API-Key ungültig oder Google Solar API ist für diesen Key nicht aktiviert.",
        hint: "Prüfe ob 'Solar API' in der Google Cloud Console aktiviert ist.",
        detail: body.slice(0, 300),
      });
    }

    if (res.status === 429) {
      return NextResponse.json({
        ok: false,
        status: "quota_exceeded",
        httpStatus: 429,
        latencyMs,
        message: "API-Kontingent erschöpft (Rate Limit oder Daily Quota).",
        hint: "Erhöhe das Kontingent in der Google Cloud Console oder warte bis morgen.",
      });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json({
        ok: false,
        status: "api_error",
        httpStatus: res.status,
        latencyMs,
        message: `Solar API returned HTTP ${res.status}`,
        detail: body.slice(0, 300),
      });
    }

    const data = await res.json();
    const panels = data?.solarPotential?.maxArrayPanelsCount ?? null;

    return NextResponse.json({
      ok: true,
      status: "ok",
      latencyMs,
      message: `API funktioniert. Teststandort: ${panels ?? "?"} Panels möglich.`,
      keyPreview: `...${apiKey.slice(-6)}`,
    });
  } catch (e) {
    const latencyMs = Date.now() - start;
    return NextResponse.json({
      ok: false,
      status: "network_error",
      latencyMs,
      message: `Netzwerkfehler: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}
