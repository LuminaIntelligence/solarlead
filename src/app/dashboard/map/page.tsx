"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { MapPin, Loader2, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Leaflet muss client-only geladen werden (kein SSR)
const LeadsMap = dynamic(
  () => import("@/components/map/leads-map").then((m) => m.LeadsMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
);

interface MapLead {
  id: string;
  company_name: string;
  category: string;
  city: string;
  address: string;
  latitude: number;
  longitude: number;
  total_score: number;
  solar_score: number;
  status: string;
}

export default function MapPage() {
  const [leads, setLeads] = useState<MapLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/leads/map")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setLeads(data);
        else setError("Leads konnten nicht geladen werden.");
      })
      .catch(() => setError("Verbindung fehlgeschlagen."))
      .finally(() => setLoading(false));
  }, []);

  const highCount = leads.filter((l) => l.total_score >= 75).length;
  const midCount = leads.filter((l) => l.total_score >= 55 && l.total_score < 75).length;
  const lowCount = leads.filter((l) => l.total_score < 55).length;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] gap-3 p-0 -m-8">
      {/* Header-Leiste */}
      <div className="flex items-center justify-between px-6 pt-5 pb-2 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <MapPin className="h-6 w-6 text-green-600" />
            Kartenansicht
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading ? "Lade Leads..." : `${leads.length} Leads mit Koordinaten`}
          </p>
        </div>

        {/* Legende */}
        {!loading && leads.length > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm">
              <span className="inline-block w-3 h-3 rounded-full bg-green-600" />
              <span className="text-muted-foreground">Hoch ({highCount})</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <span className="inline-block w-3 h-3 rounded-full bg-yellow-500" />
              <span className="text-muted-foreground">Mittel ({midCount})</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <span className="inline-block w-3 h-3 rounded-full bg-red-600" />
              <span className="text-muted-foreground">Niedrig ({lowCount})</span>
            </div>
            <Badge variant="outline" className="ml-2">{leads.length} gesamt</Badge>
          </div>
        )}
      </div>

      {/* Karte */}
      <div className="flex-1 px-6 pb-6 min-h-0">
        {loading ? (
          <div className="flex h-full items-center justify-center rounded-lg border bg-slate-50">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Leads werden geladen...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center rounded-lg border bg-red-50">
            <div className="text-center">
              <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          </div>
        ) : leads.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50">
            <div className="text-center">
              <MapPin className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-lg font-medium text-muted-foreground">Noch keine Leads mit Koordinaten</p>
              <p className="text-sm text-muted-foreground mt-1">
                Leads aus der Suche oder Adresssuche erhalten automatisch Koordinaten.
              </p>
            </div>
          </div>
        ) : (
          <div className="h-full rounded-lg overflow-hidden border shadow-sm">
            {/* Leaflet CSS */}
            <style>{`
              @import url("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");
              .leads-map-popup .leaflet-popup-content-wrapper {
                border-radius: 10px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                padding: 0;
              }
              .leads-map-popup .leaflet-popup-content {
                margin: 14px 14px;
              }
              .leads-map-popup .leaflet-popup-tip-container {
                margin-top: -1px;
              }
            `}</style>
            <LeadsMap leads={leads} />
          </div>
        )}
      </div>
    </div>
  );
}
