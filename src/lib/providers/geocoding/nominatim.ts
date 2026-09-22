/**
 * Nominatim (OpenStreetMap) Geocoding — kostenlos, kein API-Key.
 *
 * Verwendung: für manuell angelegte Leads bei denen der Field-Member
 * keine GPS-Koordinaten mitgeliefert hat. Die Adresse wird server-side
 * gegen die OSM-Datenbank aufgelöst, damit anschließend Solar-Assessment
 * und OSM-Existing-Solar-Check laufen können.
 *
 * Nominatim-Policy (https://operations.osmfoundation.org/policies/nominatim/):
 *   - max 1 request per second per app (single-thread)
 *   - User-Agent required, muss die App identifizieren
 *   - Für hohes Volumen: eigenen Nominatim-Server oder kommerziellen
 *     Provider verwenden. Bei ~10 Requests/Tag total unproblematisch.
 */

const USER_AGENT =
  "GreenScoutSolarLead/1.0 (https://solarleadgen.lumina-intelligence.ai; sebastian.trautschold@greenscout-ev.de)";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

export interface GeocodeInput {
  street: string; // Straße + Hausnummer, z.B. "Bahnhofstr. 5"
  postal_code?: string | null; // z.B. "99091"
  city?: string | null; // z.B. "Erfurt"
  country?: string | null; // ISO-3166 alpha-2, default "de"
}

export interface GeocodeResult {
  ok: true;
  latitude: number;
  longitude: number;
  display_name: string;
  confidence: "high" | "medium" | "low";
}

export interface GeocodeError {
  ok: false;
  error: string;
}

/**
 * Löst eine Adresse zu Lat/Lng auf via Nominatim.
 * Rückgabe:
 *   - ok:true mit Koordinaten + Confidence
 *   - ok:false wenn keine Übereinstimmung oder Fehler
 */
export async function geocodeAddress(
  input: GeocodeInput
): Promise<GeocodeResult | GeocodeError> {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    limit: "1",
  });
  if (input.street) params.set("street", input.street);
  if (input.postal_code) params.set("postalcode", input.postal_code);
  if (input.city) params.set("city", input.city);
  params.set("country", (input.country ?? "de").toLowerCase());

  const url = `${NOMINATIM_URL}?${params.toString()}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Accept-Language": "de",
      },
      // Nominatim reagiert normalerweise in <500ms, wir setzen 8s als safety
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return {
        ok: false,
        error: `Nominatim HTTP ${res.status}: ${res.statusText}`,
      };
    }

    const data = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
      importance?: number;
      class?: string;
      type?: string;
    }>;

    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, error: "Keine Übereinstimmung für diese Adresse" };
    }

    const hit = data[0];
    const lat = parseFloat(hit.lat);
    const lng = parseFloat(hit.lon);
    if (!isFinite(lat) || !isFinite(lng)) {
      return { ok: false, error: "Ungültige Koordinaten von Nominatim" };
    }

    // Confidence-Heuristik basierend auf importance-Score und Hit-Type
    // importance > 0.5 = eindeutige Adresse; class="place" = Ort statt Straße
    const importance = hit.importance ?? 0;
    const isBuilding = hit.class === "building" || hit.class === "amenity" || hit.type === "house";
    let confidence: "high" | "medium" | "low" = "low";
    if (isBuilding || importance >= 0.5) confidence = "high";
    else if (importance >= 0.3) confidence = "medium";

    return {
      ok: true,
      latitude: lat,
      longitude: lng,
      display_name: hit.display_name,
      confidence,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Nominatim-Fehler: ${err.message}`
          : "Unbekannter Nominatim-Fehler",
    };
  }
}
