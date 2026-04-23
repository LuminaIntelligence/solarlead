import type { SearchProvider, SearchQuery, SearchResult } from "./types";

/** Maps internal category names to Google Places text search queries */
const CATEGORY_SEARCH_TERMS: Record<string, string> = {
  logistics:          "Logistik Spedition",
  warehouse:          "Lagerhalle Lager",
  cold_storage:       "Kühlhaus Tiefkühlhaus",
  supermarket:        "Supermarkt Lebensmittelmarkt",
  food_production:    "Lebensmittelproduktion Lebensmittelfabrik",
  manufacturing:      "Produktionswerk Fabrik Fertigung",
  metalworking:       "Metallverarbeitung Stahlbau",
  car_dealership:     "Autohaus Automobilhändler",
  hotel:              "Hotel",
  furniture_store:    "Möbelhaus Möbelmarkt",
  hardware_store:     "Baumarkt",
  shopping_center:    "Einkaufszentrum Fachmarkt",
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

  // ─── City-name based search (existing mode) ───────────────────────────────

  /** Search a single city+category with pagination — up to maxPages×20 results */
  async searchCategoryPaginated(
    city: string,
    country: string,
    category: string,
    keyword?: string,
    maxPages = 3
  ): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      try {
        const { results, nextPageToken } = await this.searchCityPage(
          city, country, category, keyword, pageToken
        );
        allResults.push(...results);
        if (!nextPageToken) break;
        pageToken = nextPageToken;
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error(`[GooglePlaces] Page ${page + 1} failed for ${city}/${category}:`, err);
        break;
      }
    }

    return allResults;
  }

  private async searchCityPage(
    city: string,
    country: string,
    category: string,
    keyword?: string,
    pageToken?: string
  ): Promise<{ results: SearchResult[]; nextPageToken?: string }> {
    const searchTerm = CATEGORY_SEARCH_TERMS[category] ?? category;
    const textQuery = keyword
      ? `${searchTerm} ${keyword} in ${city}, ${country}`
      : `${searchTerm} in ${city}, ${country}`;

    const requestBody: Record<string, unknown> = {
      textQuery,
      maxResultCount: 20,
      languageCode: "de",
    };

    if (pageToken) requestBody.pageToken = pageToken;

    const data = await this.callApi(requestBody);

    const results = (data.places ?? [])
      .filter(
        (p): p is PlacesResult & { location: NonNullable<PlacesResult["location"]> } =>
          p.location?.latitude != null && p.location?.longitude != null
      )
      .map((p) => this.mapToSearchResult(p, category, city, country));

    return { results, nextPageToken: data.nextPageToken };
  }

  // ─── Coordinate-based radius search (new mode) ───────────────────────────

  /**
   * Search within a geographic circle by coordinates.
   * Finds all matching businesses regardless of which city/town they're in.
   * Useful for covering regions including small towns like Herzogenaurach.
   */
  async searchByCoords(
    lat: number,
    lng: number,
    radiusKm: number,
    country: string,
    category: string,
    keyword?: string,
    maxPages = 3
  ): Promise<SearchResult[]> {
    const allResults: SearchResult[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < maxPages; page++) {
      try {
        const { results, nextPageToken } = await this.searchCoordsPage(
          lat, lng, radiusKm, country, category, keyword, pageToken
        );
        allResults.push(...results);
        if (!nextPageToken) break;
        pageToken = nextPageToken;
        await new Promise((r) => setTimeout(r, 500));
      } catch (err) {
        console.error(`[GooglePlaces] Page ${page + 1} failed for coords(${lat},${lng})/${category}:`, err);
        break;
      }
    }

    return allResults;
  }

  private async searchCoordsPage(
    lat: number,
    lng: number,
    radiusKm: number,
    country: string,
    category: string,
    keyword?: string,
    pageToken?: string
  ): Promise<{ results: SearchResult[]; nextPageToken?: string }> {
    const searchTerm = CATEGORY_SEARCH_TERMS[category] ?? category;
    const textQuery = keyword ? `${searchTerm} ${keyword}` : searchTerm;

    const requestBody: Record<string, unknown> = {
      textQuery,
      // locationRestriction strictly limits results to this circle
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: Math.min(radiusKm * 1000, 50000), // API max 50km per call
        },
      },
      maxResultCount: 20,
      languageCode: "de",
    };

    if (pageToken) requestBody.pageToken = pageToken;

    const data = await this.callApi(requestBody);

    const results = (data.places ?? [])
      .filter(
        (p): p is PlacesResult & { location: NonNullable<PlacesResult["location"]> } =>
          p.location?.latitude != null && p.location?.longitude != null
      )
      .map((p) => {
        // Extract actual city from formattedAddress since we're not searching by city name
        const city = extractCityFromAddress(p.formattedAddress ?? "") ?? "Unbekannt";
        return this.mapToSearchResult(p, category, city, country);
      });

    return { results, nextPageToken: data.nextPageToken };
  }

  // ─── Shared helpers ───────────────────────────────────────────────────────

  private async callApi(body: Record<string, unknown>): Promise<PlacesTextSearchResponse> {
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
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(`Google Places API returned ${response.status}: ${errorText}`);
    }

    return (await response.json()) as PlacesTextSearchResponse;
  }

  private mapToSearchResult(
    place: PlacesResult & { location: { latitude?: number; longitude?: number } },
    category: string,
    city: string,
    country: string
  ): SearchResult {
    const address = place.formattedAddress ?? "";
    const postalMatch = address.match(/\b(\d{5})\b/);

    return {
      company_name: place.displayName?.text ?? "Unknown",
      category,
      address: address.replace(/,?\s*\d{5}\s*[^,]+,?\s*(Germany|Deutschland)$/i, "").trim() || address,
      city,
      postal_code: postalMatch?.[1] ?? null,
      country,
      latitude: place.location.latitude ?? 0,
      longitude: place.location.longitude ?? 0,
      place_id: place.id ?? null,
      phone: place.internationalPhoneNumber ?? null,
      website: place.websiteUri ?? null,
      rating: place.rating ?? null,
    };
  }

  private async searchCategory(query: SearchQuery, category: string): Promise<SearchResult[]> {
    const { results } = await this.searchCityPage(
      query.city, query.country, category, query.keywords
    );
    return results;
  }
}

/** Extract city name from a German formatted address.
 *  "Musterstr. 1, 91074 Herzogenaurach, Germany" → "Herzogenaurach"
 */
function extractCityFromAddress(address: string): string | null {
  const match = address.match(/\b\d{5}\s+([^,]+)/);
  return match?.[1]?.trim() ?? null;
}
