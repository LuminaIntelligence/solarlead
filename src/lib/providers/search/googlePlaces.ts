import type { SearchProvider, SearchQuery, SearchResult } from "./types";

/** Maps internal category names to Google Places text search queries */
const CATEGORY_SEARCH_TERMS: Record<string, string> = {
  logistics: "logistics company",
  warehouse: "warehouse storage facility",
  cold_storage: "cold storage refrigerated warehouse",
  supermarket: "supermarket grocery store",
  food_production: "food production factory",
  manufacturing: "manufacturing plant factory",
  metalworking: "metalworking metal fabrication",
  car_dealership: "car dealership auto dealer",
  hotel: "hotel",
  furniture_store: "furniture store",
  hardware_store: "hardware store building supplies",
  shopping_center: "shopping center mall",
};

interface PlacesTextSearchResponse {
  places?: PlacesResult[];
  nextPageToken?: string;
}

interface PlacesResult {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  id?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  rating?: number;
  types?: string[];
}

export class GooglePlacesProvider implements SearchProvider {
  name = "google_places";
  private apiKey: string;
  private baseUrl = "https://places.googleapis.com/v1/places:searchText";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];

    for (const category of query.categories) {
      try {
        const results = await this.searchCategory(query, category);
        allResults.push(...results);
      } catch (error) {
        console.error(
          `[GooglePlacesProvider] Failed to search category "${category}":`,
          error instanceof Error ? error.message : error
        );
      }
    }

    return allResults;
  }

  /** Search a single city+category with pagination — up to maxPages×20 results */
  async searchCategoryPaginated(
    city: string,
    country: string,
    category: string,
    keyword?: string,
    maxPages = 3
  ): Promise<SearchResult[]> {
    const query: SearchQuery = {
      city,
      country,
      categories: [category],
      radius_km: 30,
      keywords: keyword,
    };
    const allResults: SearchResult[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      try {
        const { results, nextPageToken } = await this.searchCategoryPage(query, category, pageToken);
        allResults.push(...results);
        if (!nextPageToken) break;
        pageToken = nextPageToken;
        // Brief pause to respect rate limits between pages
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error(`[GooglePlaces] Page ${page + 1} failed for ${city}/${category}:`, err);
        break;
      }
    }

    return allResults;
  }

  private async searchCategoryPage(
    query: SearchQuery,
    category: string,
    pageToken?: string
  ): Promise<{ results: SearchResult[]; nextPageToken?: string }> {
    const searchTerm = CATEGORY_SEARCH_TERMS[category] ?? category;
    const textQuery = query.keywords
      ? `${searchTerm} ${query.keywords} in ${query.city}, ${query.country}`
      : `${searchTerm} in ${query.city}, ${query.country}`;

    const requestBody: Record<string, unknown> = {
      textQuery,
      locationBias: {
        circle: {
          center: { latitude: 0, longitude: 0 },
          radius: query.radius_km * 1000,
        },
      },
      maxResultCount: 20,
      languageCode: "de",
    };

    if (pageToken) requestBody.pageToken = pageToken;

    const fieldMask = [
      "places.displayName",
      "places.formattedAddress",
      "places.location",
      "places.id",
      "places.internationalPhoneNumber",
      "places.websiteUri",
      "places.rating",
      "nextPageToken",
    ].join(",");

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": fieldMask,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Google Places API returned ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as PlacesTextSearchResponse;

    const results = (data.places ?? [])
      .filter(
        (place): place is PlacesResult & { location: NonNullable<PlacesResult["location"]> } =>
          place.location?.latitude != null && place.location?.longitude != null
      )
      .map((place) => this.mapToSearchResult(place, category, query));

    return { results, nextPageToken: data.nextPageToken };
  }

  private async searchCategory(
    query: SearchQuery,
    category: string
  ): Promise<SearchResult[]> {
    const { results } = await this.searchCategoryPage(query, category);
    return results;
  }

  private mapToSearchResult(
    place: PlacesResult & { location: { latitude?: number; longitude?: number } },
    category: string,
    query: SearchQuery
  ): SearchResult {
    const address = place.formattedAddress ?? "";
    const postalMatch = address.match(/\b(\d{5})\b/);

    return {
      company_name: place.displayName?.text ?? "Unknown",
      category,
      address: address.replace(/,?\s*\d{5}\s*\w+,?\s*Germany$/i, "").trim() || address,
      city: query.city,
      postal_code: postalMatch?.[1] ?? null,
      country: query.country,
      latitude: place.location.latitude ?? 0,
      longitude: place.location.longitude ?? 0,
      place_id: place.id ?? null,
      phone: place.internationalPhoneNumber ?? null,
      website: place.websiteUri ?? null,
      rating: place.rating ?? null,
    };
  }
}
