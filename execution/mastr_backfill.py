#!/usr/bin/env python3
"""
Stufe 3: MaStR Backfill — Rückwirkende Solar-Erkennung
=======================================================

Lädt alle Leads aus Supabase, vergleicht deren GPS-Koordinaten mit dem
Marktstammdatenregister (MaStR) und markiert alle Treffer als existing_solar.

VORBEREITUNG
------------
1. MaStR Bulk-Export herunterladen (kostenlos, keine Anmeldung):
   https://www.marktstammdatenregister.de/MaStR/Datendownload
   → "Gesamtdatenexport" herunterladen (~500 MB ZIP)

2. Python-Pakete installieren:
   pip install supabase python-dotenv scipy numpy

VERWENDUNG
----------
   # Direkt aus ZIP (empfohlen, kein Entpacken nötig):
   python execution/mastr_backfill.py --zip /pfad/zu/Gesamtdatenexport.zip

   # Aus bereits entpackter XML:
   python execution/mastr_backfill.py --xml /pfad/zu/EinheitenSolar.xml

   # Erst testen ohne DB-Änderungen:
   python execution/mastr_backfill.py --zip /pfad/zu/export.zip --dry-run

   # Anderen Suchradius verwenden (Standard: 150m):
   python execution/mastr_backfill.py --zip /pfad/zu/export.zip --radius 200
"""

import argparse
import os
import sys
import math
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime, timezone

try:
    import numpy as np
    from scipy.spatial import KDTree
except ImportError:
    print("❌ Fehlende Pakete. Bitte installieren:")
    print("   pip install supabase python-dotenv scipy numpy")
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    print("❌ python-dotenv fehlt. Bitte installieren: pip install python-dotenv")
    sys.exit(1)

# ── Umgebungsvariablen aus .env.local laden ───────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env.local")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌ Supabase-Zugangsdaten fehlen in .env.local:")
    print("   NEXT_PUBLIC_SUPABASE_URL=...")
    print("   SUPABASE_SERVICE_ROLE_KEY=...")
    sys.exit(1)

try:
    from supabase import create_client
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
except ImportError:
    print("❌ supabase-Paket fehlt. Bitte installieren: pip install supabase")
    sys.exit(1)

# ── Konstanten ────────────────────────────────────────────────────────────────
EARTH_RADIUS_M  = 6_371_000
DEFAULT_RADIUS  = 150          # Suchradius in Metern
DB_BATCH_SIZE   = 200          # Wie viele IDs pro Supabase-Update
MASTR_FILENAME  = "EinheitenSolar.xml"   # Zieldatei im ZIP


# ── Geometrie-Hilfsfunktionen ─────────────────────────────────────────────────
def to_cartesian(lat_deg: float, lng_deg: float) -> tuple[float, float, float]:
    """Lat/Lng (Grad) → 3D-Einheitsvektor auf der Erdkugel."""
    lat = math.radians(lat_deg)
    lng = math.radians(lng_deg)
    return (
        math.cos(lat) * math.cos(lng),
        math.cos(lat) * math.sin(lng),
        math.sin(lat),
    )


def chord_for_radius(radius_m: float) -> float:
    """Suchradius in Metern → Sehnenlänge für KDTree-Abfrage auf Einheitskugel."""
    return 2 * math.sin(radius_m / (2 * EARTH_RADIUS_M))


