/**
 * OSM + PVGIS Solar Provider
 *
 * Fallback for locations where Google Solar API has no coverage (HTTP 404).
 * Combines two free, quota-free data sources:
 *
 *  1. OpenStreetMap (Overpass API)
 *     → Fetches the building footprint polygon at the given coordinates
 *     → Calculates gross roof area via the Shoelace formula
 *
 *  2. PVGIS (EU Joint Research Centre, re.jrc.ec.europa.eu)
 *     → Returns annual energy yield (kWh/kWp) for the location
 *     → Full European coverage including all of Germany
 *
 * From those two values we derive:
 *   usable_area  = gross_area × 0.50  (50% — conservative for flat commercial roofs)
 *   panels       = floor(usable_area / PANEL_AREA_M2)
 *   annual_kwh   = panels × PANEL_KWP × pvgis_E_y_per_kwp
 *
 * Results are marked provider = "osm_pvgis" so they are clearly distinguishable
 * from full Google Solar assessments.
 */

import type { SolarProvider, SolarQuery, SolarResult } from "./types";

// Standard 400 W panel dimensions (most common on commercial roofs in DE)
const PANEL_AREA_M2 = 1.65;    // physical panel size
const PANEL_KWP = 0.4;         // 400 Wp = 0.4 kWp per panel
// Conservative usable fraction for flat/low-slope commercial roofs
// (accounts for row spacing, equipment, access paths)
const USABLE_ROOF_FRACTION = 0.50;
// German grid emission factor (UBA 2023: 0.380 kg CO₂/kWh)
const CARBON_KG_PER_KWH = 0.38;

const OVERPASS_API = "https://overpass-api.de/api/interpreter";
const PVGIS_API = "https://re.jrc.ec.europa.eu/api/v5_2/PVcalc";
const BUILDING_SEARCH_RADIUS_M = 60; // look within 60 m of the coordinates

interface OverpassWay {
  type: string;
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}

interface PvgisResponse {
  outputs?: {
    totals?: {
      fixed?: {
        E_y?: number;   // Annual energy yield [kWh/kWp]
        H_i_y?: number; // Annual in-plane irradiation [kWh/m²]
      };
    };
  };
}

export class OsmPvgisProvider implements SolarProvider {
  name = "osm_pvgis";

