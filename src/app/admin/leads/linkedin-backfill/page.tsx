"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  Linkedin, Loader2, Search, CheckCircle2, AlertCircle, XCircle,
  ExternalLink, Play, RotateCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";

interface BackfillResult {
  lead_id: string;
  company_name: string;
  mode: "A" | "B" | null;
  status: string;
  message?: string;
  profile?: {
    url: string;
    name: string | null;
    title: string | null;
    snippet: string;
    confidence: number;
  } | null;
  contact_id?: string;
}

interface RunResponse {
  ok: boolean;
  processed: number;
  api_calls: number;
  remaining: number;
  results: BackfillResult[];
  summary: {
    auto_applied: number;
    review: number;
    no_result: number;
    errors: number;
    quota_exceeded: number;
  };
}

const STATUS_META: Record<
  string,
  { label: string; color: string; icon: typeof CheckCircle2 }
> = {
  auto_applied:   { label: "Übernommen",   color: "bg-green-100 text-green-800",  icon: CheckCircle2 },
  review:         { label: "Prüfen",       color: "bg-amber-100 text-amber-800",  icon: AlertCircle },
  no_result:      { label: "Kein Treffer", color: "bg-slate-100 text-slate-600",  icon: XCircle },
  skipped:        { label: "Übersprungen", color: "bg-slate-100 text-slate-600",  icon: XCircle },
  error:          { label: "Fehler",       color: "bg-red-100 text-red-800",      icon: XCircle },
  quota_exceeded: { label: "Quota voll",   color: "bg-red-100 text-red-800",      icon: AlertCircle },
};

