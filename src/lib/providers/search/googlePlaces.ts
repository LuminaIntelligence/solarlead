import type { SearchProvider, SearchQuery, SearchResult } from "./types";

/**
 * Multiple search terms per category.
 * Each term is a separate Google Places query → up to 60 results each.
 * Different terms surface different businesses (e.g. "Spedition" ≠ "Logistikzentrum").
 * Duplicates are removed by place_id after merging.
 */
const CATEGORY_SEARCH_TERMS: Record<string, string[]> = {
  logistics:       ["Spedition", "Logistikzentrum", "Lager Logistik", "Frachtunternehmen"],
  warehouse:       ["Lagerhalle", "Lagerhaus", "Betriebshalle", "Industriehalle"],
  cold_storage:    ["Kühlhaus", "Tiefkühlhaus", "Kühllager", "Kühllogistik"],
  supermarket:     ["Supermarkt", "Lebensmittelmarkt", "Verbrauchermarkt", "Lebensmitteldiscounter"],
  food_production: ["Lebensmittelproduktion", "Lebensmittelfabrik", "Nahrungsmittelwerk", "Lebensmittelwerk"],
  manufacturing:   ["Produktionswerk", "Fabrik", "Fertigungsbetrieb", "Industriewerk"],
  metalworking:    ["Metallverarbeitung", "Stahlbau", "Metallbau", "Schlosserei Stahlbau"],
  car_dealership:  ["Autohaus", "Kfz-Händler", "Autohändler", "Fahrzeughandel"],
  hotel:           ["Hotel", "Business Hotel", "Tagungshotel"],
  furniture_store: ["Möbelhaus", "Möbelmarkt", "Einrichtungshaus"],
  hardware_store:  ["Baumarkt", "Baustoffhandel", "Baustoffe Großhandel"],
  shopping_center: ["Einkaufszentrum", "Fachmarktzentrum", "Einkaufspark"],
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

  /**
   * Search a city+category using ALL configured search terms.
   * Each term is searched with up to maxPages pages (default 3 = 60 results).
   * Duplicates within the result set are removed by place_id.
   */
  async searchCategoryPaginated(
    city: string,
    country: string,
    category: string,
    keyword?: string,
    maxPages = 3
  ): Promise<SearchResult[]> {
    const terms = CATEGORY_SEARCH_TERMS[category] ?? [category];
    return this.runMultiTermSearch(terms, category, keyword, maxPages, async (term, pToken) =>
      this.searchCityPage(city, country, category, term, keyword, pToken)
    );
  }

  private async searchCityPage(
    city: string,
    country: string,
    category: string,
    term: string,
    keyword?: string,
    pageToken?: string
  ): Promise<{ results: SearchResult[]; nextPageToken?: string }> {
    const textQuery = keyword
      ? `${term} ${keyword} in ${city}, ${country}`
      : `${term} in ${city}, ${country}`;

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
   * Search within a geographic circle by coordinates using ALL configured search terms.
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
    const terms = CATEGORY_SEARCH_TERMS[category] ?? [category];
    return this.runMultiTermSearch(terms, category, keyword, maxPages, async (term, pToken) =>
      this.searchCoordsPage(lat, lng, radiusKm, country, category, term, keyword, pToken)
    );
  }

  private async searchCoordsPage(
    lat: number,
    lng: number,
    radiusKm: number,
    country: string,
    category: string,
    term: string,
    keyword?: string,
    pageToken?: string
  ): Promise<{ results: SearchResult[]; nextPageToken?: string }> {
    const textQuery = keyword ? `${term} ${keyword}` : term;

    const requestBody: Record<string, unknown> = {
      textQuery,
      // locationRestriction only supports rectangles in Places API (New).
      // locationBias with circle is the correct way to search within a radius.
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: Math.min(radiusKm * 1000, 50000), // API max 50 km
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
        const city = extractCityFromAddress(p.formattedAddress ?? "") ?? "Unbekannt";
        return this.mapToSearchResult(p, category, city, country);
      });

    return { results, nextPageToken: data.nextPageToken };
  }

  // ─── Multi-term orchestration ─────────────────────────────────────────────

  /**
   * Run multiple search terms sequentially, merge results, deduplicate by place_id.
   * pageFn receives (term, pageToken) and returns {results, nextPageToken}.
   */
  private async runMultiTermSearch(
    terms: string[],
    category: string,
    keyword: string | undefined,
    maxPages: number,
    pageFn: (
      term: string,
      pageToken: string | undefined
    ) => Promise<{ results: SearchResult[]; nextPageToken?: string }>
  ): Promise<SearchResult[]> {
    const seenPlaceIds = new Set<string>();
    const merged: SearchResult[] = [];

    for (const term of terms) {
      let pageToken: string | undefined;
      for (let page = 0; page < maxPages; page++) {
        try {
          const { results, nextPageToken } = await pageFn(term, pageToken);

          for (const r of results) {
            // Deduplicate within this search (across terms + pages)
            const key = r.place_id ?? `${r.latitude},${r.longitude}`;
            if (seenPlaceIds.has(key)) continue;
            seenPlaceIds.add(key);
            merged.push(r);
          }

          if (!nextPageToken) break;
          pageToken = nextPageToken;
          await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
          console.error(
            `[GooglePlaces] Term "${term}" page ${page + 1} failed for ${category}:`,
            err instanceof Error ? err.message : err
          );
          break;
        }
      }

      // Brief pause between different search terms
      if (terms.indexOf(term) < terms.length - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    return merged;
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
    const terms = CATEGORY_SEARCH_TERMS[category] ?? [category];
    return this.runMultiTermSearch(terms, category, query.keywords, 1, async (term, pToken) =>
      this.searchCityPage(query.city, query.country, category, term, query.keywords, pToken)
    );
  }
}

/** Extract city name from a German formatted address.
 *  "Musterstr. 1, 91074 Herzogenaurach, Germany" → "Herzogenaurach"
 */
function extractCityFromAddress(address: string): string | null {
  const match = address.match(/\b\d{5}\s+([^,]+)/);
  return match?.[1]?.trim() ?? null;
}
