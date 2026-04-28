/**
 * MaStR Backfill — Server-seitiger Solar-Abgleich
 *
 * GET        — Job-Status abrufen
 * POST       — Job starten: { localPath } | { url } | {} (auto-detect)
 * POST wget  — ZIP via wget auf dem Server herunterladen: { action: "wget", url }
 *
 * Zweistufige Prüfung:
 *   1. GPS-Match    — Haversine ≤ 150 m gegen MaStR-Einheiten mit Koordinaten
 *   2. Adress-Match — PLZ + normalisierter Straßenname gegen alle MaStR-Einheiten
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PassThrough } from "stream";
import * as fs from "fs";
import { spawn } from "child_process";
import unzipper from "unzipper";

const TMP_ZIP = "/tmp/mastr.zip";

// ── Job-State ─────────────────────────────────────────────────────────────────
type JobStatus =
  | "idle" | "fetching_url" | "wget_download" | "downloading"
  | "parsing" | "matching" | "updating" | "done" | "error";

interface JobState {
  status: JobStatus;
  message: string;
  downloadedMB: number;
  totalMB: number;
  parsedUnits: number;
  leadsTotal: number;
  leadsChecked: number;
  matchesFound: number;
  updatedCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

let job: JobState = {
  status: "idle", message: "Kein Job gestartet",
  downloadedMB: 0, totalMB: 0, parsedUnits: 0,
  leadsTotal: 0, leadsChecked: 0, matchesFound: 0, updatedCount: 0,
  startedAt: null, finishedAt: null, error: null,
};

function resetJob(status: JobStatus = "idle"): void {
  job = {
    status, message: "Wird gestartet…",
    downloadedMB: 0, totalMB: 0, parsedUnits: 0,
    leadsTotal: 0, leadsChecked: 0, matchesFound: 0, updatedCount: 0,
    startedAt: new Date().toISOString(), finishedAt: null, error: null,
  };
}

function isAdmin(u: { user_metadata?: { role?: string } } | null) {
  return u?.user_metadata?.role === "admin";
}

// ── Räumlicher Index (GPS) ────────────────────────────────────────────────────
const EARTH_R = 6_371_000;
const RADIUS_M = 150;
const GRID_RES = 100;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const phi1 = (lat1 * Math.PI) / 180, phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLam = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

type Grid = Map<string, Array<[number, number]>>;

function addToGrid(grid: Grid, lat: number, lng: number) {
  const k = `${Math.floor(lat * GRID_RES)}_${Math.floor(lng * GRID_RES)}`;
  const c = grid.get(k); if (c) c.push([lat, lng]); else grid.set(k, [[lat, lng]]);
}

function hasNearby(grid: Grid, lat: number, lng: number): boolean {
  const latD = RADIUS_M / 111_000;
  const lngD = RADIUS_M / (111_000 * Math.cos((lat * Math.PI) / 180));
  const laMin = Math.floor((lat - latD) * GRID_RES), laMax = Math.floor((lat + latD) * GRID_RES);
  const loMin = Math.floor((lng - lngD) * GRID_RES), loMax = Math.floor((lng + lngD) * GRID_RES);
  for (let la = laMin; la <= laMax; la++)
    for (let lo = loMin; lo <= loMax; lo++) {
      const cell = grid.get(`${la}_${lo}`);
      if (cell) for (const [mlat, mlng] of cell)
        if (haversineM(lat, lng, mlat, mlng) <= RADIUS_M) return true;
    }
  return false;
}

// ── Adress-Index (PLZ + Straße) ───────────────────────────────────────────────
type AddrMap = Map<string, Set<string>>; // PLZ → Set<normalizedStreet>

function normalizeStreet(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/straße\b/gi, "str")
    .replace(/strasse\b/gi, "str")
    .replace(/str\.\s*$/i, "str")
    .replace(/\s+/g, " ");
}

function extractStreetFromAddress(address: string): string {
  // "Josefstraße 23" → "Josefstraße"
  // "Mittelweg 5a, 22145 Braak, Deutschland" → "Mittelweg"
  const m = address.match(/^([^0-9,]+)/);
  return m ? normalizeStreet(m[1]) : "";
}

function addToAddrMap(map: AddrMap, plz: string, street: string): void {
  const norm = normalizeStreet(street);
  if (!norm || norm.length < 3) return;
  const set = map.get(plz);
  if (set) set.add(norm);
  else map.set(plz, new Set([norm]));
}

function hasAddressMatch(map: AddrMap, plz: string, address: string): boolean {
  const streets = map.get(plz?.trim());
  if (!streets) return false;
  const street = extractStreetFromAddress(address);
  if (!street || street.length < 3) return false;
  return streets.has(street);
}

// ── wget-Download (läuft als Child-Process auf dem Server) ────────────────────
async function downloadWithWget(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    job.status = "wget_download";
    job.message = "wget startet…";

    const proc = spawn("wget", ["-c", "--progress=dot:mega", "-O", TMP_ZIP, url], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    proc.stderr.on("data", (data: Buffer) => {
      const line = data.toString();
      const pct = line.match(/(\d+)%/);
      const mb  = line.match(/([\d.]+)M[ \t]/);
      const eta = line.match(/eta\s+(.+)/i);
      if (pct || mb) {
        job.downloadedMB = mb ? Math.round(parseFloat(mb[1])) : job.downloadedMB;
        const pctStr = pct ? ` (${pct[1]}%)` : "";
        const etaStr = eta ? ` — ETA ${eta[1].trim()}` : "";
        job.message = `wget: ${job.downloadedMB} MB${pctStr}${etaStr}`;
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        const stat = fs.existsSync(TMP_ZIP) ? fs.statSync(TMP_ZIP) : null;
        job.downloadedMB = stat ? Math.round(stat.size / 1_048_576) : job.downloadedMB;
        job.totalMB = job.downloadedMB;
        resolve();
      } else {
        reject(new Error(`wget beendet mit Code ${code}`));
      }
    });

    proc.on("error", (err) => reject(new Error(`wget nicht verfügbar: ${err.message}`)));
  });
}

// ── MaStR URL auto-detect ─────────────────────────────────────────────────────
async function detectMastrUrl(): Promise<string | null> {
  try {
    const res = await fetch("https://www.marktstammdatenregister.de/MaStR/Datendownload", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SolarLead/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/href="(https?:\/\/[^"]*Gesamtdatenexport[^"]*\.zip)"/i)
           ?? html.match(/href="(https?:\/\/download\.marktstammdatenregister\.de\/[^"]+\.zip)"/i);
    return m?.[1] ?? null;
  } catch { return null; }
}

// ── Leads laden ───────────────────────────────────────────────────────────────
type Lead = {
  id: string;
  company_name: string;
  latitude: number | null;
  longitude: number | null;
  postal_code: string | null;
  address: string | null;
};

async function fetchAllLeads(): Promise<Lead[]> {
  const supabase = createAdminClient();
  const leads: Lead[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from("solar_lead_mass")
      .select("id, company_name, latitude, longitude, postal_code, address")
      .neq("status", "existing_solar")
      .range(page * 1000, (page + 1) * 1000 - 1);
    if (error) { console.error("[MaStR] fetchAllLeads error:", error.message); break; }
    if (!data?.length) break;
    leads.push(...(data as Lead[]));
    if (data.length < 1000) break;
    page++;
  }
  return leads;
}

// ── XML aus ZIP parsen ────────────────────────────────────────────────────────
function parseZipStream(
  zipStream: NodeJS.ReadableStream,
  grid: Grid,
  addrMap: AddrMap,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let found = false;
    let totalCount = 0;

    zipStream.pipe(unzipper.Parse())
      .on("entry", (entry: unzipper.Entry) => {
        if (entry.path.includes("EinheitenSolar") && entry.path.endsWith(".xml")) {
          found = true;
          job.message = `Parse ${entry.path}…`;
          let buf = "", count = 0;
          let firstChunk = true;
          let oddByte: Buffer | null = null;

          entry.on("data", (chunk: Buffer) => {
            // MaStR XML ist UTF-16 LE kodiert
            let data = oddByte ? Buffer.concat([oddByte, chunk]) : chunk;
            oddByte = null;
            // UTF-16 BOM (FF FE) beim ersten Chunk überspringen
            if (firstChunk) {
              firstChunk = false;
              if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) {
                data = data.slice(2);
              }
            }
            // UTF-16LE braucht gerade Byte-Anzahl
            if (data.length % 2 !== 0) {
              oddByte = data.slice(-1);
              data = data.slice(0, -1);
            }
            buf += data.toString("utf16le");

            let si: number;
            while ((si = buf.indexOf("<EinheitSolar>")) !== -1) {
              const ei = buf.indexOf("</EinheitSolar>", si);
              if (ei === -1) break;
              const block = buf.slice(si, ei + 15);
              buf = buf.slice(ei + 15);
              count++;
              totalCount++;

              // Stufe 1: GPS-Index
              const latM = block.match(/<Breitengrad>([^<]+)<\/Breitengrad>/);
              const lngM = block.match(/<Laengengrad>([^<]+)<\/Laengengrad>/);
              if (latM && lngM) {
                const lat = parseFloat(latM[1].replace(",", "."));
                const lng = parseFloat(lngM[1].replace(",", "."));
                if (!isNaN(lat) && !isNaN(lng) && lat >= 47 && lat <= 55 && lng >= 6 && lng <= 15) {
                  addToGrid(grid, lat, lng);
                }
              }

              // Stufe 2: Adress-Index (PLZ + Straße)
              const plzM = block.match(/<Postleitzahl>([^<]+)<\/Postleitzahl>/);
              const strM = block.match(/<Strasse>([^<]+)<\/Strasse>/);
              if (plzM && strM) {
                addToAddrMap(addrMap, plzM[1].trim(), strM[1].trim());
              }

              if (count % 5_000 === 0) {
                job.parsedUnits = totalCount;
                job.message = `${totalCount.toLocaleString("de")} Einheiten geladen…`;
              }
            }
          });
          entry.on("end", () => { job.parsedUnits = totalCount; });
          entry.on("error", reject);
        } else {
          entry.autodrain();
        }
      })
      .on("finish", () => found ? resolve() : reject(new Error("EinheitenSolar.xml nicht gefunden")))
      .on("error", reject);
  });
}

// ── Hauptjob ──────────────────────────────────────────────────────────────────
async function runBackfill(zipPath: string): Promise<void> {
  const supabase = createAdminClient();
  try {
    if (!fs.existsSync(zipPath)) throw new Error(`Datei nicht gefunden: ${zipPath}`);
    const stat = fs.statSync(zipPath);
    job.status = "parsing";
    job.totalMB = job.downloadedMB = Math.round(stat.size / 1_048_576);
    job.message = `Parse ZIP (${job.totalMB} MB)…`;

    const grid: Grid = new Map();
    const addrMap: AddrMap = new Map();
    await parseZipStream(fs.createReadStream(zipPath), grid, addrMap);

    if (grid.size === 0 && addrMap.size === 0) {
      throw new Error("Keine MaStR-Daten gefunden");
    }

    job.status = "matching";
    job.message = "Lade Leads…";
    const leads = await fetchAllLeads();
    job.leadsTotal = leads.length;

    if (leads.length === 0) {
      job.status = "done";
      job.finishedAt = new Date().toISOString();
      job.message = "Fertig! Keine prüfbaren Leads gefunden.";
      try { if (zipPath === TMP_ZIP) fs.unlinkSync(zipPath); } catch { /* ignore */ }
      return;
    }

    const matchIds: string[] = [];
    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      let matched = false;

      // Stufe 1: GPS-Match (150 m Radius)
      if (!matched && lead.latitude && lead.longitude) {
        if (hasNearby(grid, lead.latitude, lead.longitude)) matched = true;
      }

      // Stufe 2: Adress-Match (PLZ + Straße)
      if (!matched && lead.postal_code && lead.address) {
        if (hasAddressMatch(addrMap, lead.postal_code, lead.address)) matched = true;
      }

      if (matched) matchIds.push(lead.id);
      job.leadsChecked = i + 1;
      if ((i + 1) % 200 === 0) {
        job.message = `${i + 1}/${leads.length} geprüft, ${matchIds.length} Treffer`;
      }
    }
    job.matchesFound = matchIds.length;

    if (matchIds.length > 0) {
      job.status = "updating";
      const now = new Date().toISOString();
      let updated = 0;
      for (let i = 0; i < matchIds.length; i += 200) {
        await supabase.from("solar_lead_mass")
          .update({ status: "existing_solar", updated_at: now })
          .in("id", matchIds.slice(i, i + 200));
        updated += Math.min(200, matchIds.length - i);
        job.updatedCount = updated;
      }
    }

    job.status = "done";
    job.finishedAt = new Date().toISOString();
    job.message = matchIds.length > 0
      ? `Fertig! ${matchIds.length} Leads als existing_solar markiert.`
      : "Fertig! Keine neuen Treffer.";

    // Temp-Datei aufräumen
    try { if (zipPath === TMP_ZIP) fs.unlinkSync(zipPath); } catch { /* ignore */ }

  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    job.message = `Fehler: ${job.error}`;
    job.finishedAt = new Date().toISOString();
    console.error("[MaStR]", err);
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(job);
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!["idle", "done", "error"].includes(job.status)) {
    return NextResponse.json({ error: "Job läuft bereits" }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));

  // ── Aktion: wget-Download ────────────────────────────────────────────────────
  if (body.action === "wget") {
    let url: string = body.url ?? "";
    resetJob("wget_download");

    (async () => {
      if (!url) {
        job.message = "Erkenne MaStR-URL…";
        const detected = await detectMastrUrl();
        if (!detected) {
          job.status = "error";
          job.error = "URL nicht erkannt. Bitte manuell eintragen.";
          job.message = job.error;
          job.finishedAt = new Date().toISOString();
          return;
        }
        url = detected;
      }
      try {
        await downloadWithWget(url);
        await runBackfill(TMP_ZIP);
      } catch (err) {
        job.status = "error";
        job.error = err instanceof Error ? err.message : String(err);
        job.message = `Fehler: ${job.error}`;
        job.finishedAt = new Date().toISOString();
      }
    })();

    return NextResponse.json({ ok: true, message: "wget-Download gestartet" });
  }

  // ── Aktion: lokale Datei verarbeiten ─────────────────────────────────────────
  const localPath: string = body.localPath ?? "";
  if (localPath) {
    resetJob("parsing");
    runBackfill(localPath);
    return NextResponse.json({ ok: true, message: "Verarbeitung gestartet" });
  }

  return NextResponse.json({ error: "Bitte action=wget oder localPath angeben" }, { status: 400 });
}
