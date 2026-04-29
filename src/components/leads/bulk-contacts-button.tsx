"use client";

import { useState, useEffect } from "react";
import { Users, Loader2, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";

interface BulkResult {
  processed: number;
  found: number;
  skipped: number;
  remaining: number;
}

export function BulkContactsButton() {
  const { toast } = useToast();
  const [pending, setPending] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ processed: 0, found: 0, skipped: 0 });

  useEffect(() => {
    fetch("/api/dashboard/contacts/backfill")
      .then((r) => r.json())
      .then((d: { pending: number }) => setPending(d.pending))
      .catch(() => setPending(null));
  }, []);

  async function handleStart() {
    if (pending === null || pending === 0) return;
    setRunning(true);
    setDone(false);
    setTotal(pending);
    setStats({ processed: 0, found: 0, skipped: 0 });
    setShowStats(true);

    let remaining = pending;
    let totalProcessed = 0;
    let totalFound = 0;
    let totalSkipped = 0;

    while (remaining > 0) {
      try {
        const res = await fetch("/api/dashboard/contacts/backfill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 10 }),
        });
        const data: BulkResult = await res.json();

        if (!res.ok || data.processed === 0) break;

        totalProcessed += data.processed;
        totalFound += data.found;
        totalSkipped += data.skipped;
        remaining = data.remaining;

        setStats({ processed: totalProcessed, found: totalFound, skipped: totalSkipped });
      } catch {
        toast({ title: "Fehler", description: "Verbindungsfehler beim Kontakt-Backfill", variant: "destructive" });
        break;
      }
    }

    setRunning(false);
    setDone(true);
    setPending(0);
    toast({
      title: "Kontaktsuche abgeschlossen",
      description: `${totalFound} Leads mit Kontakten gefunden, ${totalSkipped} ohne Treffer.`,
    });
  }

  // Nicht anzeigen wenn noch lädt oder keine offenen Leads
  if (pending === null) return null;
  if (pending === 0 && !done) return null;

  const progress = total > 0 ? Math.round((stats.processed / total) * 100) : 0;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {done ? (
          <Button variant="outline" size="sm" className="gap-2 text-green-700 border-green-300" disabled>
            <CheckCircle2 className="h-4 w-4" />
            Kontaktsuche abgeschlossen
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleStart}
            disabled={running}
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Users className="h-4 w-4" />
            )}
            {running
              ? `Kontakte suchen… (${stats.processed}/${total})`
              : `Kontakte suchen (${pending} Leads)`}
          </Button>
        )}

        {(running || done) && (
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setShowStats((s) => !s)}
          >
            {showStats ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      {showStats && (running || done) && (
        <div className="rounded-md border bg-muted/40 p-3 space-y-2 text-sm">
          {running && (
            <Progress value={progress} className="h-1.5" />
          )}
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span className="text-green-700 font-medium">✓ {stats.found} mit Kontakten</span>
            <span className="text-amber-600">⚠ {stats.skipped} ohne Treffer</span>
            <span>{stats.processed} / {total} verarbeitet</span>
          </div>
        </div>
      )}
    </div>
  );
}
