"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff, Loader2, RotateCcw, Server, Settings, Sun, CheckCircle2, AlertCircle, Users } from "lucide-react";
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

  // Backfill contacts tool
  const [contactBackfillMissing, setContactBackfillMissing] = useState<number | null>(null);
  const [contactBackfillRunning, setContactBackfillRunning] = useState(false);
  const [contactBackfillProgress, setContactBackfillProgress] = useState<{ processed: number; found: number; remaining: number } | null>(null);
  const [contactBackfillDone, setContactBackfillDone] = useState(false);

  useEffect(() => {
    fetch("/api/admin/tools/backfill-solar")
      .then((r) => r.json())
      .then(setBackfillStatus)
      .catch(() => {});
    fetch("/api/admin/tools/backfill-contacts")
      .then((r) => r.json())
      .then((d) => setContactBackfillMissing(d.missing ?? 0))
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
    </div>
  );
}