# ── MaStR-Daten parsen ────────────────────────────────────────────────────────
def _parse_stream(stream) -> list[tuple[float, float]]:
    """
    Parst EinheitenSolar-XML via iterparse (Streaming, kein vollständiges
    In-Memory-Laden). Gibt Liste von (lat, lng) zurück.
    """
    coords: list[tuple[float, float]] = []
    count = skipped = 0
    current: dict[str, str] = {}

    for event, elem in ET.iterparse(stream, events=("end",)):
        # Namespace-Präfix entfernen falls vorhanden: {ns}Tag → Tag
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag

        if tag == "EinheitSolar":
            lat_str = current.get("Breitengrad")
            lng_str = current.get("Laengengrad")

            if lat_str and lng_str:
                try:
                    # MaStR nutzt deutsches Dezimalkomma: 51,4536 → 51.4536
                    lat = float(lat_str.replace(",", "."))
                    lng = float(lng_str.replace(",", "."))
                    if -90 <= lat <= 90 and -180 <= lng <= 180:
                        coords.append((lat, lng))
                        count += 1
                        if count % 100_000 == 0:
                            print(f"  … {count:,} Einheiten eingelesen", end="\r", flush=True)
                except ValueError:
                    skipped += 1
            else:
                skipped += 1

            current.clear()
            elem.clear()

        elif tag in ("Breitengrad", "Laengengrad"):
            if elem.text:
                current[tag] = elem.text.strip()

    print(f"\n✅ {count:,} MaStR-Einheiten mit Koordinaten geladen "
          f"({skipped:,} ohne Koordinaten übersprungen)")
    return coords


def load_from_zip(zip_path: str) -> list[tuple[float, float]]:
    """Liest EinheitenSolar.xml direkt aus dem ZIP-Archiv (kein Entpacken nötig)."""
    print(f"📦 Öffne ZIP: {zip_path}")
    with zipfile.ZipFile(zip_path, "r") as z:
        names = z.namelist()
        solar_entry = next((n for n in names if MASTR_FILENAME in n), None)
        if not solar_entry:
            candidates = [n for n in names if n.endswith(".xml")]
            print(f"❌ '{MASTR_FILENAME}' nicht im ZIP gefunden.")
            print(f"   XML-Dateien im Archiv: {candidates[:10]}")
            sys.exit(1)
        print(f"   Lese: {solar_entry}  (kann einige Minuten dauern …)")
        with z.open(solar_entry) as f:
            return _parse_stream(f)


def load_from_xml(xml_path: str) -> list[tuple[float, float]]:
    """Liest eine bereits entpackte EinheitenSolar.xml."""
    print(f"📄 Lese XML: {xml_path}")
    with open(xml_path, "rb") as f:
        return _parse_stream(f)


# ── Leads aus Supabase laden ──────────────────────────────────────────────────
def fetch_leads() -> list[dict]:
    """Lädt alle Leads mit Koordinaten, die noch nicht als existing_solar markiert sind."""
    print("📥 Lade Leads aus Supabase …")
    leads: list[dict] = []
    page = 0
    page_size = 1000

    while True:
        res = (
            supabase.table("solar_lead_mass")
            .select("id, company_name, city, latitude, longitude, status")
            .not_("latitude", "is", "null")
            .not_("longitude", "is", "null")
            .neq("status", "existing_solar")
            .range(page * page_size, (page + 1) * page_size - 1)
            .execute()
        )
        batch = res.data or []
        leads.extend(batch)
        print(f"  … {len(leads)} Leads geladen", end="\r", flush=True)
        if len(batch) < page_size:
            break
        page += 1

    print(f"\n✅ {len(leads)} Leads geladen")
    return leads


