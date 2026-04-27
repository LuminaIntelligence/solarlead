"use client";

import { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowUpDown, ArrowUp, ArrowDown, MoreHorizontal,
  Eye, Trash2, Download, X, ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteLead, bulkUpdateStatus, bulkDeleteLeads } from "@/lib/actions/leads";
import type { Lead, LeadStatus } from "@/types/database";

const statusColors: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-800",
  reviewed: "bg-yellow-100 text-yellow-800",
  contacted: "bg-purple-100 text-purple-800",
  qualified: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  existing_solar: "bg-orange-100 text-orange-800",
};

function getScoreBarColor(score: number): string {
  if (score >= 70) return "bg-green-500";
  if (score >= 40) return "bg-yellow-500";
  return "bg-red-500";
}

const STATUS_LABELS: Record<string, string> = {
  new: "Neu",
  reviewed: "Geprüft",
  contacted: "Kontaktiert",
  qualified: "Qualifiziert",
  rejected: "Abgelehnt",
  existing_solar: "☀️ Bereits Solar",
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

function formatCategory(category: string): string {
  return CATEGORY_LABELS[category] ?? category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function exportToCSV(leadsToExport: Lead[]) {
  const headers = [
    "Unternehmen", "Kategorie", "Stadt", "Adresse", "PLZ",
    "Score", "Status", "Website", "Telefon", "E-Mail",
    "Nächster Kontakt", "Win-Chance (%)"
  ];
  const rows = leadsToExport.map((l) => [
    l.company_name,
    formatCategory(l.category),
    l.city ?? "",
    l.address ?? "",
    l.postal_code ?? "",
    l.total_score,
    STATUS_LABELS[l.status] ?? l.status,
    l.website ?? "",
    l.phone ?? "",
    l.email ?? "",
    l.next_contact_date ?? "",
    l.win_probability ?? "",
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `solarlead-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface LeadsTableProps {
  leads: Lead[];
}

export function LeadsTable({ leads }: LeadsTableProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);

  const currentSortBy = searchParams.get("sortBy") ?? "total_score";
  const currentSortOrder = searchParams.get("sortOrder") ?? "desc";

  const toggleSort = useCallback(
    (column: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (currentSortBy === column) {
        params.set("sortOrder", currentSortOrder === "asc" ? "desc" : "asc");
      } else {
        params.set("sortBy", column);
        params.set("sortOrder", "desc");
      }
      router.push(`/dashboard/leads?${params.toString()}`);
    },
    [router, searchParams, currentSortBy, currentSortOrder]
  );

  const getSortIcon = (column: string) => {
    if (currentSortBy !== column) return <ArrowUpDown className="ml-1 h-3 w-3" />;
    return currentSortOrder === "asc"
      ? <ArrowUp className="ml-1 h-3 w-3" />
      : <ArrowDown className="ml-1 h-3 w-3" />;
  };

  const toggleAll = () => {
    if (selectedIds.size === leads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map((l) => l.id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Möchten Sie diesen Lead wirklich löschen?")) return;
    setDeletingId(id);
    try {
      await deleteLead(id);
      router.refresh();
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkStatus = (status: string) => {
    const ids = Array.from(selectedIds);
    setBulkStatusOpen(false);
    startTransition(async () => {
      await bulkUpdateStatus(ids, status);
      setSelectedIds(new Set());
      router.refresh();
    });
  };

  const handleBulkDelete = () => {
    const count = selectedIds.size;
    if (!confirm(`${count} Leads wirklich löschen?`)) return;
    const ids = Array.from(selectedIds);
    startTransition(async () => {
      await bulkDeleteLeads(ids);
      setSelectedIds(new Set());
      router.refresh();
    });
  };

  const handleBulkExport = () => {
    const selected = leads.filter((l) => selectedIds.has(l.id));
    exportToCSV(selected);
  };

  const handleExportAll = () => {
    exportToCSV(leads);
  };

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border bg-white py-16">
        <p className="text-muted-foreground">Keine Leads gefunden. Passen Sie Ihre Filter an.</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Export all button */}
      <div className="flex justify-end mb-2">
        <Button variant="outline" size="sm" onClick={handleExportAll} className="gap-2">
          <Download className="h-4 w-4" />
          Alle exportieren ({leads.length})
        </Button>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left">
              <th className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={leads.length > 0 && selectedIds.size === leads.length}
                  onChange={toggleAll}
                  className="h-4 w-4 rounded border-gray-300"
                />
              </th>
              <th className="px-4 py-3">
                <button onClick={() => toggleSort("company_name")} className="inline-flex items-center font-medium hover:text-primary">
                  Unternehmen {getSortIcon("company_name")}
                </button>
              </th>
              <th className="px-4 py-3">
                <button onClick={() => toggleSort("category")} className="inline-flex items-center font-medium hover:text-primary">
                  Kategorie {getSortIcon("category")}
                </button>
              </th>
              <th className="px-4 py-3">
                <button onClick={() => toggleSort("city")} className="inline-flex items-center font-medium hover:text-primary">
                  Stadt {getSortIcon("city")}
                </button>
              </th>
              <th className="px-4 py-3">
                <button onClick={() => toggleSort("total_score")} className="inline-flex items-center font-medium hover:text-primary">
                  Score {getSortIcon("total_score")}
                </button>
              </th>
              <th className="px-4 py-3">
                <button onClick={() => toggleSort("status")} className="inline-flex items-center font-medium hover:text-primary">
                  Status {getSortIcon("status")}
                </button>
              </th>
              <th className="px-4 py-3 text-right">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr
                key={lead.id}
                className={`border-b last:border-0 transition-colors hover:bg-slate-50 ${selectedIds.has(lead.id) ? "bg-blue-50" : ""}`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(lead.id)}
                    onChange={() => toggleOne(lead.id)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/dashboard/leads/${lead.id}`} className="font-medium text-primary hover:underline">
                    {lead.company_name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatCategory(lead.category)}</td>
                <td className="px-4 py-3 text-muted-foreground">{lead.city}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-16 rounded-full bg-slate-200">
                      <div
                        className={`h-2 rounded-full ${getScoreBarColor(lead.total_score)}`}
                        style={{ width: `${Math.min(lead.total_score, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium tabular-nums">{lead.total_score}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="secondary" className={statusColors[lead.status]}>
                    {STATUS_LABELS[lead.status] ?? lead.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/dashboard/leads/${lead.id}`}>
                          <Eye className="mr-2 h-4 w-4" /> Ansehen
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDelete(lead.id)}
                        disabled={deletingId === lead.id}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {deletingId === lead.id ? "Wird gelöscht..." : "Löschen"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl bg-gray-900 text-white px-4 py-3 shadow-2xl border border-gray-700">
          <span className="text-sm font-medium whitespace-nowrap">
            {selectedIds.size} ausgewählt
          </span>
          <div className="h-4 w-px bg-gray-600 mx-1" />

          {/* Status ändern */}
          <div className="relative">
            <button
              onClick={() => setBulkStatusOpen(!bulkStatusOpen)}
              className="flex items-center gap-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 px-3 py-1.5 text-sm font-medium transition-colors"
            >
              Status ändern
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {bulkStatusOpen && (
              <div className="absolute bottom-full mb-2 left-0 bg-white text-gray-900 rounded-lg shadow-xl border overflow-hidden min-w-[150px]">
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => handleBulkStatus(value)}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-slate-100 transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* CSV Export */}
          <button
            onClick={handleBulkExport}
            className="flex items-center gap-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 px-3 py-1.5 text-sm font-medium transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>

          {/* Löschen */}
          <button
            onClick={handleBulkDelete}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {isPending ? "..." : "Löschen"}
          </button>

          {/* Schließen */}
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-1 rounded-lg hover:bg-gray-700 p-1.5 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
