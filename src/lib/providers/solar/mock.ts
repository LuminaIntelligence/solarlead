import type { SolarProvider, SolarQuery, SolarResult } from "./types";

/**
 * Deterministic pseudo-random number generator seeded by coordinates.
 * Ensures consistent results for the same location across calls.
 */
function seededRandom(lat: number, lng: number): () => number {
  let seed = Math.abs(Math.round(lat * 10000) ^ Math.round(lng * 10000));
  return () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/**
 * Estimates sunshine hours based on latitude.
 * Southern Germany (~47.5) gets more sun than northern (~54.5).
 */
function estimateSunshineHours(latitude: number): number {
  const baseHours = 1800;
  const latitudeEffect = (52 - latitude) * -30; // more south = more sun
  return Math.round(baseHours + latitudeEffect);
}

export class MockSolarProvider implements SolarProvider {
  name = "mock";

  async assess(query: SolarQuery): Promise<SolarResult | null> {
    // Simulate async delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    const rand = seededRandom(query.latitude, query.longitude);
    const r1 = rand();
    const r2 = rand();
    const r3 = rand();
    const r4 = rand();

    const sunshineHours = estimateSunshineHours(query.latitude);

    // Determine solar quality based on latitude and randomness
    let solar_quality: SolarResult["solar_quality"];
    const qualityScore = sunshineHours / 2000 + r1 * 0.3;
    if (qualityScore > 0.95) {
      solar_quality = "HIGH";
    } else if (qualityScore > 0.75) {
      solar_quality = "MEDIUM";
    } else if (qualityScore > 0.5) {
      solar_quality = "LOW";
    } else {
      solar_quality = "UNKNOWN";
    }

    // Generate realistic panel and area data
    const max_array_panels_count = Math.round(50 + r2 * 450); // 50-500
    const panelAreaM2 = max_array_panels_count * (1.7 + r3 * 0.5); // ~1.7-2.2 m2 per panel
    const max_array_area_m2 = Math.round(panelAreaM2);

    // Annual energy depends on panel count, sunshine, and efficiency
    const efficiencyFactor = 0.15 + r4 * 0.07; // 15-22% efficiency
    const annual_energy_kwh = Math.round(
      max_array_area_m2 * (sunshineHours / 1000) * efficiencyFactor * 1000
    );

    // Carbon offset: ~0.4 kg CO2 per kWh for German grid
    const carbon_offset = Math.round(annual_energy_kwh * 0.4);

    // Segment count: roof sections
    const segment_count = Math.round(2 + r1 * 8); // 2-10 segments

    // Panel capacity: typical 380-420 Wp
    const panel_capacity_watts = Math.round(380 + r2 * 40);

    return {
      solar_quality,
      max_array_panels_count,
      max_array_area_m2,
      annual_energy_kwh,
      sunshine_hours: sunshineHours,
      carbon_offset,
      segment_count,
      panel_capacity_watts,
      raw_response_json: {
        provider: "mock",
        latitude: query.latitude,
        longitude: query.longitude,
        generated_at: new Date().toISOString(),
      },
    };
  }
}
