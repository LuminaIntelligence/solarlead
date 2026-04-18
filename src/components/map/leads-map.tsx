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

interface LeadsMapProps {
  leads: MapLead[];
}

const STATUS_LABELS: Record<string, string> = {
  new: "Neu",
  reviewed: "Geprüft",
  contacted: "Kontaktiert",
  qualified: "Qualifiziert",
  rejected: "Abgelehnt",
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
};

function scoreToColor(score: number): string {
  if (score >= 75) return "#16a34a"; // green-600
  if (score >= 55) return "#ca8a04"; // yellow-600
  return "#dc2626";                  // red-600
}

function makePinSvg(color: string, score: number): string {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.25"/>
      </filter>
      <path filter="url(#shadow)" fill="${color}" stroke="white" stroke-width="1.5"
        d="M18 2C10.268 2 4 8.268 4 16c0 10 14 26 14 26s14-16 14-26C32 8.268 25.732 2 18 2z"/>
      <circle cx="18" cy="16" r="9" fill="white" opacity="0.95"/>
      <text x="18" y="20.5" text-anchor="middle" font-size="9.5" font-weight="700"
        font-family="system-ui,sans-serif" fill="${color}">${score}</text>
    </svg>
  `.trim();
}

export function LeadsMap({ leads }: LeadsMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Dynamic import to avoid SSR issues
    import("leaflet").then((L) => {
      if (!mapRef.current || mapInstanceRef.current) return;

      // Fix default icon paths
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      // Center on Germany if no leads, else fit bounds
      const map = L.map(mapRef.current!, {
        center: [51.1657, 10.4515],
        zoom: 6,
        zoomControl: true,
      });

      mapInstanceRef.current = map;

      // OpenStreetMap tiles
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      if (leads.length === 0) return;

      const bounds: [number, number][] = [];

      leads.forEach((lead) => {
        const color = scoreToColor(lead.total_score);
        const svg = makePinSvg(color, lead.total_score);

        const icon = L.divIcon({
          html: svg,
          className: "",
          iconSize: [36, 44],
          iconAnchor: [18, 44],
          popupAnchor: [0, -44],
        });

        const statusLabel = STATUS_LABELS[lead.status] ?? lead.status;
        const categoryLabel = CATEGORY_LABELS[lead.category] ?? lead.category;

        const popup = L.popup({ maxWidth: 260, className: "leads-map-popup" }).setContent(`
          <div style="font-family:system-ui,sans-serif;min-width:200px;">
            <div style="font-weight:700;font-size:14px;margin-bottom:4px;color:#0f172a;line-height:1.3;">
              ${lead.company_name}
            </div>
            <div style="font-size:12px;color:#64748b;margin-bottom:8px;">
              ${categoryLabel} · ${lead.city}
            </div>
            <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
              <span style="background:${color};color:white;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700;">
                Score ${lead.total_score}
              </span>
              <span style="background:#f1f5f9;color:#475569;border-radius:6px;padding:2px 8px;font-size:11px;">
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
          .addTo(map)
          .bindPopup(popup);

        bounds.push([lead.latitude, lead.longitude]);
      });

      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      }
    });

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update markers when leads change — handled via full remount
  return (
    <div ref={mapRef} className="w-full h-full rounded-lg" />
  );
}
