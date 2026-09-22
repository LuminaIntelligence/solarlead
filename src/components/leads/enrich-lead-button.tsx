"use client";

/**
 * EnrichLeadButton — Website-Anreicherung on-demand für einen Lead.
 *
 * Ruft POST /api/enrich mit lead_id + website auf. Der Endpoint scraped
 * die Website via Firecrawl, extrahiert Titel, Meta-Description und
 * Schlüsselwörter, speichert das Ergebnis in `lead_enrichment` und
 * rechnet die Scores neu.
 *
 * UX:
 *   - Kein Button wenn keine Website hinterlegt
 *   - Loading-Spinner während des Requests (Firecrawl braucht 15–30s)
 *   - Success-Toast + router.refresh() damit die Anreicherungs-Tab-Card
 *     sofort die neuen Daten zeigt
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Search, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

interface Props {
  leadId: string;
  website: string | null;
  alreadyEnriched: boolean;
}

export function EnrichLeadButton({ leadId, website, alreadyEnriched }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!website) {
    return (
      <div className="text-sm text-slate-500 italic">
        Keine Website hinterlegt — bitte oben unter „Übersicht" ergänzen, dann
        Anreicherung möglich.
      </div>
    );
  }

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId, website }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: "Anreicherung fehlgeschlagen",
          description: data.error ?? `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }
      const kwCount = Array.isArray(data.enrichment?.detected_keywords)
        ? data.enrichment.detected_keywords.length
        : 0;
      toast({
        title: "Website angereichert",
        description: `Score ${data.scores?.total_score ?? "?"}/100 · ${kwCount} Schlüsselwörter erkannt`,
      });
      router.refresh();
    } catch (err) {
      toast({
        title: "Netzwerk-Fehler",
        description: err instanceof Error ? err.message : "",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleClick} disabled={loading} size="sm">
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
      ) : alreadyEnriched ? (
        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
      ) : (
        <Search className="h-3.5 w-3.5 mr-1.5" />
      )}
      {loading
        ? "Website wird gescraped…"
        : alreadyEnriched
        ? "Erneut anreichern"
        : "Jetzt anreichern"}
    </Button>
  );
}