export default function LinkedInBackfillPage() {
  const { toast } = useToast();
  const [minScore, setMinScore] = useState(80);
  const [maxScore, setMaxScore] = useState(100);
  const [limit, setLimit] = useState(20);
  const [autoThreshold, setAutoThreshold] = useState(0.7);

  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BackfillResult[]>([]);
  const [lastRun, setLastRun] = useState<RunResponse | null>(null);
  const [continueMode, setContinueMode] = useState(false);

  async function runOnce() {
    setRunning(true);
    try {
      const res = await fetch("/api/admin/leads/linkedin-backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          min_score: minScore,
          max_score: maxScore,
          limit,
          auto_apply_threshold: autoThreshold,
        }),
      });
      const raw: Partial<RunResponse> & { error?: string } = await res.json();
      if (!res.ok) {
        toast({ title: "Fehler", description: raw.error, variant: "destructive" });
        setContinueMode(false);
        return null;
      }
      // Defensive: API könnte (in Edge-Cases) ohne summary kommen — defaulten
      const d: RunResponse = {
        ok: raw.ok ?? true,
        processed: raw.processed ?? 0,
        api_calls: raw.api_calls ?? 0,
        remaining: raw.remaining ?? 0,
        results: raw.results ?? [],
        summary: {
          auto_applied: raw.summary?.auto_applied ?? 0,
          review: raw.summary?.review ?? 0,
          no_result: raw.summary?.no_result ?? 0,
          errors: raw.summary?.errors ?? 0,
          quota_exceeded: raw.summary?.quota_exceeded ?? 0,
        },
      };
      setLastRun(d);
      setResults((prev) => [...d.results, ...prev]);
      toast({
        title: `${d.processed} Leads verarbeitet · ${d.api_calls} Calls`,
        description: `Auto: ${d.summary.auto_applied} · Review: ${d.summary.review} · Kein Treffer: ${d.summary.no_result}`,
      });
      return d;
    } catch (err) {
      toast({
        title: "Netzwerk-Fehler",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
      return null;
    } finally {
      setRunning(false);
    }
  }

  async function runUntilDone() {
    setContinueMode(true);
    setResults([]);
    let safety = 50; // max 50 Chunks (= 2500 Leads bei limit=50)
    while (safety-- > 0) {
      const d = await runOnce();
      if (!d) break;
      if (d.remaining === 0) {
        toast({ title: "Alle Leads im Range durch", description: `Verbleibend: 0` });
        break;
      }
      if (d.summary.quota_exceeded > 0) {
        toast({
          title: "Google CSE Quota erschöpft",
          description: "Stoppe — morgen ist neue Quota verfügbar.",
          variant: "destructive",
        });
        break;
      }
      // kleine Pause damit der Server atmet
      await new Promise((r) => setTimeout(r, 500));
    }
    setContinueMode(false);
  }

  async function confirmContact(
    contactId: string,
    linkedinUrl: string | null,
    accept: boolean
  ) {
    const res = await fetch("/api/admin/leads/linkedin-backfill/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact_id: contactId,
        linkedin_url: linkedinUrl,
        accept,
        delete_contact: !accept,
      }),
    });
    if (res.ok) {
      // aus der UI entfernen
      setResults((prev) => prev.filter((r) => r.contact_id !== contactId));
      toast({ title: accept ? "Übernommen" : "Verworfen" });
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Linkedin className="h-7 w-7 text-blue-700" />
          LinkedIn-URL-Finder
        </h1>
        <p className="text-slate-500 text-sm mt-1">
          Sucht über Google die LinkedIn-Profile zu deinen Leads. Modus A: vorhandene
          Personen, finde URL. Modus B: nur generischer Kontakt, finde Entscheidungsträger.
        </p>
      </div>

      {/* Filter-Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Such-Parameter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Score min
              </label>
              <input
                type="number"
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                min={0}
                max={100}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Score max
              </label>
              <input
                type="number"
                value={maxScore}
                onChange={(e) => setMaxScore(Number(e.target.value))}
                min={0}
                max={100}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Leads pro Chunk
              </label>
              <input
                type="number"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                min={1}
                max={100}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Auto-Apply ab Confidence
              </label>
              <input
                type="number"
                value={autoThreshold}
                onChange={(e) => setAutoThreshold(Number(e.target.value))}
                min={0.4}
                max={1}
                step={0.05}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Empfehlung: Tier 1 = Score 80-100, alle ~250 Leads in einem Rutsch (kostet ~$1).
            Auto-Apply-Threshold 0.7 ist konservativ — Treffer mit klarem Slug-Match + Firmen-Snippet kommen leicht über 0.7.
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={runOnce} disabled={running || continueMode}>
              {running ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Einmal-Chunk starten ({limit} Leads)
            </Button>
            <Button
              onClick={runUntilDone}
              disabled={running || continueMode}
              variant="default"
            >
              {continueMode ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4 mr-2" />
              )}
              Bis alle durch (Score-Range)
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Last-Run Summary */}
      {lastRun && (
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="py-3 px-4 flex items-center gap-4 flex-wrap text-sm">
            <span className="font-medium text-blue-900">Letzter Chunk:</span>
            <span>📊 {lastRun.processed} Leads · {lastRun.api_calls} Calls</span>
            <span className="text-green-700">✓ {lastRun.summary.auto_applied} auto</span>
            <span className="text-amber-700">⚠ {lastRun.summary.review} review</span>
            <span className="text-slate-600">○ {lastRun.summary.no_result} kein Treffer</span>
            {lastRun.summary.errors > 0 && (
              <span className="text-red-700">✗ {lastRun.summary.errors} Fehler</span>
            )}
            <span className="ml-auto text-slate-500">
              Verbleibend im Range: <strong>{lastRun.remaining}</strong>
            </span>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resultate ({results.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-xs">
                    <th className="px-4 py-2 font-medium">Firma</th>
                    <th className="px-3 py-2 font-medium">Mode</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Treffer</th>
                    <th className="px-3 py-2 font-medium text-center">Confid.</th>
                    <th className="px-3 py-2 font-medium">Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => {
                    const meta = STATUS_META[r.status] ?? STATUS_META.no_result;
                    const Icon = meta.icon;
                    return (
                      <tr
                        key={`${r.lead_id}-${i}`}
                        className="border-b last:border-0 hover:bg-slate-50"
                      >
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900 truncate max-w-[220px]">
                            {r.company_name}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-slate-600">
                          {r.mode ?? "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge variant="secondary" className={meta.color}>
                            <Icon className="h-3 w-3 mr-1 inline" /> {meta.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          {r.profile ? (
                            <div className="space-y-0.5">
                              <div className="text-slate-900 truncate max-w-[220px]">
                                {r.profile.name ?? "—"}
                                {r.profile.title && (
                                  <span className="text-slate-500 text-xs">
                                    {" · "}{r.profile.title}
                                  </span>
                                )}
                              </div>
                              <a
                                href={r.profile.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1"
                              >
                                <ExternalLink className="h-3 w-3" />
                                {r.profile.url.replace(/^https?:\/\//, "").slice(0, 50)}
                              </a>
                            </div>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                          {r.message && (
                            <div className="text-xs text-red-600 mt-0.5">
                              {r.message}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {r.profile && (
                            <span
                              className={`text-xs font-medium ${
                                r.profile.confidence >= 0.7
                                  ? "text-green-700"
                                  : r.profile.confidence >= 0.4
                                  ? "text-amber-700"
                                  : "text-slate-500"
                              }`}
                            >
                              {(r.profile.confidence * 100).toFixed(0)}%
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {r.status === "review" && r.contact_id && r.profile && (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  confirmContact(r.contact_id!, r.profile!.url, true)
                                }
                                className="h-7 text-xs"
                              >
                                <CheckCircle2 className="h-3 w-3 mr-1" /> Übernehmen
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  confirmContact(r.contact_id!, null, false)
                                }
                                className="h-7 text-xs text-red-600 hover:bg-red-50"
                              >
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
