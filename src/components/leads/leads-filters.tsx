"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUSES = ["new", "reviewed", "contacted", "qualified", "rejected"];

const CATEGORIES = [
  "logistics",
  "warehouse",
  "cold_storage",
  "supermarket",
  "food_production",
  "manufacturing",
  "metalworking",
  "car_dealership",
  "hotel",
  "furniture_store",
  "hardware_store",
  "shopping_center",
];

const STATUS_LABELS: Record<string, string> = {
  new: "Neu",
  reviewed: "Geprüft",
  contacted: "Kontaktiert",
  qualified: "Qualifiziert",
  rejected: "Abgelehnt",
};

const CATEGORY_LABELS: Record<string, string> = {
  logistics: "Logistik",
  warehouse: "Lager",
  cold_storage: "Kühlhaus",
  supermarket: "Supermarkt",
  food_production: "Lebensmittelproduktion",
  manufacturing: "Fertigung",
  metalworking: "Metallverarbeitung",
  car_dealership: "Autohaus",
  hotel: "Hotel",
  furniture_store: "Möbelhaus",
  hardware_store: "Baumarkt",
  shopping_center: "Einkaufszentrum",
};

export function LeadsFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== "all") {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/dashboard/leads?${params.toString()}`);
    },
    [router, searchParams]
  );

  const resetFilters = useCallback(() => {
    router.push("/dashboard/leads");
  }, [router]);

  const hasFilters =
    searchParams.has("status") ||
    searchParams.has("category") ||
    searchParams.has("city") ||
    searchParams.has("minScore") ||
    searchParams.has("search");

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-4">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Unternehmen suchen..."
          className="pl-9"
          defaultValue={searchParams.get("search") ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            // Debounce-like: update on each change
            updateParams("search", value);
          }}
        />
      </div>

      <Select
        value={searchParams.get("status") ?? "all"}
        onValueChange={(value) => updateParams("status", value)}
      >
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Alle Status</SelectItem>
          {STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {STATUS_LABELS[status] ?? status}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={searchParams.get("category") ?? "all"}
        onValueChange={(value) => updateParams("category", value)}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Kategorie" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Alle Kategorien</SelectItem>
          {CATEGORIES.map((category) => (
            <SelectItem key={category} value={category}>
              {CATEGORY_LABELS[category] ?? category}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        placeholder="Stadt"
        className="w-[140px]"
        defaultValue={searchParams.get("city") ?? ""}
        onChange={(e) => updateParams("city", e.target.value)}
      />

      <Input
        type="number"
        placeholder="Min. Score"
        className="w-[120px]"
        defaultValue={searchParams.get("minScore") ?? ""}
        onChange={(e) => updateParams("minScore", e.target.value)}
      />

      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={resetFilters}>
          <X className="mr-1 h-4 w-4" />
          Filter zurücksetzen
        </Button>
      )}
    </div>
  );
}
