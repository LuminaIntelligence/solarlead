import type { SolarProvider, SolarQuery, SolarResult } from "./types";

interface BuildingInsightsResponse {
  solarPotential?: {
    maxArrayPanelsCount?: number;
    maxArrayAreaMeters2?: number;
    maxSunshineHoursPerYear?: number;
    carbonOffsetFactorKgPerMwh?: number;
    roofSegmentStats?: unknown[];
    solarPanelConfigs?: SolarPanelConfig[];
    panelCapacityWatts?: number;
    panelHeightMeters?: number;
    panelWidthMeters?: number;
    panelLifetimeYears?: number;
  };
  name?: string;
  center?: { latitude?: number; longitude?: number };
  imageryDate?: { year?: number; month?: number; day?: number };
  regionCode?: string;
  imageryQuality?: string;
}

interface SolarPanelConfig {
  panelsCount?: number;
  yearlyEnergyDcKwh?: number;
  roofSegmentSummaries?: unknown[];
}

export class GoogleSolarProvider implements SolarProvider {
  name = "google_solar";
  private apiKey: string;
  private baseUrl = "https://solar.googleapis.com/v1/buildingInsights:findClosest";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async assess(query: SolarQuery): Promise<SolarResult | null> {
    try {
      const params = new URLSearchParams({
        "location.latitude": query.latitude.toString(),
        "location.longitude": query.longitude.toString(),
        requiredQuality: "LOW",
        key: this.apiKey,
      });

      const response = await fetch(`${this.baseUrl}?${params.toString()}`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        // Always throw so the caller can log the exact reason to the DB
        if (response.status === 404) {
          throw new Error(`Keine Gebäudedaten für diese Koordinaten (404)`);
        }
        if (response.status === 429) {
          throw new Error(`API-Kontingent erschöpft (429) — bitte Quota erhöhen`);
        }
        if (response.status === 403) {
          throw new Error(`API-Key ungültig oder Solar API nicht aktiviert (403)`);
        }
        throw new Error(`Solar API Fehler ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const data = (await response.json()) as BuildingInsightsResponse;
      return this.mapToSolarResult(data);
    } catch (error) {
      console.error(
        "[GoogleSolarProvider] Failed to assess solar potential:",
        error instanceof Error ? error.message : error
      );
      return null;
    }
  }

  private mapToSolarResult(data: BuildingInsightsResponse): SolarResult {
    const solar = data.solarPotential;

    if (!solar) {
      return {
        solar_quality: "UNKNOWN",
        max_array_panels_count: null,
        max_array_area_m2: null,
        annual_energy_kwh: null,
        sunshine_hours: null,
        carbon_offset: null,
        segment_count: null,
        panel_capacity_watts: null,
        raw_response_json: data as Record<string, unknown>,
      };
    }

    // Get the best panel configuration (max panels = max energy)
    const bestConfig = solar.solarPanelConfigs?.length
      ? solar.solarPanelConfigs[solar.solarPanelConfigs.length - 1]
      : undefined;

    const annualEnergyKwh = bestConfig?.yearlyEnergyDcKwh
      ? Math.round(bestConfig.yearlyEnergyDcKwh * 0.85) // Apply ~85% DC-to-AC conversion
      : null;

    const sunshineHours = solar.maxSunshineHoursPerYear
      ? Math.round(solar.maxSunshineHoursPerYear)
      : null;

    // Calculate carbon offset
    let carbonOffset: number | null = null;
    if (annualEnergyKwh != null && solar.carbonOffsetFactorKgPerMwh) {
      carbonOffset = Math.round(
        (annualEnergyKwh / 1000) * solar.carbonOffsetFactorKgPerMwh
      );
    }

    // Determine quality from imagery quality and potential
    const solar_quality = this.determineSolarQuality(
      data.imageryQuality,
      sunshineHours,
      solar.maxArrayPanelsCount
    );

    return {
      solar_quality,
      max_array_panels_count: solar.maxArrayPanelsCount ?? null,
      max_array_area_m2: solar.maxArrayAreaMeters2
        ? Math.round(solar.maxArrayAreaMeters2)
        : null,
      annual_energy_kwh: annualEnergyKwh,
      sunshine_hours: sunshineHours,
      carbon_offset: carbonOffset,
      segment_count: solar.roofSegmentStats?.length ?? null,
      panel_capacity_watts: solar.panelCapacityWatts ?? null,
      raw_response_json: data as Record<string, unknown>,
    };
  }

  private determineSolarQuality(
    imageryQuality?: string,
    sunshineHours?: number | null,
    panelCount?: number | null
  ): SolarResult["solar_quality"] {
    // LOW imagery quality from Google means uncertain data, not necessarily bad solar potential.
    // Treat as UNKNOWN so it doesn't unfairly tank the score.
    if (imageryQuality === "IMAGERY_QUALITY_UNSPECIFIED") {
      return "UNKNOWN";
    }

    if (sunshineHours == null || panelCount == null) {
      return "UNKNOWN";
    }

    // Thresholds calibrated for Germany, including northern regions
    // (Hamburg ~1500h, Schleswig-Holstein ~1400h, Bavaria ~1800h).
    if (sunshineHours > 1450 && panelCount > 80) {
      return "HIGH";
    }
    if (sunshineHours > 1050 && panelCount > 25) {
      return "MEDIUM";
    }
    return "LOW";
  }
}
