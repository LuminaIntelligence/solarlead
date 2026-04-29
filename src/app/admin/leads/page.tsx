"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Loader2, Search, Sun, X, UserPlus, UserX } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Lead, LeadStatus } from "@/types/database";
import { CATEGORY_OPTIONS, getCategoryLabel } from "@/lib/constants/categories";

interface LeadWithOwner extends Lead {
  owner_email: string;
  assigned_email: string | null;
}

interface UserOption {
  id: string;
  email: string;
}

const statusLabels: Record<string, string> = {
  new: "Neu",
  reviewed: "Geprüft",
  contacted: "Kontaktiert",
  qualified: "Qualifiziert",
  rejected: "Abgelehnt",
  existing_solar: "Solar vorhanden",
};

const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  reviewed: "bg-yellow-100 text-yellow-800",
  contacted: "bg-purple-100 text-purple-800",
  qualified: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  existing_solar: "bg-orange-100 text-orange-800",
};

const statusOptions = [
  { value: "new", label: "Neu" },
  { value: "reviewed", label: "Geprüft" },
  { value: "contacted", label: "Kontaktiert" },
  { value: "qualified", label: "Qualifiziert" },
  { value: "rejected", label: "Abgelehnt" },
];

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getScoreColor(score: number): string {
  if (score >= 70) return "bg-green-100 text-green-800";
  if (score >= 40) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

export default function AdminLeadsPage() {
  const [leads, setLeads] = useState<LeadWithOwner[]>([]);
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<UserOption[]>([]);

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [solarCompleteFilter, setSolarCompleteFilter] = useState(false);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Assign dialog
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [assignTargetId, setAssignTargetId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);

  const loadLeads = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      if (statusFilter) params.set("status", statusFilter);
      if (categoryFilter) params.set("category", categoryFilter);
      if (solarCompleteFilter) params.set("solar_complete", "1");

      const res = await fetch(`/api/admin/leads?${params.toString()}`);
      if (!res.ok) throw new Error("Fehler beim Laden der Leads");
      const data = await res.json();
      setLeads(data.leads ?? []);
      setSelectedIds(new Set());
    } catch (err) {
      console.error("Fehler beim Laden der Leads:", err);
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, categoryFilter, solarCompleteFilter]);

  // Nutzer für Zuweisung laden
  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) return;
      const data = await res.json();
      setUsers((data.users ?? []).map((u: { id: string; email: string }) => ({
        id: u.id,
        email: u.email,
      })));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);
  useEffect(() => { loadUsers(); }, [loadUsers]);

  function clearFilters() {
    setSearchQuery("");
    setStatusFilter("");
    setCategoryFilter("");
    setSolarCompleteFilter(false);
  }

  // Checkbox-Logik
  const allSelected = leads.length > 0 && selectedIds.size === leads.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  function toggleAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map((l) => l.id)));
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Zuweisung speichern
  async function handleAssign() {
    if (!assignTargetId) return;
    setAssigning(true);
    setAssignMessage(null);
    try {
      const res = await fetch("/api/admin/leads/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadIds: [...selectedIds],
          assignedTo: assignTargetId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler");
      setAssignMessage(`✓ ${data.assigned} Lead(s) erfolgreich zugewiesen`);
      await loadLeads();
      setAssignDialogOpen(false);
      setAssignTargetId("");
    } catch (e) {
      setAssignMessage(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssigning(false);
    }
  }

  // Zuweisung aufheben
  async function handleUnassign() {
    setAssigning(true);
    setAssignMessage(null);
    try {
      const res = await fetch("/api/admin/leads/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadIds: [...selectedIds],
          assignedTo: null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Fehler");
      setAssignMessage(`✓ Zuweisung für ${data.assigned} Lead(s) aufgehoben`);
      await loadLeads();
    } catch (e) {
      setAssignMessage(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAssigning(false);
    }
  }

  const hasFilters = searchQuery || statusFilter || categoryFilter || solarCompleteFilter;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Alle Leads (systemweit)
        </h1>
        <p className="text-muted-foreground">
          {leads.length} {leads.length === 1 ? "Lead" : "Leads"} gefunden
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Unternehmen oder Stadt suchen..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Kategorie" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={solarCompleteFilter ? "default" : "outline"}
              size="sm"
              onClick={() => setSolarCompleteFilter((v) => !v)}
              className={solarCompleteFilter ? "bg-amber-500 hover:bg-amber-600 text-white border-0" : ""}
            >
              <Sun className="mr-1 h-4 w-4" />
              Vollständige Solar-Daten
            </Button>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-1 h-4 w-4" />
                Filter zurücksetzen
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Aktionsleiste bei Auswahl */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-blue-50 px-4 py-3">
          <span className="text-sm font-medium text-blue-900">
            {selectedIds.size} Lead{selectedIds.size !== 1 ? "s" : ""} ausgewählt
          </span>
          <Button
            size="sm"
            onClick={() => { setAssignDialogOpen(true); setAssignMessage(null); }}
            disabled={assigning}
          >
            <UserPlus className="mr-1 h-4 w-4" />
            Zuweisen
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleUnassign}
            disabled={assigning}
          >
            <UserX className="mr-1 h-4 w-4" />
            Zuweisung aufheben
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelectedIds(new Set())}
          >
            <X className="h-4 w-4" />
          </Button>
          {assignMessage && (
            <span className={`text-sm ${assignMessage.startsWith("✓") ? "text-green-700" : "text-red-600"}`}>
              {assignMessage}
            </span>
          )}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Lade Leads...</span>
            </div>
          ) : leads.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">Keine Leads gefunden.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left">
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected; }}
                        onChange={toggleAll}
                        className="h-4 w-4 cursor-pointer rounded border-gray-300"
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">Unternehmen</th>
                    <th className="px-4 py-3 font-medium">Besitzer</th>
                    <th className="px-4 py-3 font-medium">Zugewiesen an</th>
                    <th className="px-4 py-3 font-medium">Kategorie</th>
                    <th className="px-4 py-3 font-medium">Stadt</th>
                    <th className="px-4 py-3 font-medium">Score</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Erstellt am</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <tr
                      key={lead.id}
                      className={`border-b last:border-0 hover:bg-slate-50 ${selectedIds.has(lead.id) ? "bg-blue-50" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(lead.id)}
                          onChange={() => toggleOne(lead.id)}
                          className="h-4 w-4 cursor-pointer rounded border-gray-300"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/leads/${lead.id}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {lead.company_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {lead.owner_email}
                      </td>
                      <td className="px-4 py-3">
                        {lead.assigned_email ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                            <UserPlus className="h-3 w-3" />
                            {lead.assigned_email}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {getCategoryLabel(lead.category)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {lead.city}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className={getScoreColor(lead.total_score)}>
                          {lead.total_score}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="secondary"
                          className={statusColors[lead.status] ?? "bg-gray-100"}
                        >
                          {statusLabels[lead.status] ?? lead.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(lead.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Zuweisungs-Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedIds.size} Lead{selectedIds.size !== 1 ? "s" : ""} zuweisen
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Nutzer auswählen</label>
            <Select value={assignTargetId} onValueChange={setAssignTargetId}>
              <SelectTrigger>
                <SelectValue placeholder="Nutzer wählen..." />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {assignMessage && (
              <p className={`mt-2 text-sm ${assignMessage.startsWith("✓") ? "text-green-700" : "text-red-600"}`}>
                {assignMessage}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleAssign} disabled={!assignTargetId || assigning}>
              {assigning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}
              Zuweisen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
