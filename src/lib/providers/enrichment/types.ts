export interface EnrichmentQuery {
  website: string;
}

export interface EnrichmentResult {
  website_title: string | null;
  meta_description: string | null;
  detected_keywords: string[];
  enrichment_score: number; // 0-100
}

export interface EnrichmentProvider {
  name: string;
  enrich(query: EnrichmentQuery): Promise<EnrichmentResult | null>;
}
