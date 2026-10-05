"use client";

import { useEffect, useRef } from "react";

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

export type ColorMode = "score" | "pipeline";

interface LeadsMapProps {
  leads: MapLead[];
  colorMode?: ColorMode;
  hiddenStatuses?: Set<string>;
}

export const STATUS_LABELS: Record<string, string> = {
  new: "Neu",
  reviewed: "Geprüft",
  contacted: "Kontaktiert",
  follow_up: "Wiedervorlage",
  qualified: "Qualifiziert",
  rejected: "Abgelehnt",
};

export const STATUS_HEX: Record<string, string> = {
  new: "#2563eb",       // blue-600
  reviewed: "#ca8a04",  // yellow-600
  contacted: "#9333ea", // purple-600
  follow_up: "#ea580c", // orange-600
  qualified: "#16a34a", // green-600
  rejected: "#dc2626",  // red-600
};

const CATEGORY_LABELS: Record<string, string> = {
  logistics: "Logistik",
  warehouse: "Lager",
  cold_storage: "Kühlhaus",
  supermarket: "Supermarkt",
  food_production: "Lebensmittelproduktion",
  manufacturing: "Fertigung",
  metalworking: "Metallverarbeitung",
  car_dealership: "Autohaus",
  hotel: "Hotel",
  furniture_store: "Möbelhaus",
  hardware_store: "Baumarkt",
  shopping_center: "Einkaufszentrum",
  workshop: "Werkstatt",
  senior_home: "Seniorenheim",
};

function scoreToColor(score: number): string {
  if (score >= 75) return "#16a34a"; // green-600
  if (score >= 55) return "#ca8a04"; // yellow-600
  return "#dc2626";                  // red-600
}

function makePinSvg(color: string, label: string): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.25"/>
      </filter>
      <path filter="url(#shadow)" fill="${color}" stroke="white" stroke-width="1.5"
        d="M18 2C10.268 2 4 8.268 4 16c0 10 14 26 14 26s14-16 14-26C32 8.268 25.732 2 18 2z"/>
      <circle cx="18" cy="16" r="9" fill="white" opacity="0.95"/>
      <text x="18" y="20.5" text-anchor="middle" font-size="9.5" font-weight="700"
        font-family="system-ui,sans-serif" fill="${color}">${label}</text>
    </svg>
  `.trim();
}

export function LeadsMap({ leads, colorMode = "score", hiddenStatuses }: LeadsMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerLayerRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LRef = useRef<any>(null);

  // Initial setup — nur einmal die Map erstellen
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    import("leaflet").then((L) => {
      if (!mapRef.current || mapInstanceRef.current) return;
      LRef.current = L;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      const map = L.map(mapRef.current!, {
        center: [51.1657, 10.4515],
        zoom: 6,
        zoomControl: true,
      });

      mapInstanceRef.current = map;
      markerLayerRef.current = L.layerGroup().addTo(map);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerLayerRef.current = null;
      }
    };
  }, []);

  // Marker neu zeichnen bei Änderungen an leads / colorMode / hiddenStatuses
  useEffect(() => {
    const L = LRef.current;
    const map = mapInstanceRef.current;
    const layer = markerLayerRef.current;
    if (!L || !map || !layer) {
      // Noch nicht fertig initialisiert — warte und retry
      const timer = setTimeout(() => {
        if (LRef.current && mapInstanceRef.current && markerLayerRef.current) {
          drawMarkers();
        }
      }, 100);
      return () => clearTimeout(timer);
    }
    drawMarkers();

    function drawMarkers() {
      layer.clearLayers();
      const bounds: [number, number][] = [];

      const visibleLeads = leads.filter((l) =>
        !hiddenStatuses || !hiddenStatuses.has(l.status)
      );

      visibleLeads.forEach((lead) => {
        const color =
          colorMode === "pipeline"
            ? STATUS_HEX[lead.status] ?? "#64748b"
            : scoreToColor(lead.total_score);

        const label =
          colorMode === "pipeline"
            ? statusInitial(lead.status)
            : String(lead.total_score);

        const svg = makePinSvg(color, label);

        const icon = L.divIcon({
          html: svg,
          className: "",
          iconSize: [36, 44],
          iconAnchor: [18, 44],
          popupAnchor: [0, -44],
        });

        const statusLabel = STATUS_LABELS[lead.status] ?? lead.status;
        const categoryLabel = CATEGORY_LABELS[lead.category] ?? lead.category;
        const statusColor = STATUS_HEX[lead.status] ?? "#64748b";
        const scoreColor = scoreToColor(lead.total_score);

        const popup = L.popup({ maxWidth: 260, className: "leads-map-popup" }).setContent(`
          <div style="font-family:system-ui,sans-serif;min-width:200px;">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px;color:#0f172a;line-height:1.3;">
              ${lead.company_name}
            </div>
            <div style="font-size:12px;color:#64748b;margin-bottom:8px;">
              ${categoryLabel} · ${lead.city}
            </div>
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap;">
              <span style="background:${scoreColor};color:white;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700;">
                Score ${lead.total_score}
              </span>
              <span style="background:${statusColor};color:white;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:600;">
                ${statusLabel}
              </span>
            </div>
            <div style="font-size:11px;color:#94a3b8;margin-bottom:10px;">${lead.address ?? ""}</div>
            <a href="/dashboard/leads/${lead.id}"
               style="display:block;text-align:center;background:#16a34a;color:white;border-radius:6px;padding:6px 0;font-size:12px;font-weight:600;text-decoration:none;">
              Lead öffnen →
            </a>
          </div>
        `);

        L.marker([lead.latitude, lead.longitude], { icon })
          .addTo(layer)
          .bindPopup(popup);

        bounds.push([lead.latitude, lead.longitude]);
      });

      // Fit bounds nur beim ersten Zeichnen (wenn Map noch bei Deutschland-Default)
      const currentZoom = map.getZoom();
      if (bounds.length > 0 && currentZoom <= 6) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      }
    }
  }, [leads, colorMode, hiddenStatuses]);

  return <div ref={mapRef} className="w-full h-full rounded-lg" />;
}

function statusInitial(status: string): string {
  const map: Record<string, string> = {
    new: "N",
    reviewed: "G",
    contacted: "K",
    follow_up: "W",
    qualified: "Q",
    rejected: "A",
  };
  return map[status] ?? "?";
}
