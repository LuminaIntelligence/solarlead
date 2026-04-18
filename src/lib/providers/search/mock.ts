import type { SearchProvider, SearchQuery, SearchResult } from "./types";

const MOCK_BUSINESSES: SearchResult[] = [
  // Logistics
  {
    company_name: "Müller Logistik GmbH",
    category: "logistics",
    address: "Industriestr. 42",
    city: "München",
    postal_code: "80939",
    country: "DE",
    latitude: 48.1951,
    longitude: 11.5820,
    place_id: "mock_place_001",
    phone: "+49 89 12345678",
    website: "https://mueller-logistik.de",
    rating: 4.2,
  },
  {
    company_name: "Schnell Transport & Logistik",
    category: "logistics",
    address: "Am Güterbahnhof 7",
    city: "Hamburg",
    postal_code: "20097",
    country: "DE",
    latitude: 53.5511,
    longitude: 10.0006,
    place_id: "mock_place_002",
    phone: "+49 40 23456789",
    website: "https://schnell-transport.de",
    rating: 3.8,
  },
  {
    company_name: "DHL Freight Center Berlin",
    category: "logistics",
    address: "Logistikring 15",
    city: "Berlin",
    postal_code: "12529",
    country: "DE",
    latitude: 52.3906,
    longitude: 13.5183,
    place_id: "mock_place_003",
    phone: "+49 30 34567890",
    website: "https://dhl.de",
    rating: 3.5,
  },

  // Warehouse
  {
    company_name: "Lagertechnik Weber KG",
    category: "warehouse",
    address: "Lagerstr. 22",
    city: "München",
    postal_code: "81241",
    country: "DE",
    latitude: 48.1430,
    longitude: 11.4695,
    place_id: "mock_place_004",
    phone: "+49 89 45678901",
    website: "https://lagertechnik-weber.de",
    rating: 4.0,
  },
  {
    company_name: "Nord Lagerhaus GmbH",
    category: "warehouse",
    address: "Hafenweg 3",
    city: "Hamburg",
    postal_code: "20457",
    country: "DE",
    latitude: 53.5433,
    longitude: 9.9872,
    place_id: "mock_place_005",
    phone: "+49 40 56789012",
    website: "https://nord-lagerhaus.de",
    rating: 4.3,
  },

  // Cold Storage
  {
    company_name: "Frost & Kühl Lagerung GmbH",
    category: "cold_storage",
    address: "Kühlhausstr. 8",
    city: "München",
    postal_code: "80993",
    country: "DE",
    latitude: 48.1812,
    longitude: 11.5125,
    place_id: "mock_place_006",
    phone: "+49 89 67890123",
    website: "https://frost-kuehl.de",
    rating: 4.5,
  },
  {
    company_name: "Polarfrost Kühllogistik",
    category: "cold_storage",
    address: "Eiskeller 12",
    city: "Berlin",
    postal_code: "13059",
    country: "DE",
    latitude: 52.5750,
    longitude: 13.4620,
    place_id: "mock_place_007",
    phone: "+49 30 78901234",
    website: "https://polarfrost.de",
    rating: 3.9,
  },

  // Supermarket
  {
    company_name: "EDEKA Frischemarkt Berger",
    category: "supermarket",
    address: "Hauptstr. 55",
    city: "München",
    postal_code: "80331",
    country: "DE",
    latitude: 48.1374,
    longitude: 11.5755,
    place_id: "mock_place_008",
    phone: "+49 89 89012345",
    website: "https://edeka.de",
    rating: 4.1,
  },
  {
    company_name: "REWE Center Hamburg-Mitte",
    category: "supermarket",
    address: "Mönckebergstr. 18",
    city: "Hamburg",
    postal_code: "20095",
    country: "DE",
    latitude: 53.5520,
    longitude: 10.0053,
    place_id: "mock_place_009",
    phone: "+49 40 90123456",
    website: "https://rewe.de",
    rating: 4.0,
  },

  // Food Production
  {
    company_name: "Bayerische Backwaren AG",
    category: "food_production",
    address: "Bäckereistr. 3",
    city: "München",
    postal_code: "80686",
    country: "DE",
    latitude: 48.1295,
    longitude: 11.5260,
    place_id: "mock_place_010",
    phone: "+49 89 11223344",
    website: "https://bayerische-backwaren.de",
    rating: 4.6,
  },
  {
    company_name: "Nordsee Fischverarbeitung GmbH",
    category: "food_production",
    address: "Fischmarkt 1",
    city: "Hamburg",
    postal_code: "20359",
    country: "DE",
    latitude: 53.5445,
    longitude: 9.9510,
    place_id: "mock_place_011",
    phone: "+49 40 22334455",
    website: "https://nordsee-fisch.de",
    rating: 3.7,
  },

  // Manufacturing
  {
    company_name: "Süddeutsche Maschinenbau GmbH",
    category: "manufacturing",
    address: "Werkstr. 28",
    city: "Stuttgart",
    postal_code: "70565",
    country: "DE",
    latitude: 48.7270,
    longitude: 9.1125,
    place_id: "mock_place_012",
    phone: "+49 711 33445566",
    website: "https://sueddeutsche-maschinenbau.de",
    rating: 4.4,
  },
  {
    company_name: "Rhein-Ruhr Industriewerke",
    category: "manufacturing",
    address: "Fabrikweg 10",
    city: "Düsseldorf",
    postal_code: "40472",
    country: "DE",
    latitude: 51.2795,
    longitude: 6.7632,
    place_id: "mock_place_013",
    phone: "+49 211 44556677",
    website: "https://rhein-ruhr-industrie.de",
    rating: 3.6,
  },

  // Metalworking
  {
    company_name: "Präzisions-Metallbau Schulz",
    category: "metalworking",
    address: "Schlosserstr. 14",
    city: "München",
    postal_code: "80995",
    country: "DE",
    latitude: 48.2010,
    longitude: 11.4890,
    place_id: "mock_place_014",
    phone: "+49 89 55667788",
    website: "https://metallbau-schulz.de",
    rating: 4.7,
  },
  {
    company_name: "Berliner Stahlbau & Schweißtechnik",
    category: "metalworking",
    address: "Eisenstr. 6",
    city: "Berlin",
    postal_code: "12681",
    country: "DE",
    latitude: 52.5270,
    longitude: 13.5445,
    place_id: "mock_place_015",
    phone: "+49 30 66778899",
    website: "https://berliner-stahlbau.de",
    rating: 4.1,
  },

  // Car Dealerships
  {
    company_name: "Autohaus König BMW",
    category: "car_dealership",
    address: "Autobahnring 33",
    city: "München",
    postal_code: "80939",
    country: "DE",
    latitude: 48.1920,
    longitude: 11.6010,
    place_id: "mock_place_016",
    phone: "+49 89 77889900",
    website: "https://autohaus-koenig.de",
    rating: 4.3,
  },
  {
    company_name: "Mercedes-Benz Niederlassung Hamburg",
    category: "car_dealership",
    address: "Nedderfeld 92",
    city: "Hamburg",
    postal_code: "22529",
    country: "DE",
    latitude: 53.5898,
    longitude: 9.9583,
    place_id: "mock_place_017",
    phone: "+49 40 88990011",
    website: "https://mercedes-hamburg.de",
    rating: 4.5,
  },

  // Hotels
  {
    company_name: "Hotel Vier Jahreszeiten",
    category: "hotel",
    address: "Maximilianstr. 17",
    city: "München",
    postal_code: "80539",
    country: "DE",
    latitude: 48.1398,
    longitude: 11.5830,
    place_id: "mock_place_018",
    phone: "+49 89 99001122",
    website: "https://hotel-vier-jahreszeiten.de",
    rating: 4.8,
  },
  {
    company_name: "Atlantic Hotel Hamburg",
    category: "hotel",
    address: "An der Alster 72-79",
    city: "Hamburg",
    postal_code: "20099",
    country: "DE",
    latitude: 53.5570,
    longitude: 10.0070,
    place_id: "mock_place_019",
    phone: "+49 40 11223344",
    website: "https://atlantic-hotel.de",
    rating: 4.6,
  },

  // Furniture Stores
  {
    company_name: "Möbelhaus Fischer",
    category: "furniture_store",
    address: "Einrichtungsstr. 5",
    city: "Berlin",
    postal_code: "10245",
    country: "DE",
    latitude: 52.5015,
    longitude: 13.4545,
    place_id: "mock_place_020",
    phone: "+49 30 22334455",
    website: "https://moebelhaus-fischer.de",
    rating: 4.0,
  },

  // Hardware Stores
  {
    company_name: "Baumarkt Hoffmann",
    category: "hardware_store",
    address: "Handwerkerstr. 20",
    city: "München",
    postal_code: "81369",
    country: "DE",
    latitude: 48.1130,
    longitude: 11.5435,
    place_id: "mock_place_021",
    phone: "+49 89 33445566",
    website: "https://baumarkt-hoffmann.de",
    rating: 3.9,
  },
  {
    company_name: "OBI Fachmarkt Berlin-Spandau",
    category: "hardware_store",
    address: "Brunsbütteler Damm 130",
    city: "Berlin",
    postal_code: "13581",
    country: "DE",
    latitude: 52.5360,
    longitude: 13.1890,
    place_id: "mock_place_022",
    phone: "+49 30 44556677",
    website: "https://obi.de",
    rating: 3.7,
  },

  // Shopping Centers
  {
    company_name: "Olympia Einkaufszentrum",
    category: "shopping_center",
    address: "Hanauer Str. 68",
    city: "München",
    postal_code: "80993",
    country: "DE",
    latitude: 48.1810,
    longitude: 11.5340,
    place_id: "mock_place_023",
    phone: "+49 89 55667700",
    website: "https://olympia-einkaufszentrum.de",
    rating: 4.2,
  },
  {
    company_name: "Alexa Shopping Center",
    category: "shopping_center",
    address: "Grunerstr. 20",
    city: "Berlin",
    postal_code: "10179",
    country: "DE",
    latitude: 52.5194,
    longitude: 13.4153,
    place_id: "mock_place_024",
    phone: "+49 30 66778800",
    website: "https://alexacentre.com",
    rating: 4.1,
  },
];

