"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CATEGORY_GROUPS } from "@/lib/constants/categories";

const STATUSES = ["new", "reviewed", "contacted", "follow_up", "qualified", "rejected", "existing_solar"];

const STATUS_LABELS: Record<string, string> = {
  new: "Neu",
  reviewed: "Geprüft",
  contacted: "Kontaktiert",
  follow_up: "Wiedervorlage",
  qualified: "Qualifiziert",
  rejected: "Abgelehnt",
  existing_solar: "☀️ Bereits Solar",
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
    searchParams.has("postalCode") ||
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
        <SelectTrigger className="w-[200px]">
          <SelectValue placeholder="Kategorie" />
        </SelectTrigger>
        <SelectContent className="max-h-[400px]">
          <SelectItem value="all">Alle Kategorien</SelectItem>
          {CATEGORY_GROUPS.map((group) => (
            <SelectGroup key={group.label}>
              <SelectLabel className="text-xs text-muted-foreground">
                {group.label}
              </SelectLabel>
              {group.items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  <span className="mr-2">{item.emoji}</span>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
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
        placeholder="PLZ (z.B. 83)"
        className="w-[140px]"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={5}
        defaultValue={searchParams.get("postalCode") ?? ""}
        onChange={(e) => updateParams("postalCode", e.target.value)}
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
