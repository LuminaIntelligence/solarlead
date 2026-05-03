/**
 * Cell Generator — turns a campaign's (areas, categories) input into atomic
 * search_cells rows. One cell = one geographic point × one category.
 *
 * Each cell is the smallest unit a worker can claim and process. Cells are
 * generated up-front and stored — the cron tick simply picks the next pending
 * cell (highest priority first), so the work is fully resumable.
 */
import type { DiscoveryCampaignArea } from "@/types/database";

export interface SearchCellInput {
  campaign_id: string;
  area_label: string;
  area_type: "city" | "radius";
  area_city: string | null;
  area_lat: number | null;
  area_lng: number | null;
  area_radius_km: number | null;
  category: string;
  search_keyword: string | null;
  priority: number;
}

interface GeneratorOptions {
  campaign_id: string;
  areas: DiscoveryCampaignArea[];
  categories: string[];
  search_keyword?: string | null;
}

/**
 * Generates one cell per (area, category) combination.
 *
 * Priority strategy:
 *   - Larger radii get higher priority (cover more ground first)
 *   - Cities at index 0 get highest priority (first city in user's list = most important)
 *   - Earlier categories slightly higher priority (user's first choice first)
 */
export function generateCells(opts: GeneratorOptions): SearchCellInput[] {
  const { campaign_id, areas, categories, search_keyword } = opts;
  const cells: SearchCellInput[] = [];

  if (!areas.length || !categories.length) return [];

  for (let ai = 0; ai < areas.length; ai++) {
    const area = areas[ai];

    for (let ci = 0; ci < categories.length; ci++) {
      const category = categories[ci];

      // Priority: 1000 base, area position decreases by 10 per slot,
      // category position decreases by 1 per slot.
      // Larger radii (≥40km) get +20 boost so big-coverage cells run first.
      const radiusBoost = area.type === "radius" && (area.radius_km ?? 0) >= 40 ? 20 : 0;
      const priority = 1000 - ai * 10 - ci + radiusBoost;

      cells.push({
        campaign_id,
        area_label: area.value,
        area_type: area.type,
        area_city: area.type === "city" ? area.value : null,
        area_lat: area.type === "radius" ? area.lat ?? null : null,
        area_lng: area.type === "radius" ? area.lng ?? null : null,
        area_radius_km: area.type === "radius" ? area.radius_km ?? null : null,
        category,
        search_keyword: search_keyword ?? null,
        priority,
      });
    }
  }

  return cells;
}

/**
 * Estimate the API cost of a cell list.
 * Each cell hits Google Places ~12 times (4 search terms × 3 pages),
 * each call costs roughly $0.032 USD. Convert to EUR at 0.92.
 */
export function estimateCellsCostEur(cells: SearchCellInput[]): number {
  const callsPerCell = 12;
  const costPerCallUsd = 0.032;
  const usdToEur = 0.92;
  return cells.length * callsPerCell * costPerCallUsd * usdToEur;
}
