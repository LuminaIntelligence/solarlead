/**
 * OpenStreetMap Overpass API — Rooftop Solar Detection
 *
 * Queries the free Overpass API to detect existing solar panel installations
 * within a radius around a given coordinate. No API key required.
 *
 * OSM tags checked:
 *   - generator:source=solar + generator:place=roof  (rooftop PV)
 *   - power=generator + generator:source=solar       (any solar generator)
 */

const OVERPASS_API = "https://overpass-api.de/api/interpreter";
const RADIUS_METERS = 150;
const QUERY_TIMEOUT_SECONDS = 10;

export interface SolarDetectionResult {
  hasSolar: boolean;
  count: number;
  source: "osm";
}

/**
 * Check whether an OSM-mapped solar installation exists within ~150 m of the given coordinates.
 * Returns { hasSolar: false } on network errors so the caller is never blocked.
 */
export async function checkExistingSolarOsm(
  latitude: number,
  longitude: number
): Promise<SolarDetectionResult> {
  const query = [
    `[out:json][timeout:${QUERY_TIMEOUT_SECONDS}];`,
    "(",
    `  node["generator:source"="solar"]["generator:place"="roof"](around:${RADIUS_METERS},${latitude},${longitude});`,
    `  way["generator:source"="solar"]["generator:place"="roof"](around:${RADIUS_METERS},${latitude},${longitude});`,
    `  node["power"="generator"]["generator:source"="solar"](around:${RADIUS_METERS},${latitude},${longitude});`,
    `  way["power"="generator"]["generator:source"="solar"](around:${RADIUS_METERS},${latitude},${longitude});`,
    ");",
    "out count;",
  ].join("\n");

  try {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      (QUERY_TIMEOUT_SECONDS + 3) * 1000
    );

    const res = await fetch(OVERPASS_API, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      console.warn(`[Overpass] HTTP ${res.status} for (${latitude}, ${longitude})`);
      return { hasSolar: false, count: 0, source: "osm" };
    }

    const json = await res.json();

    // `out count` returns a single element with tag "total"
    const totalStr: string | undefined =
      json?.elements?.[0]?.tags?.total;
    const count = totalStr ? parseInt(totalStr, 10) : (json?.elements?.length ?? 0);

    return { hasSolar: count > 0, count, source: "osm" };
  } catch (e) {
    console.warn("[Overpass] Request failed:", e instanceof Error ? e.message : e);
    return { hasSolar: false, count: 0, source: "osm" };
  }
}
