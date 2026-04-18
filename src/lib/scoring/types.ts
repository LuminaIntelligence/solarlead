export interface ScoringWeights {
  business: number;   // 0-1, default 0.30
  electricity: number; // 0-1, default 0.25
  solar: number;       // 0-1, default 0.25
  outreach: number;    // 0-1, default 0.20
}

export interface ScoringInput {
  category: string;
  solarData?: {
    solar_quality: string | null;
    max_array_panels_count: number | null;
    max_array_area_m2: number | null;
    annual_energy_kwh: number | null;
  } | null;
  enrichmentData?: {
    detected_keywords: string[];
    enrichment_score: number;
  } | null;
  hasWebsite: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
}

export interface ScoringBreakdown {
  business_score: number;    // 0-100
  electricity_score: number; // 0-100
  solar_score: number;       // 0-100
  outreach_score: number;    // 0-100
  total_score: number;       // 0-100
  explanations: {
    business: string;
    electricity: string;
    solar: string;
    outreach: string;
  };
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  business: 0.30,
  electricity: 0.25,
  solar: 0.25,
  outreach: 0.20,
};
