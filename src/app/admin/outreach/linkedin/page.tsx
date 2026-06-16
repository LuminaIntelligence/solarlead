"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Linkedin, Loader2, ExternalLink, Send, MessageCircle, Inbox,
  AlertCircle, ArrowRight, CheckCircle2, Plus, Sparkles, X, Filter, Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { CATEGORY_GROUPS, getCategoryLabel, CATEGORY_EMOJI } from "@/lib/constants/categories";

interface LinkedInJob {
  id: string;
  batch_id: string;
  lead_id: string;
  status: string;
  contact_name: string | null;
  contact_title: string | null;
  company_name: string | null;
  company_city: string | null;
  company_category: string | null;
  linkedin_url: string | null;
  linkedin_sent_at: string | null;
  linkedin_message: string | null;
  replied_at: string | null;
  outcome: string | null;
  scheduled_for: string | null;
  outreach_batches: { name: string } | null;
  solar_lead_mass: { total_score: number | null } | null;
}

interface ApiResponse {
  jobs: LinkedInJob[];
  counts: Record<string, number>;
  today_sent_count: number;
  stale_sent_count: number;
  total_unfiltered: number;
  total_filtered: number;
}

const SORT_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "score_desc", label: "Score ↓" },
  { key: "score_asc",  label: "Score ↑" },
  { key: "company",    label: "Firma A-Z" },
  { key: "city",       label: "Stadt A-Z" },
  { key: "newest",     label: "Neueste zuerst" },
];

const STATUS_TABS: Array<{ key: string; label: string; color: string }> = [
  { key: "pending", label: "Offen", color: "bg-amber-100 text-amber-800" },
  { key: "sent",    label: "Gesendet", color: "bg-blue-100 text-blue-800" },
  { key: "replied", label: "Beantwortet", color: "bg-green-100 text-green-800" },
  { key: "expired", label: "Abgelaufen (14d)", color: "bg-slate-100 text-slate-600" },
];

const SOFT_DAILY_LIMIT = 25; // LinkedIn-Limit Personal Profile ist 20-30/Tag

