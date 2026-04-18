export interface SearchQuery {
  country: string;
  city: string;
  radius_km: number;
  categories: string[];
  keywords?: string;
}

export interface SearchResult {
  company_name: string;
  category: string;
  address: string;
  city: string;
  postal_code: string | null;
  country: string;
  latitude: number;
  longitude: number;
  place_id: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
}

export interface SearchProvider {
  name: string;
  search(query: SearchQuery): Promise<SearchResult[]>;
}
