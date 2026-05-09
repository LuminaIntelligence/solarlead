"use client";

import { useEffect, useState, useCallback } from "react";
import {
  FlaskConical, Loader2, Plus, Trash2, AlertTriangle,
  CheckCircle2, Mail, MousePointer, Eye, ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";

interface TestRun {
  id: string;
  name: string;
  status: string;
  created_at: string;
  stats: {
    total: number;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    replied: number;
    bounced: number;
  };
}

interface SeedResult {
  batchId: string;
  batchName: string;
  leadsCreated: number;
  jobsCreated: number;
  specialistEmails: string[];
  specialistPassword: string;
}

export default function TestModePage() {
  const { toast } = useToast();
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [count, setCount] = useState(30);
  const [confirmReset, setConfirmReset] = useState<{ batchId: string | null; name?: string } | null>(null);
  const [resetting, setResetting] = useState(false);
  const [lastSeed, setLastSeed] = useState<SeedResult | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/test/runs");
      if (res.ok) {
        const data = await res.json();
        setRuns(data.runs ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRuns();
    const t = setInterval(loadRuns, 15000);
    return () => clearInterval(t);
  }, [loadRuns]);

  async function handleSeed() {
    setSeeding(true);
    try {
      const res = await fetch("/api/admin/test/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Seed fehlgeschlagen", description: data.error, variant: "destructive" });
        return;
      }
      setLastSeed(data);
      toast({
        title: "Test-Run erstellt",
        description: `${data.jobsCreated} Jobs in "${data.batchName}"`,
      });
      await loadRuns();
    } catch (err) {
      toast({
        title: "Seed fehlgeschlagen",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setSeeding(false);
    }
  }

  async function handleReset() {
    if (!confirmReset) return;
    setResetting(true);
    try {
      const res = await fetch("/api/admin/test/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: confirmReset.batchId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Reset fehlgeschlagen", description: data.error, variant: "destructive" });
        return;
      }
      const total = Object.values(data.deleted as Record<string, number>).reduce((a, b) => a + b, 0);
      toast({
        title: confirmReset.batchId ? "Test-Run gelöscht" : "Alle Test-Daten gelöscht",
        description: `${total} Records entfernt`,
      });
      await loadRuns();
      setConfirmReset(null);
    } catch (err) {
      toast({
        title: "Reset fehlgeschlagen",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <FlaskConical className="h-7 w-7 text-amber-600" />
            Test-Modus
          </h1>
          <p className="text-muted-foreground mt-1">
            Erstellt Fake-Leads zum Testen der Outreach-Pipeline. Alle E-Mails gehen an
            <code className="mx-1 bg-slate-100 px-1.5 py-0.5 rounded text-xs">alphaN@lumina-intelligence.ai</code>
            (1-30). Test-Daten sind via <code className="bg-slate-100 px-1 rounded text-xs">[TEST]</code>-Präfix
            erkennbar und vom echten Geschäft isoliert.
          </p>
        </div>
      </div>

      {/* Seed-Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Plus className="h-5 w-5 text-green-600" />
            Neuen Test-Run erstellen
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Anzahl Test-Leads
              </label>
              <input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Math.min(Math.max(parseInt(e.target.value) || 30, 1), 100))}
                className="w-24 border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <Button onClick={handleSeed} disabled={seeding}>
              {seeding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              {seeding ? "Erstelle..." : "Seed Test-Run"}
            </Button>
          </div>
          <p className="text-xs text-slate-500">
            Erstellt 1 Outreach-Batch in <code className="bg-slate-100 px-1 rounded">draft</code>, N Leads,
            N Outreach-Jobs in <code className="bg-slate-100 px-1 rounded">pending</code>, plus 2 Reply-Specialists
            (idempotent — werden bei Re-Seed wiederverwendet). Nach dem Seed: zur Outreach-Übersicht navigieren
            und den Batch aktivieren — dann gehen die Mails über Mailgun raus.
          </p>
        </CardContent>
      </Card>

      {/* Last seed info — Specialist-Credentials */}
      {lastSeed && (
        <Card className="bg-blue-50 border-blue-200">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-blue-900">
              <CheckCircle2 className="h-5 w-5" />
              Letzter Seed: {lastSeed.batchName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="font-semibold text-blue-900 mb-1">Reply-Specialists (eingeloggt testen mit):</div>
              <div className="bg-white rounded p-3 border border-blue-200 font-mono text-xs space-y-1">
                {lastSeed.specialistEmails.map((email) => (
                  <div key={email}>{email}</div>
                ))}
                <div className="text-slate-600 mt-2">
                  Passwort: <span className="font-semibold">{lastSeed.specialistPassword}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <a
                href={`/admin/outreach`}
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
              >
                Zur Outreach-Übersicht <ArrowRight className="h-3.5 w-3.5" />
              </a>
              <span className="text-slate-400">·</span>
              <span className="text-slate-600 text-xs">
                {lastSeed.jobsCreated}/{lastSeed.leadsCreated} Jobs/Leads erstellt
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Test-Runs Tabelle */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Vergangene Test-Runs ({runs.length})</CardTitle>
          {runs.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmReset({ batchId: null })}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Alle Test-Daten löschen
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : runs.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Noch keine Test-Runs erstellt.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-xs">
                    <th className="px-4 py-2 font-medium">Run</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium text-center">Total</th>
                    <th className="px-3 py-2 font-medium text-center">Sent</th>
                    <th className="px-3 py-2 font-medium text-center">
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Delivered
                      </span>
                    </th>
                    <th className="px-3 py-2 font-medium text-center">
                      <span className="inline-flex items-center gap-1">
                        <Eye className="h-3 w-3" /> Opened
                      </span>
                    </th>
                    <th className="px-3 py-2 font-medium text-center">
                      <span className="inline-flex items-center gap-1">
                        <MousePointer className="h-3 w-3" /> Clicked
                      </span>
                    </th>
                    <th className="px-3 py-2 font-medium text-center">
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" /> Replied
                      </span>
                    </th>
                    <th className="px-3 py-2 font-medium text-center">Bounced</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const pct = (n: number) => r.stats.sent > 0 ? `${Math.round((n / r.stats.sent) * 100)}%` : "—";
                    return (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-slate-900">{r.name}</div>
                          <div className="text-xs text-slate-500">
                            {new Date(r.created_at).toLocaleString("de-DE", {
                              day: "2-digit", month: "2-digit", year: "numeric",
                              hour: "2-digit", minute: "2-digit",
                            })}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge variant="secondary" className={
                            r.status === "draft" ? "bg-slate-100" :
                            r.status === "running" ? "bg-blue-100 text-blue-800" :
                            r.status === "completed" ? "bg-green-100 text-green-800" :
                            "bg-slate-100"
                          }>
                            {r.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-center text-slate-600">{r.stats.total}</td>
                        <td className="px-3 py-2.5 text-center">{r.stats.sent}</td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="text-slate-900">{r.stats.delivered}</div>
                          <div className="text-[10px] text-slate-400">{pct(r.stats.delivered)}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="text-blue-700 font-medium">{r.stats.opened}</div>
                          <div className="text-[10px] text-slate-400">{pct(r.stats.opened)}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="text-purple-700 font-medium">{r.stats.clicked}</div>
                          <div className="text-[10px] text-slate-400">{pct(r.stats.clicked)}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <div className="text-green-700 font-medium">{r.stats.replied}</div>
                          <div className="text-[10px] text-slate-400">{pct(r.stats.replied)}</div>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {r.stats.bounced > 0 ? (
                            <span className="text-red-600 font-medium">{r.stats.bounced}</span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirmReset({ batchId: r.id, name: r.name })}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
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

      {/* Reset-Bestätigung */}
      <Dialog open={!!confirmReset} onOpenChange={(o) => !o && setConfirmReset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
              {confirmReset?.batchId ? "Test-Run löschen" : "Alle Test-Daten löschen"}
            </DialogTitle>
            <DialogDescription>
              {confirmReset?.batchId ? (
                <>
                  Soll der Run <strong>{confirmReset.name}</strong> mit allen Leads, Jobs,
                  Solar-Assessments und Activities gelöscht werden? Echte Geschäfts-Daten bleiben unberührt.
                </>
              ) : (
                <>
                  Löscht <strong>alle</strong> Test-Daten (alle Test-Batches, Leads, Jobs, Activities,
                  Solar-Assessments, Test-Specialists). Echte Geschäfts-Daten bleiben unberührt.
                  Diese Aktion kann nicht rückgängig gemacht werden.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(null)} disabled={resetting}>
              Abbrechen
            </Button>
            <Button variant="destructive" onClick={handleReset} disabled={resetting}>
              {resetting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {confirmReset?.batchId ? "Run löschen" : "Alle löschen"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