export default function LinkedInOutreachPage() {
  const { toast } = useToast();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // SessionStorage-Persistenz: Filter überleben Navigation zur Lead-Detail-Seite
  // und Zurück-Button. Wird beim Schließen des Tabs (echtes Session-Ende)
  // automatisch gelöscht.
  const SESSION_KEY = "linkedin-outreach-filters-v1";

  const [activeStatus, setActiveStatus] = useState<string>("pending");

  // Pool-Erstellungs-Form (NICHT persistiert — wäre verwirrend wenn alte
  // Pool-Filter beim nächsten Besuch wieder auftauchen)
  const [poolMinScore, setPoolMinScore] = useState(70);
  const [poolMaxScore, setPoolMaxScore] = useState(100);
  const [poolLimit, setPoolLimit] = useState(200);
  const [poolCategories, setPoolCategories] = useState<string[]>([]);
  const [poolCity, setPoolCity] = useState("");
  const [poolTitle, setPoolTitle] = useState("");
  const [showPoolFilters, setShowPoolFilters] = useState(false);
  const [poolCreating, setPoolCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Filter / Sort State (wird in sessionStorage gespiegelt)
  const [filterCategories, setFilterCategories] = useState<string[]>([]);
  const [filterCity, setFilterCity] = useState("");
  const [filterTitle, setFilterTitle] = useState("");
  const [filterMinScore, setFilterMinScore] = useState("");
  const [filterMaxScore, setFilterMaxScore] = useState("");
  const [sortKey, setSortKey] = useState<string>("score_desc");
  const [showFilters, setShowFilters] = useState<boolean>(false);
  // Restored-Flag: erst wenn aus sessionStorage gelesen wurde dürfen wir
  // den ersten Fetch und das Persistieren anstoßen. Verhindert Hydration-
  // Mismatch und das versehentliche Überschreiben gespeicherter Filter mit
  // den Defaults beim ersten Effect-Lauf.
  const [restored, setRestored] = useState(false);

  // 1) Beim Mount: Filter aus sessionStorage restoren
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.activeStatus === "string") setActiveStatus(s.activeStatus);
        if (typeof s.sortKey === "string") setSortKey(s.sortKey);
        if (typeof s.showFilters === "boolean") setShowFilters(s.showFilters);
        if (Array.isArray(s.filterCategories)) setFilterCategories(s.filterCategories);
        if (typeof s.filterCity === "string") setFilterCity(s.filterCity);
        if (typeof s.filterTitle === "string") setFilterTitle(s.filterTitle);
        if (typeof s.filterMinScore === "string") setFilterMinScore(s.filterMinScore);
        if (typeof s.filterMaxScore === "string") setFilterMaxScore(s.filterMaxScore);
      }
    } catch {
      // ignore corrupt sessionStorage
    }
    setRestored(true);
  }, []);

  // 2) Jede Änderung der Filter spiegeln (erst nach Restore)
  useEffect(() => {
    if (!restored) return;
    try {
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({
          activeStatus,
          sortKey,
          showFilters,
          filterCategories,
          filterCity,
          filterTitle,
          filterMinScore,
          filterMaxScore,
        })
      );
    } catch {
      // ignore quota errors
    }
  }, [
    restored,
    activeStatus,
    sortKey,
    showFilters,
    filterCategories,
    filterCity,
    filterTitle,
    filterMinScore,
    filterMaxScore,
  ]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status: activeStatus, sort: sortKey });
      if (filterCategories.length > 0) params.set("category", filterCategories.join(","));
      if (filterCity) params.set("city", filterCity);
      if (filterTitle) params.set("title", filterTitle);
      if (filterMinScore) params.set("min_score", filterMinScore);
      if (filterMaxScore) params.set("max_score", filterMaxScore);
      const res = await fetch(`/api/admin/outreach/linkedin?${params.toString()}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [activeStatus, sortKey, filterCategories, filterCity, filterTitle, filterMinScore, filterMaxScore]);

  function clearFilters() {
    setFilterCategories([]);
    setFilterCity("");
    setFilterTitle("");
    setFilterMinScore("");
    setFilterMaxScore("");
  }

  function toggleCategory(cat: string) {
    setFilterCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  async function discardJob(jobId: string, companyName: string) {
    if (!confirm(`Job für "${companyName}" verwerfen? (Lead bleibt in DB, Job verschwindet aus Offen-Liste)`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/outreach/linkedin/${jobId}/discard`, {
        method: "POST",
      });
      if (!res.ok) {
        const d = await res.json();
        toast({ title: "Fehler", description: d.error, variant: "destructive" });
        return;
      }
      toast({ title: "Verworfen", description: companyName });
      await load();
    } catch (err) {
      toast({
        title: "Netzwerk-Fehler",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    }
  }

  const activeFilterCount =
    filterCategories.length +
    (filterCity ? 1 : 0) +
    (filterTitle ? 1 : 0) +
    (filterMinScore ? 1 : 0) +
    (filterMaxScore ? 1 : 0);

  useEffect(() => {
    if (!restored) return; // erst nach sessionStorage-Restore fetchen
    load();
  }, [load, restored]);

  async function createPool() {
    const filterDesc = [
      poolCategories.length > 0
        ? `${poolCategories.length} Branchen`
        : "alle Branchen",
      poolCity ? `Stadt: ${poolCity}` : null,
      poolTitle ? `Titel: ${poolTitle}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (!confirm(
      `Score ${poolMinScore}-${poolMaxScore}, max ${poolLimit} · ${filterDesc} — alle Treffer bekommen einen LinkedIn-Outreach-Job. Fortfahren?`
    )) return;
    setPoolCreating(true);
    try {
      const res = await fetch("/api/admin/outreach/linkedin/pool-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          min_score: poolMinScore,
          max_score: poolMaxScore,
          limit: poolLimit,
          categories: poolCategories,
          city_contains: poolCity || undefined,
          title_contains: poolTitle || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast({ title: "Fehler", description: d.error, variant: "destructive" });
        return;
      }
      // Wenn 0 erstellt wurden: Diagnose im Toast zeigen damit User sieht
      // WARUM nichts gematched hat
      if (d.created === 0 && d.diagnostics) {
        const dx = d.diagnostics;
        toast({
          title: "0 Jobs erstellt — Diagnose:",
          description:
            `${dx.contacts_with_linkedin_url} Kontakte mit LinkedIn-URL · ` +
            `${dx.unique_leads_with_linkedin} unique Leads · ` +
            `davon ${dx.filtered_no_roof_area ?? 0} ohne Dachfläche, ` +
            `${dx.filtered_existing_solar} bereits Solar, ` +
            `${dx.filtered_outside_score_range} außerhalb Score-Range, ` +
            `${dx.filtered_by_category_or_city} durch Branche/Stadt-Filter raus, ` +
            `${dx.skipped_already_in_open_pool} schon im offenen Pool. ` +
            `Tipp: Filter weiter machen oder Score-Range erweitern.`,
          duration: 15000,
        });
      } else {
        const emailNote =
          d.email_pending_cancelled || d.email_followups_stopped
            ? ` · ${d.email_pending_cancelled} Email-Jobs storniert, ${d.email_followups_stopped} Follow-ups gestoppt`
            : "";
        const dx = d.diagnostics;
        const dxNote = dx
          ? ` (von ${dx.unique_leads_with_linkedin} möglichen: ` +
            `${dx.filtered_no_roof_area ?? 0} ohne Dach, ` +
            `${dx.filtered_existing_solar} Solar, ` +
            `${dx.filtered_outside_score_range} Score, ` +
            `${dx.filtered_by_category_or_city} Branche/Stadt, ` +
            `${dx.skipped_already_in_open_pool} im Pool)`
          : "";
        toast({
          title: `${d.created} LinkedIn-Jobs erstellt`,
          description:
            `${d.batch_name}${dxNote}${emailNote}`,
          duration: 12000,
        });
      }
      await load();
    } catch (err) {
      toast({
        title: "Netzwerk-Fehler",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setPoolCreating(false);
    }
  }

  async function resetPool() {
    // Vorab den Count holen damit der Confirm-Dialog ehrlich ist
    let pendingCount = 0;
    try {
      const probe = await fetch("/api/admin/outreach/linkedin/reset-pending");
      if (probe.ok) {
        const j = await probe.json();
        pendingCount = j.pending_count ?? 0;
      }
    } catch {
      // ignore — Confirm dann ohne Count
    }
    if (pendingCount === 0) {
      toast({ title: "Nichts zu tun", description: "Keine offenen LinkedIn-Jobs vorhanden." });
      return;
    }
    if (!confirm(
      `${pendingCount} offene LinkedIn-Jobs werden auf 'cancelled' gesetzt.\n\n` +
      `Gesendete & beantwortete Jobs bleiben unverändert. ` +
      `Danach kannst du den Pool neu füllen.\n\n` +
      `Fortfahren?`
    )) return;
    setResetting(true);
    try {
      const res = await fetch("/api/admin/outreach/linkedin/reset-pending", {
        method: "POST",
      });
      const d = await res.json();
      if (!res.ok) {
        toast({ title: "Fehler", description: d.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Pool zurückgesetzt",
        description: `${d.cancelled} LinkedIn-Jobs storniert. Du kannst jetzt sauber neu starten.`,
      });
      await load();
    } catch (err) {
      toast({
        title: "Netzwerk-Fehler",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  }

  async function syncEmailJobs() {
    if (!confirm(
      "Alle Leads die bereits in der LinkedIn-Pipeline sind werden aus offenen Email-Jobs entfernt (storniert) und ihre Follow-ups werden gestoppt. Fortfahren?"
    )) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/outreach/linkedin/sync-email-jobs", {
        method: "POST",
      });
      const d = await res.json();
      if (!res.ok) {
        toast({ title: "Fehler", description: d.error, variant: "destructive" });
        return;
      }
      toast({
        title: `Sync abgeschlossen`,
        description: `${d.leads_in_linkedin_pipeline} LinkedIn-Leads geprüft · ${d.email_pending_cancelled} pending Email-Jobs storniert · ${d.email_followups_stopped} Follow-ups gestoppt`,
      });
    } catch (err) {
      toast({
        title: "Netzwerk-Fehler",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Linkedin className="h-7 w-7 text-blue-700" />
            LinkedIn-Outreach
          </h1>
          <p className="text-slate-500 text-sm mt-1">
            Persönliche InMails an Leads mit LinkedIn-Profil. Manuell-assistiert:
            Template + Profil-Link, du sendest über LinkedIn, markierst hier „Gesendet".
          </p>
        </div>
        <Link
          href="/admin/outreach/linkedin/templates"
          className="text-sm text-blue-700 hover:underline inline-flex items-center gap-1"
        >
          Templates verwalten <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Stale-Reminder: gesendete InMails ≥1 Tag ohne Antwort-Vermerk */}
      {data && data.stale_sent_count > 0 && activeStatus !== "sent" && (
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="py-3 px-4 flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 shrink-0 text-amber-700" />
              <span>
                <strong>{data.stale_sent_count}</strong> InMails warten ≥1 Tag
                auf Antwort-Check — kurz auf LinkedIn nachschauen?
              </span>
            </div>
            <button
              onClick={() => setActiveStatus("sent")}
              className="text-xs font-medium text-amber-900 hover:underline"
            >
              → Anzeigen
            </button>
          </CardContent>
        </Card>
      )}

      {/* Daily Rate-Limit-Hinweis */}
      {data && data.today_sent_count >= SOFT_DAILY_LIMIT * 0.8 && (
        <Card
          className={
            data.today_sent_count >= SOFT_DAILY_LIMIT
              ? "bg-red-50 border-red-200"
              : "bg-amber-50 border-amber-200"
          }
        >
          <CardContent className="py-3 px-4 flex items-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              Heute schon <strong>{data.today_sent_count}</strong> InMails gesendet.
              LinkedIn-Limit Personal Profile liegt bei ~{SOFT_DAILY_LIMIT}/Tag.
              {data.today_sent_count >= SOFT_DAILY_LIMIT
                ? " Weitere Sends könnten Account-Warnungen auslösen."
                : " Vorsichtig dosieren."}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Pool-Erstellung (wenn keine Jobs vorhanden) */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-700" />
            Pool füllen aus vorhandenen Leads
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-600 mb-3">
            Erstellt LinkedIn-Outreach-Jobs für alle Leads im Score-Range die schon
            eine persönliche LinkedIn-URL haben (über Apollo/Impressum/Google-CSE
            gefunden). Du wählst dann pro Lead manuell ob du eine InMail schicken willst.
          </p>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Score min
              </label>
              <input
                type="number"
                value={poolMinScore}
                onChange={(e) => setPoolMinScore(Number(e.target.value))}
                min={0}
                max={100}
                className="w-20 border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Score max
              </label>
              <input
                type="number"
                value={poolMaxScore}
                onChange={(e) => setPoolMaxScore(Number(e.target.value))}
                min={0}
                max={100}
                className="w-20 border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Max Leads
              </label>
              <input
                type="number"
                value={poolLimit}
                onChange={(e) => setPoolLimit(Number(e.target.value))}
                min={1}
                max={2000}
                className="w-24 border border-slate-300 rounded px-2 py-1.5 text-sm"
              />
            </div>
            <Button onClick={createPool} disabled={poolCreating}>
              {poolCreating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Pool erstellen
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPoolFilters((v) => !v)}
            >
              <Filter className="h-3.5 w-3.5 mr-1.5" />
              {showPoolFilters ? "Filter ausblenden" : "Mehr Filter"}
              {(poolCategories.length > 0 || poolCity || poolTitle) && (
                <span className="ml-1.5 bg-blue-600 text-white text-[10px] rounded-full px-1.5 py-0.5">
                  {poolCategories.length + (poolCity ? 1 : 0) + (poolTitle ? 1 : 0)}
                </span>
              )}
            </Button>
          </div>

          {showPoolFilters && (
            <div className="mt-4 pt-3 border-t border-blue-200 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-slate-700">
                    Branche ({poolCategories.length || "alle"})
                  </label>
                  {poolCategories.length > 0 && (
                    <button
                      onClick={() => setPoolCategories([])}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      zurücksetzen
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {CATEGORY_GROUPS.map((group) => (
                    <div key={group.label}>
                      <div className="text-[10px] uppercase text-slate-400 mb-1 font-medium tracking-wide">
                        {group.label}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.items.map((cat) => {
                          const active = poolCategories.includes(cat.value);
                          return (
                            <button
                              key={cat.value}
                              onClick={() =>
                                setPoolCategories((prev) =>
                                  prev.includes(cat.value)
                                    ? prev.filter((c) => c !== cat.value)
                                    : [...prev, cat.value]
                                )
                              }
                              className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                                active
                                  ? "bg-blue-600 text-white border-blue-600"
                                  : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"
                              }`}
                            >
                              {cat.emoji} {cat.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Stadt enthält
                  </label>
                  <input
                    type="text"
                    value={poolCity}
                    onChange={(e) => setPoolCity(e.target.value)}
                    placeholder="z.B. Bayern, München"
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Titel enthält
                  </label>
                  <input
                    type="text"
                    value={poolTitle}
                    onChange={(e) => setPoolTitle(e.target.value)}
                    placeholder="z.B. Geschäftsführer"
                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
            </div>
          )}
          <div className="mt-4 pt-3 border-t border-blue-200">
            <p className="text-xs text-slate-600 mb-2">
              <strong>Email-Sync für Bestand:</strong> Falls du den Pool schon vor
              dem 01.06. erstellt hast, laufen ggf. noch parallele Email-Jobs für
              dieselben Leads. Klick stoppt diese rückwirkend.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={syncEmailJobs} disabled={syncing} variant="outline" size="sm">
                {syncing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Email-Jobs für LinkedIn-Leads stoppen
              </Button>
              <Button
                onClick={resetPool}
                disabled={resetting}
                variant="outline"
                size="sm"
                className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
              >
                {resetting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1.5" />
                )}
                Pool komplett zurücksetzen
              </Button>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">
              <strong>Pool zurücksetzen:</strong> Storniert ALLE offenen
              (pending) LinkedIn-Jobs. Gesendete & beantwortete bleiben.
              Danach kannst du mit den verbesserten Filtern neu auffüllen.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Status-Tabs */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {STATUS_TABS.map((t) => {
            const count = data?.counts[t.key] ?? 0;
            const active = activeStatus === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setActiveStatus(t.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
                }`}
              >
                {t.label} ({count})
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            className="text-xs border border-slate-300 rounded px-2 py-1.5 bg-white"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>
                Sortieren: {s.label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
          >
            <Filter className="h-3.5 w-3.5 mr-1.5" />
            Filter
            {activeFilterCount > 0 && (
              <span className="ml-1.5 bg-blue-600 text-white text-[10px] rounded-full px-1.5 py-0.5">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Filter-Panel */}
      {showFilters && (
        <Card className="bg-slate-50 border-slate-200">
          <CardContent className="pt-4 pb-3 space-y-4">
            {/* Branchen-Multi-Select */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-slate-700">
                  Branche ({filterCategories.length || "alle"})
                </label>
                {filterCategories.length > 0 && (
                  <button
                    onClick={() => setFilterCategories([])}
                    className="text-xs text-slate-500 hover:text-slate-700"
                  >
                    zurücksetzen
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {CATEGORY_GROUPS.map((group) => (
                  <div key={group.label}>
                    <div className="text-[10px] uppercase text-slate-400 mb-1 font-medium tracking-wide">
                      {group.label}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.items.map((cat) => {
                        const active = filterCategories.includes(cat.value);
                        return (
                          <button
                            key={cat.value}
                            onClick={() => toggleCategory(cat.value)}
                            className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                              active
                                ? "bg-blue-600 text-white border-blue-600"
                                : "bg-white text-slate-600 border-slate-300 hover:border-slate-500"
                            }`}
                          >
                            {cat.emoji} {cat.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Text-Filter + Score */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Stadt enthält
                </label>
                <input
                  type="text"
                  value={filterCity}
                  onChange={(e) => setFilterCity(e.target.value)}
                  placeholder="z.B. München"
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Titel enthält
                </label>
                <input
                  type="text"
                  value={filterTitle}
                  onChange={(e) => setFilterTitle(e.target.value)}
                  placeholder="z.B. Geschäftsführer"
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Score min
                </label>
                <input
                  type="number"
                  value={filterMinScore}
                  onChange={(e) => setFilterMinScore(e.target.value)}
                  placeholder="0"
                  min={0}
                  max={100}
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Score max
                </label>
                <input
                  type="number"
                  value={filterMaxScore}
                  onChange={(e) => setFilterMaxScore(e.target.value)}
                  placeholder="100"
                  min={0}
                  max={100}
                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-slate-200">
              <span className="text-xs text-slate-500">
                {data
                  ? `${data.total_filtered} von ${data.total_unfiltered} angezeigt`
                  : "—"}
              </span>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="h-3.5 w-3.5 mr-1" /> Alle zurücksetzen
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Job-Liste */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : !data || data.jobs.length === 0 ? (
            <div className="py-16 text-center">
              <Linkedin className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">
                Keine LinkedIn-Jobs mit Status „{activeStatus}".
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Leads mit LinkedIn-URL werden beim Batch-Erstellen automatisch hierher geroutet.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-xs">
                    <th className="px-4 py-2 font-medium">Lead</th>
                    <th className="px-4 py-2 font-medium">Kontakt</th>
                    <th className="px-4 py-2 font-medium">Score</th>
                    <th className="px-4 py-2 font-medium">LinkedIn</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.map((j) => {
                    const isPending = j.status === "pending";
                    const isReplied = j.status === "replied";
                    return (
                      <tr key={j.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/dashboard/leads/${j.lead_id}`}
                            className="font-medium text-slate-900 hover:text-blue-700 hover:underline"
                          >
                            {j.company_name ?? "—"}
                          </Link>
                          <div className="text-xs text-slate-500">
                            {j.company_city ?? ""}
                            {j.company_category
                              ? ` · ${CATEGORY_EMOJI[j.company_category] ?? ""} ${getCategoryLabel(j.company_category)}`
                              : ""}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="text-slate-700">{j.contact_name ?? "—"}</div>
                          <div className="text-xs text-slate-500">{j.contact_title ?? ""}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          {j.solar_lead_mass?.total_score != null ? (
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                                j.solar_lead_mass.total_score >= 80
                                  ? "bg-green-100 text-green-800"
                                  : j.solar_lead_mass.total_score >= 60
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-slate-100 text-slate-600"
                              }`}
                            >
                              {j.solar_lead_mass.total_score}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {j.linkedin_url ? (
                            <a
                              href={j.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline"
                            >
                              Profil <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-slate-400">keine URL</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {isPending && (
                            <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                              Offen
                            </Badge>
                          )}
                          {j.status === "sent" && (
                            <div>
                              <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                                <Send className="h-3 w-3 mr-1 inline" /> Gesendet
                              </Badge>
                              {j.linkedin_sent_at && (
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  {new Date(j.linkedin_sent_at).toLocaleString("de-DE", {
                                    day: "2-digit", month: "2-digit",
                                    hour: "2-digit", minute: "2-digit",
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                          {isReplied && (
                            <Badge variant="secondary" className="bg-green-100 text-green-800">
                              <CheckCircle2 className="h-3 w-3 mr-1 inline" /> Beantwortet
                            </Badge>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-3">
                            <Link
                              href={`/admin/outreach/linkedin/${j.id}`}
                              className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
                            >
                              {isPending ? "InMail vorbereiten" : "Details"}
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                            {isPending && (
                              <button
                                onClick={() =>
                                  discardJob(j.id, j.company_name ?? "Lead")
                                }
                                className="text-xs text-slate-400 hover:text-red-600"
                                title="Job verwerfen"
                              >
                                Verwerfen
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
