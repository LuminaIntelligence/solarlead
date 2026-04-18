export interface SolarQuery {
  latitude: number;
  longitude: number;
  place_id?: string;
}

export interface SolarResult {
  solar_quality: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  max_array_panels_count: number | null;
  max_array_area_m2: number | null;
  annual_energy_kwh: number | null;
  sunshine_hours: number | null;
  carbon_offset: number | null;
  segment_count: number | null;
  panel_capacity_watts: number | null;
  raw_response_json: Record<string, unknown>;
}

export interface SolarProvider {
  name: string;
  assess(query: SolarQuery): Promise<SolarResult | null>;
}
