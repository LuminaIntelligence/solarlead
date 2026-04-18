"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff, Loader2, RotateCcw, Server, Settings } from "lucide-react";
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
    </div>
  );
}