# ── Abgleich ──────────────────────────────────────────────────────────────────
def find_matches(
    leads: list[dict],
    mastr_coords: list[tuple[float, float]],
    radius_m: int,
) -> list[str]:
    """
    Baut einen 3D-KD-Tree aus den MaStR-Koordinaten und sucht für jeden Lead
    nach Einheiten im Suchradius. Gibt Liste der Lead-IDs mit Treffern zurück.
    """
    print(f"\n🔧 Baue KD-Tree aus {len(mastr_coords):,} MaStR-Einheiten …")
    xyz = np.array([to_cartesian(lat, lng) for lat, lng in mastr_coords], dtype=np.float64)
    tree = KDTree(xyz)
    search_chord = chord_for_radius(radius_m)
    print(f"✅ KD-Tree bereit  (Radius: {radius_m} m = Sehne {search_chord:.7f})")

    print(f"\n🔍 Prüfe {len(leads):,} Leads …")
    match_ids: list[str] = []

    for i, lead in enumerate(leads):
        try:
            lat = float(lead["latitude"])
            lng = float(lead["longitude"])
        except (TypeError, ValueError):
            continue

        lead_xyz = np.array(to_cartesian(lat, lng), dtype=np.float64)
        hits = tree.query_ball_point(lead_xyz, r=search_chord)

        if hits:
            match_ids.append(lead["id"])
            city = lead.get("city") or ""
            print(f"  ☀️  {lead['company_name']}"
                  f"{' · ' + city if city else ''}"
                  f"  ({len(hits)} MaStR-Einheit{'en' if len(hits) > 1 else ''} im Umkreis)")

        if (i + 1) % 500 == 0 or (i + 1) == len(leads):
            print(f"  … {i + 1:,}/{len(leads):,} geprüft, {len(match_ids)} Treffer", flush=True)

    return match_ids


# ── DB-Update ─────────────────────────────────────────────────────────────────
def mark_as_existing_solar(ids: list[str], dry_run: bool) -> None:
    now_iso = datetime.now(timezone.utc).isoformat()

    print(f"\n{'='*60}")
    print(f"  Treffer: {len(ids)} Leads mit bestehender Solar-Anlage")
    print(f"{'='*60}")

    if not ids:
        print("✅ Keine Treffer — alle Leads sind solar-frei.")
        return

    if dry_run:
        print("\n🔎 DRY-RUN — keine Datenbankänderungen.")
        print("Treffer-IDs (erste 20):", ids[:20])
        if len(ids) > 20:
            print(f"  … und {len(ids) - 20} weitere")
        return

    print(f"💾 Aktualisiere Leads in Supabase (Batch-Größe: {DB_BATCH_SIZE}) …")
    updated = 0
    for i in range(0, len(ids), DB_BATCH_SIZE):
        batch = ids[i : i + DB_BATCH_SIZE]
        supabase.table("solar_lead_mass").update(
            {"status": "existing_solar", "updated_at": now_iso}
        ).in_("id", batch).execute()
        updated += len(batch)
        print(f"  … {updated}/{len(ids)} aktualisiert")

    print(f"\n✅ Fertig! {updated} Leads als 'existing_solar' markiert.")
    print("   Sie werden ab sofort automatisch aus allen Kampagnen ausgeschlossen.")


# ── Main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="MaStR Solar Backfill — markiert Leads mit bestehenden Solar-Anlagen",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    src = parser.add_mutually_exclusive_group(required=True)
    src.add_argument("--zip", metavar="PFAD", help="Pfad zur MaStR ZIP-Datei")
    src.add_argument("--xml", metavar="PFAD", help="Pfad zur entpackten EinheitenSolar.xml")

    parser.add_argument(
        "--radius", type=int, default=DEFAULT_RADIUS,
        help=f"Suchradius in Metern (Standard: {DEFAULT_RADIUS})",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Nur analysieren, keine Datenbankänderungen",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("  MaStR Solar Backfill")
    print(f"  Suchradius: {args.radius} m"
          + ("  [DRY-RUN]" if args.dry_run else ""))
    print("=" * 60 + "\n")

    # 1. MaStR-Daten laden
    if args.zip:
        mastr_coords = load_from_zip(args.zip)
    else:
        mastr_coords = load_from_xml(args.xml)

    if not mastr_coords:
        print("❌ Keine MaStR-Koordinaten gefunden. Abbruch.")
        sys.exit(1)

    # 2. Leads laden
    leads = fetch_leads()
    if not leads:
        print("ℹ️  Keine Leads mit Koordinaten gefunden.")
        return

    # 3. Abgleich
    match_ids = find_matches(leads, mastr_coords, args.radius)

    # 4. DB-Update
    mark_as_existing_solar(match_ids, args.dry_run)


if __name__ == "__main__":
    main()