  async assess(query: SolarQuery): Promise<SolarResult | null> {
    const { latitude, longitude } = query;

    // Run both requests in parallel — they are independent
    const [buildingAreaM2, pvgisData] = await Promise.all([
      this.getBuildingAreaM2(latitude, longitude),
      this.getPvgisData(latitude, longitude),
    ]);

    if (!buildingAreaM2 || buildingAreaM2 < 50) {
      // No building found in OSM, or building is too small to be relevant
      return null;
    }

    if (!pvgisData) {
      // PVGIS unavailable — still return area data with null energy fields
      // so the lead at least gets a roof area estimate
      return this.buildResultWithoutPvgis(buildingAreaM2);
    }

    const usableAreaM2 = Math.round(buildingAreaM2 * USABLE_ROOF_FRACTION);
    const panelsCount = Math.floor(usableAreaM2 / PANEL_AREA_M2);
    const totalKwp = panelsCount * PANEL_KWP;

    // E_y is annual energy per kWp — multiply by total kWp for the full array
    const annualEnergyKwh = Math.round(totalKwp * pvgisData.annualEnergyPerKwp);

    // Equivalent sunshine hours ≈ E_y (energy per kWp ≈ peak-sun-hours)
    const sunshineHours = Math.round(pvgisData.annualEnergyPerKwp);

    // Carbon offset
    const carbonOffset = Math.round(annualEnergyKwh * CARBON_KG_PER_KWH);

    return {
      solar_quality: this.determineSolarQuality(sunshineHours, panelsCount),
      max_array_panels_count: panelsCount > 0 ? panelsCount : null,
      max_array_area_m2: usableAreaM2,
      annual_energy_kwh: annualEnergyKwh > 0 ? annualEnergyKwh : null,
      sunshine_hours: sunshineHours,
      carbon_offset: carbonOffset > 0 ? carbonOffset : null,
      segment_count: 1, // single roof plane assumed
      panel_capacity_watts: PANEL_KWP * 1000,
      raw_response_json: {
        source: "osm_pvgis",
        grossBuildingAreaM2: buildingAreaM2,
        usableAreaM2,
        pvgisAnnualEnergyPerKwp: pvgisData.annualEnergyPerKwp,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Building footprint from OSM
  // ---------------------------------------------------------------------------

  private async getBuildingAreaM2(lat: number, lng: number): Promise<number | null> {
    const query = [
      `[out:json][timeout:12];`,
      `(`,
      `  way["building"](around:${BUILDING_SEARCH_RADIUS_M},${lat},${lng});`,
      `  relation["building"](around:${BUILDING_SEARCH_RADIUS_M},${lat},${lng});`,
      `);`,
      `out geom;`,
    ].join("\n");

    try {
      const res = await fetch(OVERPASS_API, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        console.warn(`[OsmPvgis] Overpass HTTP ${res.status}`);
        return null;
      }

      const data: { elements?: OverpassWay[] } = await res.json();
      const ways = (data.elements ?? []).filter(
        (el) => el.type === "way" && el.geometry && el.geometry.length >= 3
      );

      if (!ways.length) return null;

      // Take the largest building (most likely the main structure at that address)
      let maxArea = 0;
      for (const way of ways) {
        if (!way.geometry) continue;
        const area = this.calcPolygonAreaM2(way.geometry);
        if (area > maxArea) maxArea = area;
      }

      return maxArea > 0 ? Math.round(maxArea) : null;
    } catch (e) {
      console.warn("[OsmPvgis] Overpass request failed:", e instanceof Error ? e.message : e);
      return null;
    }
  }

  /**
   * Shoelace formula with flat-Earth approximation.
   * Error < 0.01 % for building-scale polygons — fully adequate.
   */
  private calcPolygonAreaM2(points: Array<{ lat: number; lon: number }>): number {
    const R = 6_371_000; // Earth radius in metres
    const latRef = (points[0].lat * Math.PI) / 180;
    const cosLat = Math.cos(latRef);

    // Project to local XY (metres)
    const coords = points.map((p) => ({
      x: (p.lon * Math.PI * R * cosLat) / 180,
      y: (p.lat * Math.PI * R) / 180,
    }));

    // Shoelace
    let area = 0;
    const n = coords.length;
    for (let i = 0; i < n - 1; i++) {
      area += coords[i].x * coords[i + 1].y - coords[i + 1].x * coords[i].y;
    }
    return Math.abs(area / 2);
  }

  // ---------------------------------------------------------------------------
  // Solar irradiance from PVGIS (EU Joint Research Centre)
  // ---------------------------------------------------------------------------

  private async getPvgisData(
    lat: number,
    lng: number
  ): Promise<{ annualEnergyPerKwp: number } | null> {
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lng.toString(),
      peakpower: "1",     // 1 kWp reference system
      loss: "14",         // 14 % system losses (typical for DE)
      aspect: "0",        // 0 = south-facing
      angle: "35",        // 35° tilt — close to optimum for Germany
      outputformat: "json",
    });

    try {
      const res = await fetch(`${PVGIS_API}?${params.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        console.warn(`[OsmPvgis] PVGIS HTTP ${res.status}`);
        return null;
      }

      const data: PvgisResponse = await res.json();
      const E_y = data?.outputs?.totals?.fixed?.E_y;

      if (!E_y || E_y <= 0) return null;

      return { annualEnergyPerKwp: E_y };
    } catch (e) {
      console.warn("[OsmPvgis] PVGIS request failed:", e instanceof Error ? e.message : e);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Return area-only result when PVGIS is unavailable */
  private buildResultWithoutPvgis(buildingAreaM2: number): SolarResult {
    const usableAreaM2 = Math.round(buildingAreaM2 * USABLE_ROOF_FRACTION);
    const panelsCount = Math.floor(usableAreaM2 / PANEL_AREA_M2);
    return {
      solar_quality: panelsCount > 80 ? "MEDIUM" : panelsCount > 25 ? "LOW" : "UNKNOWN",
      max_array_panels_count: panelsCount > 0 ? panelsCount : null,
      max_array_area_m2: usableAreaM2,
      annual_energy_kwh: null,    // no irradiance data
      sunshine_hours: null,
      carbon_offset: null,
      segment_count: 1,
      panel_capacity_watts: PANEL_KWP * 1000,
      raw_response_json: {
        source: "osm_pvgis",
        note: "PVGIS unavailable — area only",
        grossBuildingAreaM2: buildingAreaM2,
        usableAreaM2,
      },
    };
  }

  private determineSolarQuality(
    sunshineHours: number,
    panelCount: number
  ): SolarResult["solar_quality"] {
    // Same thresholds as GoogleSolarProvider (calibrated for Germany)
    if (sunshineHours > 1450 && panelCount > 80) return "HIGH";
    if (sunshineHours > 1050 && panelCount > 25) return "MEDIUM";
    return "LOW";
  }
}
