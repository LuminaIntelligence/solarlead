"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff, Loader2, RotateCcw, Server, Settings, Sun, CheckCircle2, AlertCircle, Users, ScanSearch, Database, FlaskConical } from "lucide-react";
import { getUserSettings, updateUserSettings } from "@/lib/actions/settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import type { ScoringWeights } from "@/types/database";

const DEFAULT_WEIGHTS: ScoringWeights = {
  business: 25,
  electricity: 25,
  solar: 25,
  outreach: 25,
};

export default function AdminSettingsPage() {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [placesKey, setPlacesKey] = useState("");
  const [solarKey, setSolarKey] = useState("");
  const [providerMode, setProviderMode] = useState<"mock" | "live">("mock");
  const [showPlacesKey, setShowPlacesKey] = useState(false);
  const [showSolarKey, setShowSolarKey] = useState(false);
  const [savingApi, setSavingApi] = useState(false);

  const [weights, setWeights] = useState<ScoringWeights>({ ...DEFAULT_WEIGHTS });
  const [savingWeights, setSavingWeights] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  // Backfill solar tool
  const [backfillStatus, setBackfillStatus] = useState<{ missing?: number; total?: number } | null>(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ fixed?: number; error?: string; message?: string } | null>(null);

  // Full solar backfill (calls Google Solar API)
  const [solarFullStatus, setSolarFullStatus] = useState<{ partial?: number; missing?: number; total?: number; noCoverage?: number } | null>(null);
  const [solarFullRunning, setSolarFullRunning] = useState(false);
  const [solarFullResetting, setSolarFullResetting] = useState(false);
  const [solarFullProgress, setSolarFullProgress] = useState<{ processed: number; processedFallback: number; failed: number; noCoverage: number; remaining: number; firstError?: string | null } | null>(null);
  const [solarFullDone, setSolarFullDone] = useState(false);
  const [solarFullRateLimited, setSolarFullRateLimited] = useState(false);

  // Backfill contacts tool
  const [contactBackfillMissing, setContactBackfillMissing] = useState<number | null>(null);
  const [contactBackfillRunning, setContactBackfillRunning] = useState(false);
  const [contactBackfillProgress, setContactBackfillProgress] = useState<{ processed: number; found: number; remaining: number } | null>(null);
  const [contactBackfillDone, setContactBackfillDone] = useState(false);

  // Solar detection backfill tool (OSM)
  const [solarDetectionTotal, setSolarDetectionTotal] = useState<number | null>(null);
  const [solarDetectionRunning, setSolarDetectionRunning] = useState(false);
  const [solarDetectionProgress, setSolarDetectionProgress] = useState<{ processed: number; detected: number; remaining: number } | null>(null);
  const [solarDetectionDone, setSolarDetectionDone] = useState(false);

  // Solar API Health Check
  const [solarTestResult, setSolarTestResult] = useState<{
    ok: boolean; status: string; message: string; latencyMs?: number; hint?: string;
  } | null>(null);
  const [solarTesting, setSolarTesting] = useState(false);

  const handleSolarTest = async () => {
    setSolarTesting(true);
    setSolarTestResult(null);
    try {
      const res = await fetch("/api/admin/tools/solar-test");
      const data = await res.json();
      setSolarTestResult(data);
    } catch {
      setSolarTestResult({ ok: false, status: "network_error", message: "Anfrage fehlgeschlagen." });
    } finally {
      setSolarTesting(false);
    }
  };

  // MaStR Backfill
  type MastrStatus = "idle" | "fetching_url" | "wget_download" | "downloading" | "parsing" | "matching" | "updating" | "done" | "error";
  const [mastrJob, setMastrJob] = useState<{
    status: MastrStatus; message: string; downloadedMB: number; totalMB: number;
    parsedUnits: number; leadsTotal: number; leadsChecked: number;
    matchesFound: number; updatedCount: number; error: string | null;
  } | null>(null);
  const [mastrUrl, setMastrUrl] = useState("");
  const [mastrPolling, setMastrPolling] = useState(false);

  // Beim Laden: prüfen ob MaStR-Job bereits läuft (z.B. nach Seitenreload)
  useEffect(() => {
    fetch("/api/admin/tools/mastr-backfill")
      .then((r) => r.json())
      .then((data) => {
        setMastrJob(data);
        if (!["idle", "done", "error"].includes(data.status)) {
          setMastrPolling(true); // automatisch Polling starten wenn Job läuft
        }
      })
      .catch(() => {});
  }, []);

  // Poll MaStR job status while running
  useEffect(() => {
    if (!mastrPolling) return;
    const iv = setInterval(async () => {
      try {
        const data = await fetch("/api/admin/tools/mastr-backfill").then((r) => r.json());
        setMastrJob(data);
        if (["done", "error", "idle"].includes(data.status)) {
          setMastrPolling(false);
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(iv);
  }, [mastrPolling]);

  useEffect(() => {
    fetch("/api/admin/tools/backfill-solar")
      .then((r) => r.json())
      .then(setBackfillStatus)
      .catch(() => {});
    fetch("/api/admin/tools/backfill-solar-full")
      .then((r) => r.json())
      .then(setSolarFullStatus)
      .catch(() => {});
    fetch("/api/admin/tools/backfill-contacts")
      .then((r) => r.json())
      .then((d) => setContactBackfillMissing(d.missing ?? 0))
      .catch(() => {});
    fetch("/api/admin/tools/solar-detection-backfill")
      .then((r) => r.json())
      .then((d) => setSolarDetectionTotal(d.total ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const data = await getUserSettings();
        if (data) {
          setPlacesKey(data.google_places_api_key ?? "");
          setSolarKey(data.google_solar_api_key ?? "");
          setProviderMode(data.provider_mode);
          if (data.scoring_weights) {
            setWeights({
              business: Math.round(data.scoring_weights.business * 100),
              electricity: Math.round(data.scoring_weights.electricity * 100),
              solar: Math.round(data.scoring_weights.solar * 100),
              outreach: Math.round(data.scoring_weights.outreach * 100),
            });
          }
        }
      } catch {
        toast({
          title: "Fehler beim Laden",
          description: "Einstellungen konnten nicht geladen werden.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [toast]);

  const handleSaveApi = async () => {
    setSavingApi(true);
    try {
      const updated = await updateUserSettings({
        google_places_api_key: placesKey || null,
        google_solar_api_key: solarKey || null,
        provider_mode: providerMode,
      });
      if (updated) {
        toast({ title: "Gespeichert", description: "API-Konfiguration aktualisiert." });
      } else {
        toast({ title: "Fehler", description: "Speichern fehlgeschlagen.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Fehler", description: "Speichern fehlgeschlagen.", variant: "destructive" });
    } finally {
      setSavingApi(false);
    }
  };

  const handleSaveWeights = async () => {
    setSavingWeights(true);
    try {
      const total = weights.business + weights.electricity + weights.solar + weights.outreach;
      const normalized: ScoringWeights = {
        business: total > 0 ? weights.business / total : 0.25,
        electricity: total > 0 ? weights.electricity / total : 0.25,
        solar: total > 0 ? weights.solar / total : 0.25,
        outreach: total > 0 ? weights.outreach / total : 0.25,
      };

      const updated = await updateUserSettings({ scoring_weights: normalized });
      if (updated) {
        toast({ title: "Gewichtung gespeichert", description: "Scores werden neu berechnet..." });
        try {
          const res = await fetch("/api/recalculate", { method: "POST" });
          if (res.ok) {
            const data = await res.json();
            toast({ title: "Scores aktualisiert", description: `${data.updated ?? 0} Leads neu berechnet.` });
          }
        } catch { /* Gewichtung ist trotzdem gespeichert */ }
      } else {
        toast({ title: "Fehler", description: "Speichern fehlgeschlagen.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Fehler", description: "Speichern fehlgeschlagen.", variant: "destructive" });
    } finally {
      setSavingWeights(false);
    }
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const res = await fetch("/api/recalculate", { method: "POST" });
      if (!res.ok) throw new Error("Fehlgeschlagen");
      const data = await res.json();
      toast({ title: "Scores neu berechnet", description: `${data.updated ?? 0} Leads aktualisiert.` });
    } catch {
      toast({ title: "Fehler", description: "Neuberechnung fehlgeschlagen.", variant: "destructive" });
    } finally {
      setRecalculating(false);
    }
  };

  const weightsTotal = weights.business + weights.electricity + weights.solar + weights.outreach;

  const handleContactBackfill = async () => {
    setContactBackfillRunning(true);
    setContactBackfillDone(false);
    setContactBackfillProgress(null);
    let offset = 0;
    let totalProcessed = 0;
    let totalFound = 0;

    try {
      while (true) {
        const res = await fetch("/api/admin/tools/backfill-contacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset, limit: 20 }),
        });
        const data = await res.json();
        totalProcessed += data.processed ?? 0;
        totalFound += data.found ?? 0;
        offset = data.nextOffset ?? offset + 20;

        setContactBackfillProgress({ processed: totalProcessed, found: totalFound, remaining: data.remaining ?? 0 });

        if (!data.remaining || data.remaining === 0 || data.processed === 0) break;
        // Short pause between batches to avoid overloading
        await new Promise((r) => setTimeout(r, 500));
      }
      setContactBackfillDone(true);
      setContactBackfillMissing(0);
    } catch {
      setContactBackfillProgress((p) => ({ ...(p ?? { processed: 0, found: 0 }), remaining: -1 }));
    } finally {
      setContactBackfillRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System-Einstellungen</h1>
        <p className="text-muted-foreground">
          API-Konfiguration, Scoring-Gewichtung und Datenverwaltung
        </p>
      </div>

      {/* API-Konfiguration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            API-Konfiguration
          </CardTitle>
          <CardDescription>
            Google API-Schlüssel und Anbieter-Modus für das gesamte System
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="places-key">Google Places API-Schlüssel</Label>
            <div className="relative">
              <Input
                id="places-key"
                type={showPlacesKey ? "text" : "password"}
                value={placesKey}
                onChange={(e) => setPlacesKey(e.target.value)}
                placeholder="Google Places API-Schlüssel eingeben"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPlacesKey(!showPlacesKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPlacesKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="solar-key">Google Solar API-Schlüssel</Label>
            <div className="relative">
              <Input
                id="solar-key"
                type={showSolarKey ? "text" : "password"}
                value={solarKey}
                onChange={(e) => setSolarKey(e.target.value)}
                placeholder="Google Solar API-Schlüssel eingeben"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowSolarKey(!showSolarKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showSolarKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Solar API Health Check */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleSolarTest} disabled={solarTesting}>
              {solarTesting
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <FlaskConical className="mr-2 h-4 w-4" />}
              Solar API testen
            </Button>
            {solarTestResult && (
              <div className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm flex-1 min-w-0 ${solarTestResult.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
                {solarTestResult.ok
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />}
                <div>
                  <p className="font-medium">{solarTestResult.message}</p>
                  {solarTestResult.hint && <p className="text-xs opacity-80 mt-0.5">{solarTestResult.hint}</p>}
                  {solarTestResult.latencyMs && <p className="text-xs opacity-60">{solarTestResult.latencyMs} ms</p>}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="provider-mode">Anbieter-Modus</Label>
            <Select value={providerMode} onValueChange={(v) => setProviderMode(v as "mock" | "live")}>
              <SelectTrigger id="provider-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mock">Mock (Testdaten)</SelectItem>
                <SelectItem value="live">Live (Echte APIs)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Im Mock-Modus werden simulierte Daten verwendet. Wechseln Sie zu Live, wenn API-Schlüssel konfiguriert sind.
            </p>
          </div>

          <Button onClick={handleSaveApi} disabled={savingApi}>
            {savingApi && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            API-Konfiguration speichern
          </Button>
        </CardContent>
      </Card>

      {/* Scoring-Gewichtung */}
      <Card>
        <CardHeader>
          <CardTitle>Scoring-Gewichtung</CardTitle>
          <CardDescription>
            Bestimmt, wie stark jeder Faktor zum Gesamt-Score beiträgt. Gilt für alle Nutzer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="weight-business">Unternehmenseignung</Label>
                <span className="text-sm font-medium">
                  {weightsTotal > 0 ? Math.round((weights.business / weightsTotal) * 100) : 25}%
                </span>
              </div>
              <Input id="weight-business" type="number" min={0} max={100} value={weights.business}
                onChange={(e) => setWeights((w) => ({ ...w, business: Math.max(0, Number(e.target.value) || 0) }))} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="weight-electricity">Stromverbrauch</Label>
                <span className="text-sm font-medium">
                  {weightsTotal > 0 ? Math.round((weights.electricity / weightsTotal) * 100) : 25}%
                </span>
              </div>
              <Input id="weight-electricity" type="number" min={0} max={100} value={weights.electricity}
                onChange={(e) => setWeights((w) => ({ ...w, electricity: Math.max(0, Number(e.target.value) || 0) }))} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="weight-solar">Solarpotenzial</Label>
                <span className="text-sm font-medium">
                  {weightsTotal > 0 ? Math.round((weights.solar / weightsTotal) * 100) : 25}%
                </span>
              </div>
              <Input id="weight-solar" type="number" min={0} max={100} value={weights.solar}
                onChange={(e) => setWeights((w) => ({ ...w, solar: Math.max(0, Number(e.target.value) || 0) }))} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="weight-outreach">Vertriebsbereitschaft</Label>
                <span className="text-sm font-medium">
                  {weightsTotal > 0 ? Math.round((weights.outreach / weightsTotal) * 100) : 25}%
                </span>
              </div>
              <Input id="weight-outreach" type="number" min={0} max={100} value={weights.outreach}
                onChange={(e) => setWeights((w) => ({ ...w, outreach: Math.max(0, Number(e.target.value) || 0) }))} />
            </div>
          </div>

          {weightsTotal !== 100 && (
            <p className="text-xs text-muted-foreground">
              Aktueller Gesamtwert: {weightsTotal}. Werte werden beim Speichern auf 100% normalisiert.
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={handleSaveWeights} disabled={savingWeights}>
              {savingWeights && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Gewichtung speichern
            </Button>
            <Button variant="outline" onClick={() => setWeights({ ...DEFAULT_WEIGHTS })}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Auf Standard zurücksetzen
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Datenverwaltung */}
      <Card>
        <CardHeader>
          <CardTitle>Datenverwaltung</CardTitle>
          <CardDescription>
            Scores aller Leads mit den aktuellen Gewichtungen neu berechnen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={handleRecalculate} disabled={recalculating}>
            {recalculating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
            Alle Scores neu berechnen
          </Button>
        </CardContent>
      </Card>

      {/* System-Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            System-Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b pb-3">
              <span className="text-sm text-muted-foreground">App Version</span>
              <span className="text-sm font-medium">0.1.0</span>
            </div>
            <div className="flex items-center justify-between border-b pb-3">
              <span className="text-sm text-muted-foreground">Umgebung</span>
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                {typeof process !== "undefined" && process.env?.NODE_ENV === "production" ? "Produktion" : "Entwicklung"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Anbieter-Modus</span>
              <Badge variant="secondary" className={providerMode === "live" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}>
                {providerMode === "live" ? "Live" : "Mock"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Solar Backfill Tool */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sun className="h-5 w-5 text-yellow-500" />
            Solar-Daten Rückfüllung
          </CardTitle>
          <CardDescription>
            Füllt fehlende Solar-Bewertungen aus Discovery-Daten nach — kein API-Kontingent verbraucht
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {backfillStatus && (
            <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
              <div className="text-sm">
                <span className="font-medium text-slate-900">{backfillStatus.missing ?? "…"}</span>
                <span className="text-slate-500"> von {backfillStatus.total ?? "…"} Leads fehlt Solar-Bewertung</span>
              </div>
              {backfillStatus.missing === 0 && (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
            </div>
          )}

          {backfillResult && (
            <div className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm border ${
              backfillResult.error ? "bg-red-50 border-red-200 text-red-700" : "bg-green-50 border-green-200 text-green-700"
            }`}>
              {backfillResult.error
                ? <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                : <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />}
              <span>{backfillResult.message ?? backfillResult.error}</span>
            </div>
          )}

          <Button
            onClick={async () => {
              setBackfillRunning(true);
              setBackfillResult(null);
              try {
                const res = await fetch("/api/admin/tools/backfill-solar", { method: "POST" });
                const data = await res.json();
                setBackfillResult(data);
                // Refresh counter
                const status = await fetch("/api/admin/tools/backfill-solar").then((r) => r.json());
                setBackfillStatus(status);
              } catch {
                setBackfillResult({ error: "Netzwerkfehler" });
              } finally {
                setBackfillRunning(false);
              }
            }}
            disabled={backfillRunning || backfillStatus?.missing === 0}
            className="gap-2"
          >
            {backfillRunning ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Wird ausgeführt…</>
            ) : (
              <><Sun className="h-4 w-4" /> Jetzt rückfüllen ({backfillStatus?.missing ?? "…"} Leads)</>
            )}
          </Button>
          <p className="text-xs text-slate-400">
            Kopiert Dachfläche und Solarqualität aus Discovery-Kampagnen. Detailwerte (Panele, Jahresenergie)
            können danach pro Lead über „Solar-Analyse durchführen" nachgeladen werden.
          </p>
        </CardContent>
      </Card>

      {/* Full Solar Backfill Tool (calls Google Solar API) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sun className="h-5 w-5 text-orange-500" />
            Solar-Detaildaten nachladen (Google Solar API)
          </CardTitle>
          <CardDescription>
            Ruft die Google Solar API für alle Leads auf, denen Detaildaten fehlen (Panele, Jahresenergie, Sonnenstunden). Verbraucht API-Kontingent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {solarFullStatus && (
            <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
              <div className="text-sm space-y-0.5">
                <div>
                  <span className="font-medium text-slate-900">{solarFullStatus.total ?? "…"}</span>
                  <span className="text-slate-500"> Leads noch ausstehend</span>
                  {(solarFullStatus.partial ?? 0) > 0 && (
                    <span className="text-slate-400 ml-1">({solarFullStatus.partial} unvollständig, {solarFullStatus.missing} ohne Bewertung)</span>
                  )}
                </div>
                {(solarFullStatus.noCoverage ?? 0) > 0 && (
                  <div className="text-xs text-amber-600">
                    {solarFullStatus.noCoverage} Leads dauerhaft ohne Google-Solar-Abdeckung (bereits markiert)
                  </div>
                )}
              </div>
              {solarFullStatus.total === 0 && <CheckCircle2 className="h-4 w-4 text-green-500" />}
            </div>
          )}

          {solarFullProgress && (
            <div className="space-y-2">
              <div className="flex flex-wrap justify-between gap-x-4 text-sm text-slate-600">
                <span className="flex gap-3 flex-wrap">
                  {solarFullProgress.processed > 0 && (
                    <span className="text-green-700 font-medium">✓ {solarFullProgress.processed} Google Solar</span>
                  )}
                  {solarFullProgress.processedFallback > 0 && (
                    <span className="text-blue-700 font-medium">✓ {solarFullProgress.processedFallback} OSM+PVGIS</span>
                  )}
                  {solarFullProgress.noCoverage > 0 && (
                    <span className="text-amber-600">⚠ {solarFullProgress.noCoverage} kein Gebäude</span>
                  )}
                  {solarFullProgress.failed > 0 && (
                    <span className="text-red-600">✗ {solarFullProgress.failed} Fehler</span>
                  )}
                </span>
                <span className="text-slate-400">{solarFullProgress.remaining} verbleibend</span>
              </div>
              {solarFullProgress.firstError && (
                <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 font-mono truncate" title={solarFullProgress.firstError}>
                  {solarFullProgress.firstError}
                </div>
              )}
              {solarFullProgress.remaining > 0 && (
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div
                    className="bg-orange-500 h-2 rounded-full transition-all"
                    style={{
                      width: `${Math.round(
                        (solarFullProgress.processed /
                          Math.max(solarFullProgress.processed + solarFullProgress.remaining, 1)) * 100
                      )}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {solarFullRateLimited && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
              <AlertCircle className="h-4 w-4 shrink-0" />
              API-Kontingent erschöpft. Bitte morgen weitermachen — Google Solar API hat ein Tageslimit.
            </div>
          )}
          {solarFullDone && !solarFullRateLimited && (solarFullProgress?.remaining ?? 1) === 0 && (
            <div className="flex items-start gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Fertig!</p>
                {(solarFullProgress?.noCoverage ?? 0) > 0 && (
                  <p className="text-xs mt-0.5 text-green-600 opacity-80">
                    {solarFullProgress!.noCoverage} Leads ohne Google-Solar-Abdeckung dauerhaft markiert — sie erscheinen nicht mehr in der Warteschlange.
                    Mit „Fehlgeschlagene zurücksetzen" können sie erneut versucht werden.
                  </p>
                )}
              </div>
            </div>
          )}
          {solarFullDone && !solarFullRateLimited && (solarFullProgress?.remaining ?? 0) > 0 && (
            <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {solarFullProgress?.remaining} Leads noch ausstehend — möglicherweise vorübergehende API-Fehler. Nochmals starten um es zu versuchen.
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={async () => {
                setSolarFullRunning(true);
                setSolarFullDone(false);
                setSolarFullRateLimited(false);
                setSolarFullProgress(null);
                let totalProcessed = 0;
                let totalFallback = 0;
                let totalFailed = 0;
                let totalNoCoverage = 0;
                let lastFirstError: string | null = null;
                // Track consecutive batches with zero real work (all no-coverage or network error)
                let consecutiveEmpty = 0;
                try {
                  while (true) {
                    const res = await fetch("/api/admin/tools/backfill-solar-full", { method: "POST" });
                    const data = await res.json();
                    if (!res.ok) break;
                    totalProcessed += data.processed ?? 0;
                    totalFallback += data.processedFallback ?? 0;
                    totalFailed += data.failed ?? 0;
                    totalNoCoverage += data.noCoverage ?? 0;
                    if (data.firstError) lastFirstError = data.firstError;
                    setSolarFullProgress({
                      processed: totalProcessed,
                      processedFallback: totalFallback,
                      failed: totalFailed,
                      noCoverage: totalNoCoverage,
                      remaining: data.remaining ?? 0,
                      firstError: lastFirstError,
                    });
                    // Rate limited — stop immediately
                    if (data.rateLimited) { setSolarFullRateLimited(true); break; }
                    // All done
                    if ((data.remaining ?? 0) === 0) break;
                    // Nothing useful happened in this batch (no work of any kind)
                    if ((data.processed ?? 0) === 0 && (data.failed ?? 0) === 0 && (data.noCoverage ?? 0) === 0) {
                      consecutiveEmpty++;
                      if (consecutiveEmpty >= 3) break;
                    } else {
                      consecutiveEmpty = 0;
                    }
                    await new Promise((r) => setTimeout(r, 800));
                  }
                  setSolarFullDone(true);
                  const status = await fetch("/api/admin/tools/backfill-solar-full").then((r) => r.json());
                  setSolarFullStatus(status);
                } catch {
                  // keep progress shown
                } finally {
                  setSolarFullRunning(false);
                }
              }}
              disabled={solarFullRunning || solarFullResetting || solarFullStatus?.total === 0}
              className="gap-2 bg-orange-600 hover:bg-orange-700 text-white"
            >
              {solarFullRunning ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Wird geladen… ({solarFullProgress?.processed ?? 0} fertig)</>
              ) : (
                <><Sun className="h-4 w-4" /> Solar-Detaildaten nachladen ({solarFullStatus?.total ?? "…"} Leads)</>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                if (!confirm("Alle Placeholder-Einträge (gescheiterte Versuche) löschen und Backfill neu starten?")) return;
                setSolarFullResetting(true);
                try {
                  await fetch("/api/admin/tools/backfill-solar-full", { method: "DELETE" });
                  const status = await fetch("/api/admin/tools/backfill-solar-full").then((r) => r.json());
                  setSolarFullStatus(status);
                  setSolarFullProgress(null);
                  setSolarFullDone(false);
                } finally {
                  setSolarFullResetting(false);
                }
              }}
              disabled={solarFullRunning || solarFullResetting}
              className="gap-2 border-slate-300 text-slate-600"
              title="Löscht alle Placeholder-Einträge (Leads ohne Paneldaten) damit sie nochmals versucht werden"
            >
              {solarFullResetting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Wird zurückgesetzt…</>
                : <><RotateCcw className="h-4 w-4" /> Fehlgeschlagene zurücksetzen</>
              }
            </Button>
          </div>
          <p className="text-xs text-slate-400">
            Verarbeitet je 10 Leads pro API-Batch. &quot;Fehlgeschlagene zurücksetzen&quot; löscht Placeholder-Einträge damit alle Leads nochmals versucht werden.
          </p>
        </CardContent>
      </Card>

      {/* Contact Backfill Tool */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-blue-500" />
            Kontakte rückwirkend auffüllen
          </CardTitle>
          <CardDescription>
            Führt die Kontaktsuche (Apollo → Impressum → Hunter → Firecrawl) für alle Leads ohne Kontakte durch
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Counter */}
          {contactBackfillMissing !== null && (
            <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
              <div className="text-sm">
                <span className="font-medium text-slate-900">{contactBackfillMissing}</span>
                <span className="text-slate-500"> genehmigte Leads ohne Kontaktdaten</span>
              </div>
              {contactBackfillMissing === 0 && <CheckCircle2 className="h-4 w-4 text-green-500" />}
            </div>
          )}

          {/* Live progress */}
          {contactBackfillProgress && (
            <div className={`rounded-lg border px-4 py-3 text-sm space-y-1 ${
              contactBackfillDone ? "bg-green-50 border-green-200 text-green-700" : "bg-blue-50 border-blue-200 text-blue-700"
            }`}>
              <div className="flex items-center gap-2">
                {contactBackfillDone
                  ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                  : <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
                <span className="font-medium">
                  {contactBackfillDone ? "Abgeschlossen" : "Läuft…"}
                </span>
              </div>
              <div className="flex gap-4 text-xs pl-6">
                <span>Verarbeitet: <strong>{contactBackfillProgress.processed}</strong></span>
                <span>Gefunden: <strong>{contactBackfillProgress.found}</strong></span>
                {!contactBackfillDone && contactBackfillProgress.remaining > 0 && (
                  <span>Verbleibend: <strong>{contactBackfillProgress.remaining}</strong></span>
                )}
              </div>
              {/* Progress bar */}
              {!contactBackfillDone && contactBackfillMissing !== null && contactBackfillMissing > 0 && (
                <div className="mt-2 h-1.5 bg-blue-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.round((contactBackfillProgress.processed / contactBackfillMissing) * 100))}%` }}
                  />
                </div>
              )}
            </div>
          )}

          <Button
            onClick={handleContactBackfill}
            disabled={contactBackfillRunning || contactBackfillMissing === 0}
            className="gap-2"
          >
            {contactBackfillRunning ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Läuft… {contactBackfillProgress ? `(${contactBackfillProgress.processed} verarbeitet)` : ""}</>
            ) : (
              <><Users className="h-4 w-4" /> Jetzt auffüllen ({contactBackfillMissing ?? "…"} Leads)</>
            )}
          </Button>
          <p className="text-xs text-slate-400">
            Verarbeitet 20 Leads pro Batch. Läuft automatisch bis alle Leads abgearbeitet sind.
            Hunter.io-Credits werden nur verbraucht wenn Scraper nichts findet.
          </p>
        </CardContent>
      </Card>

      {/* Solar Detection Backfill (OSM) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ScanSearch className="h-5 w-5 text-green-600" />
            Bestehende Solar-Anlagen erkennen (OpenStreetMap)
          </CardTitle>
          <CardDescription>
            Prüft alle Leads via OpenStreetMap ob bereits eine Solar-Anlage auf dem Dach eingetragen ist.
            Erkannte Leads werden automatisch als &quot;Bereits Solar vorhanden&quot; markiert und aus Kampagnen ausgeschlossen.
            Kostenlos, kein API-Kontingent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {solarDetectionTotal !== null && (
            <div className="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
              <div className="text-sm">
                <span className="font-medium text-slate-900">{solarDetectionTotal}</span>
                <span className="text-slate-500"> Leads noch nicht als Solar markiert</span>
              </div>
              {solarDetectionTotal === 0 && <CheckCircle2 className="h-4 w-4 text-green-500" />}
            </div>
          )}

          {solarDetectionProgress && (
            <div className={`rounded-lg border px-4 py-3 text-sm space-y-1 ${
              solarDetectionDone ? "bg-green-50 border-green-200 text-green-700" : "bg-blue-50 border-blue-200 text-blue-700"
            }`}>
              <div className="flex items-center gap-2">
                {solarDetectionDone
                  ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                  : <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
                <span className="font-medium">
                  {solarDetectionDone ? "Abgeschlossen" : "Läuft…"}
                </span>
              </div>
              <div className="flex gap-4 text-xs pl-6">
                <span>Geprüft: <strong>{solarDetectionProgress.processed}</strong></span>
                <span>☀️ Erkannt: <strong>{solarDetectionProgress.detected}</strong></span>
                {!solarDetectionDone && solarDetectionProgress.remaining > 0 && (
                  <span>Verbleibend: <strong>{solarDetectionProgress.remaining}</strong></span>
                )}
              </div>
              {!solarDetectionDone && solarDetectionTotal !== null && solarDetectionTotal > 0 && (
                <div className="mt-2 h-1.5 bg-blue-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (solarDetectionProgress.processed /
                            Math.max(solarDetectionTotal, 1)) *
                            100
                        )
                      )}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}

          <Button
            onClick={async () => {
              setSolarDetectionRunning(true);
              setSolarDetectionDone(false);
              setSolarDetectionProgress(null);
              let offset = 0;
              let totalProcessed = 0;
              let totalDetected = 0;

              try {
                while (true) {
                  const res = await fetch("/api/admin/tools/solar-detection-backfill", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ offset, limit: 20 }),
                  });
                  const data = await res.json();
                  if (!res.ok) break;

                  totalProcessed += data.processed ?? 0;
                  totalDetected += data.detected ?? 0;
                  offset = data.nextOffset ?? offset + 20;

                  setSolarDetectionProgress({
                    processed: totalProcessed,
                    detected: totalDetected,
                    remaining: data.remaining ?? 0,
                  });

                  // Done when no more leads returned
                  if ((data.processed ?? 0) === 0 || (data.remaining ?? 0) === 0) break;

                  // Small pause between batches (Overpass is a public service)
                  await new Promise((r) => setTimeout(r, 500));
                }
                setSolarDetectionDone(true);
                const status = await fetch("/api/admin/tools/solar-detection-backfill").then((r) => r.json());
                setSolarDetectionTotal(status.total ?? 0);
              } catch {
                // keep progress shown
              } finally {
                setSolarDetectionRunning(false);
              }
            }}
            disabled={solarDetectionRunning || solarDetectionTotal === 0}
            className="gap-2 bg-green-700 hover:bg-green-800 text-white"
          >
            {solarDetectionRunning ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Prüfe… ({solarDetectionProgress?.processed ?? 0} geprüft)</>
            ) : (
              <><ScanSearch className="h-4 w-4" /> Solar-Erkennung starten ({solarDetectionTotal ?? "…"} Leads)</>
            )}
          </Button>
          <p className="text-xs text-slate-400">
            Nutzt OpenStreetMap — kostenlos, kein API-Limit. Ca. 20 Leads/Minute (Pause zwischen Anfragen).
            Neue Leads werden ab sofort automatisch beim Anreichern geprüft.
          </p>
        </CardContent>
      </Card>

      {/* MaStR Backfill (Stufe 3) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-blue-600" />
            MaStR Backfill — Komplettabgleich (einmalig)
          </CardTitle>
          <CardDescription>
            Lädt den Marktstammdatenregister-Datensatz (~500 MB) direkt auf dem Server herunter und
            gleicht alle Leads gegen 3+ Mio. registrierte Solar-Anlagen ab. Deutlich vollständiger als OSM.
            Einmalig ausführen, danach ist die Datenbank bereinigt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">

          {/* URL-Eingabe (optional) */}
          <div className="space-y-1.5">
            <Label htmlFor="mastr-url" className="text-sm font-medium">
              Download-URL{" "}
              <span className="font-normal text-slate-400">(optional — wird automatisch erkannt)</span>
            </Label>
            <Input
              id="mastr-url"
              placeholder="https://download.marktstammdatenregister.de/Gesamtdatenexport_….zip"
              value={mastrUrl}
              onChange={(e) => setMastrUrl(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-xs text-slate-400">
              Von{" "}
              <a href="https://www.marktstammdatenregister.de/MaStR/Datendownload" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                marktstammdatenregister.de/MaStR/Datendownload
              </a>
              {" "}→ „Gesamtdatenexport" — oder leer lassen für Auto-Erkennung.
            </p>
          </div>

          {/* Job-Status */}
          {mastrJob && mastrJob.status !== "idle" && (
            <div className={`rounded-lg border px-4 py-3 text-sm space-y-2 ${
              mastrJob.status === "error"
                ? "bg-red-50 border-red-200 text-red-700"
                : mastrJob.status === "done"
                ? "bg-green-50 border-green-200 text-green-700"
                : "bg-blue-50 border-blue-200 text-blue-700"
            }`}>
              <div className="flex items-center gap-2">
                {mastrJob.status === "done"
                  ? <CheckCircle2 className="h-4 w-4 shrink-0" />
                  : mastrJob.status === "error"
                  ? <AlertCircle className="h-4 w-4 shrink-0" />
                  : <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
                <span className="font-medium text-sm">{mastrJob.message}</span>
              </div>

              {/* Fortschritts-Details */}
              {["downloading", "parsing", "matching", "updating"].includes(mastrJob.status) && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs pl-6 text-blue-600">
                  {mastrJob.downloadedMB > 0 && (
                    <span>Download: <strong>{mastrJob.downloadedMB} MB</strong></span>
                  )}
                  {mastrJob.parsedUnits > 0 && (
                    <span>MaStR-Einheiten: <strong>{mastrJob.parsedUnits.toLocaleString("de")}</strong></span>
                  )}
                  {mastrJob.leadsTotal > 0 && (
                    <span>Leads geprüft: <strong>{mastrJob.leadsChecked}/{mastrJob.leadsTotal}</strong></span>
                  )}
                  {mastrJob.matchesFound > 0 && (
                    <span>☀️ Treffer: <strong>{mastrJob.matchesFound}</strong></span>
                  )}
                </div>
              )}

              {/* Abschluss-Zusammenfassung */}
              {mastrJob.status === "done" && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs pl-6">
                  <span>MaStR-Einheiten: <strong>{mastrJob.parsedUnits.toLocaleString("de")}</strong></span>
                  <span>Leads geprüft: <strong>{mastrJob.leadsTotal}</strong></span>
                  <span>☀️ Neu markiert: <strong>{mastrJob.updatedCount}</strong></span>
                </div>
              )}

              {/* Fortschrittsbalken */}
              {mastrJob.status === "matching" && mastrJob.leadsTotal > 0 && (
                <div className="mt-1 h-1.5 bg-blue-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.round((mastrJob.leadsChecked / mastrJob.leadsTotal) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            {/* wget-Download + Verarbeitung (alles auf dem Server) */}
            <Button
              onClick={async () => {
                try {
                  const res = await fetch("/api/admin/tools/mastr-backfill", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "wget", url: mastrUrl.trim() || undefined }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    setMastrJob({ status: "error", message: data.error ?? "Fehler", downloadedMB: 0, totalMB: 0, parsedUnits: 0, leadsTotal: 0, leadsChecked: 0, matchesFound: 0, updatedCount: 0, error: data.error });
                    return;
                  }
                  setMastrPolling(true);
                } catch {
                  setMastrJob({ status: "error", message: "Netzwerkfehler", downloadedMB: 0, totalMB: 0, parsedUnits: 0, leadsTotal: 0, leadsChecked: 0, matchesFound: 0, updatedCount: 0, error: "Netzwerkfehler" });
                }
              }}
              disabled={mastrPolling}
              className="gap-2 bg-blue-700 hover:bg-blue-800 text-white"
            >
              {mastrPolling && (mastrJob?.status === "wget_download" || mastrJob?.status === "fetching_url")
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Lade herunter…</>
                : <><Database className="h-4 w-4" /> Auf Server herunterladen &amp; verarbeiten</>}
            </Button>

            {/* Nur verarbeiten (wenn ZIP bereits per SCP vorhanden) */}
            <Button
              variant="outline"
              onClick={async () => {
                const p = mastrUrl.trim() || "/tmp/mastr.zip";
                try {
                  const res = await fetch("/api/admin/tools/mastr-backfill", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ localPath: p }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    setMastrJob({ status: "error", message: data.error ?? "Fehler", downloadedMB: 0, totalMB: 0, parsedUnits: 0, leadsTotal: 0, leadsChecked: 0, matchesFound: 0, updatedCount: 0, error: data.error });
                    return;
                  }
                  setMastrPolling(true);
                } catch {
                  setMastrJob({ status: "error", message: "Netzwerkfehler", downloadedMB: 0, totalMB: 0, parsedUnits: 0, leadsTotal: 0, leadsChecked: 0, matchesFound: 0, updatedCount: 0, error: "Netzwerkfehler" });
                }
              }}
              disabled={mastrPolling}
              className="gap-2"
            >
              Nur verarbeiten (ZIP bereits auf Server)
            </Button>
          </div>

          <p className="text-xs text-slate-400">
            <strong>„Herunterladen &amp; verarbeiten"</strong> lädt via wget direkt auf dem Server (~2 GB, dauert je nach Serverleitung).
            Seite kann geschlossen werden — Job läuft weiter. Status wird beim Wiederkehren automatisch geladen.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