/** City center coordinates for distance filtering */
const CITY_CENTERS: Record<string, { lat: number; lng: number }> = {
  münchen: { lat: 48.1351, lng: 11.582 },
  munich: { lat: 48.1351, lng: 11.582 },
  hamburg: { lat: 53.5511, lng: 9.9937 },
  berlin: { lat: 52.52, lng: 13.405 },
  stuttgart: { lat: 48.7758, lng: 9.1829 },
  düsseldorf: { lat: 51.2277, lng: 6.7735 },
  dusseldorf: { lat: 51.2277, lng: 6.7735 },
  köln: { lat: 50.9375, lng: 6.9603 },
  cologne: { lat: 50.9375, lng: 6.9603 },
  frankfurt: { lat: 50.1109, lng: 8.6821 },
  nürnberg: { lat: 49.4521, lng: 11.0767 },
  nuremberg: { lat: 49.4521, lng: 11.0767 },
};

function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export class MockSearchProvider implements SearchProvider {
  name = "mock";

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const cityKey = query.city.toLowerCase().trim();
    const center = CITY_CENTERS[cityKey];

    let results = MOCK_BUSINESSES;

    // Filter by categories if specified
    if (query.categories.length > 0) {
      results = results.filter((b) => query.categories.includes(b.category));
    }

    // Filter by city proximity if we know the city center
    if (center) {
      results = results.filter(
        (b) =>
          haversineDistanceKm(center.lat, center.lng, b.latitude, b.longitude) <=
          query.radius_km
      );
    } else {
      // Fallback: match by city name
      results = results.filter(
        (b) => b.city.toLowerCase() === cityKey
      );
    }

    // Filter by keywords if provided
    if (query.keywords) {
      const kw = query.keywords.toLowerCase();
      results = results.filter(
        (b) =>
          b.company_name.toLowerCase().includes(kw) ||
          b.category.toLowerCase().includes(kw)
      );
    }

    // Simulate async delay
    await new Promise((resolve) => setTimeout(resolve, 150));

    return results;
  }
}
