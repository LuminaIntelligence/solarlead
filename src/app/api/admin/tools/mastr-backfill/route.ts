/**
 * MaStR Backfill — Server-seitiger Solar-Abgleich
 *
 * Vergleicht alle Leads gegen den MaStR-Gesamtdatenexport und markiert
 * Treffer (Solar-Anlage im Umkreis 150m) als existing_solar.
 *
 * GET  — Aktuellen Job-Status abrufen
 * POST — Job starten:
 *   { url: "https://..." }          Download vom MaStR-Server (langsam)
 *   { localPath: "/tmp/mastr.zip" } Lokale Datei (nach SCP hochladen)
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Readable, PassThrough } from "stream";
import * as fs from "fs";
import * as path from "path";
import unzipper from "unzipper";

// ── Typen ─────────────────────────────────────────────────────────────────────
type JobStatus =
  | "idle" | "fetching_url" | "downloading" | "parsing"
  | "matching" | "updating" | "done" | "error";

interface JobState {
  status: JobStatus;
  message: string;
  downloadedMB: number;
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
  downloadedMB: 0, parsedUnits: 0, leadsTotal: 0,
  leadsChecked: 0, matchesFound: 0, updatedCount: 0,
  startedAt: null, finishedAt: null, error: null,
};

function resetJob(): void {
  job = {
    status: "idle", message: "Job wird gestartet…",
    downloadedMB: 0, parsedUnits: 0, leadsTotal: 0,
    leadsChecked: 0, matchesFound: 0, updatedCount: 0,
    startedAt: new Date().toISOString(), finishedAt: null, error: null,
  };
}

function isAdmin(user: { user_metadata?: { role?: string } } | null): boolean {
  return user?.user_metadata?.role === "admin";
}

// ── Räumliche Hilfsfunktionen ─────────────────────────────────────────────────
const EARTH_R = 6_371_000;
const RADIUS_M = 150;
const GRID_RES = 100;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLam = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

type Grid = Map<string, Array<[number, number]>>;

function addToGrid(grid: Grid, lat: number, lng: number): void {
  const k = `${Math.floor(lat * GRID_RES)}_${Math.floor(lng * GRID_RES)}`;
  const cell = grid.get(k);
  if (cell) cell.push([lat, lng]);
  else grid.set(k, [[lat, lng]]);
}

function hasNearby(grid: Grid, lat: number, lng: number): boolean {
  const latDelta = RADIUS_M / 111_000;
  const lngDelta = RADIUS_M / (111_000 * Math.cos((lat * Math.PI) / 180));
  const laMin = Math.floor((lat - latDelta) * GRID_RES);
  const laMax = Math.floor((lat + latDelta) * GRID_RES);
  const loMin = Math.floor((lng - lngDelta) * GRID_RES);
  const loMax = Math.floor((lng + lngDelta) * GRID_RES);
  for (let la = laMin; la <= laMax; la++) {
    for (let lo = loMin; lo <= loMax; lo++) {
      const cell = grid.get(`${la}_${lo}`);
      if (cell) {
        for (const [mlat, mlng] of cell) {
          if (haversineM(lat, lng, mlat, mlng) <= RADIUS_M) return true;
        }
      }
    }
  }
  return false;
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
    const match =
      html.match(/href="(https?:\/\/[^"]*Gesamtdatenexport[^"]*\.zip)"/i) ??
      html.match(/href="(https?:\/\/download\.marktstammdatenregister\.de\/[^"]+\.zip)"/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

// ── Leads laden ───────────────────────────────────────────────────────────────
async function fetchAllLeads() {
  const supabase = createAdminClient();
  const leads: Array<{ id: string; company_name: string; latitude: number; longitude: number }> = [];
  const PAGE = 1000;
  let page = 0;
  while (true) {
    const { data, error } = await supabase
      .from("solar_lead_mass")
      .select("id, company_name, latitude, longitude")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .neq("status", "existing_solar")
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error || !data?.length) break;
    leads.push(...(data as typeof leads));
    if (data.length < PAGE) break;
    page++;
  }
  return leads;
}

// ── XML parsen aus einem ZIP-Stream ──────────────────────────────────────────
function parseZipStream(zipStream: NodeJS.ReadableStream, grid: Grid): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let foundSolarFile = false;

    zipStream
      .pipe(unzipper.Parse())
      .on("entry", (entry: unzipper.Entry) => {
        const fileName = entry.path;

        if (fileName.includes("EinheitenSolar") && fileName.endsWith(".xml")) {
          foundSolarFile = true;
          job.message = `Parse ${fileName}…`;

          let buf = "";
          let parsedCount = 0;

          entry.on("data", (chunk: Buffer) => {
            buf += chunk.toString("utf8");

            let startIdx: number;
            while ((startIdx = buf.indexOf("<EinheitSolar>")) !== -1) {
              const endIdx = buf.indexOf("</EinheitSolar>", startIdx);
              if (endIdx === -1) break;

              const block = buf.slice(startIdx, endIdx + "</EinheitSolar>".length);
              buf = buf.slice(endIdx + "</EinheitSolar>".length);

              const latMatch = block.match(/<Breitengrad>([^<]+)<\/Breitengrad>/);
              const lngMatch = block.match(/<Laengengrad>([^<]+)<\/Laengengrad>/);

              if (latMatch && lngMatch) {
                const lat = parseFloat(latMatch[1].replace(",", "."));
                const lng = parseFloat(lngMatch[1].replace(",", "."));
                if (!isNaN(lat) && !isNaN(lng) && lat >= 47 && lat <= 55 && lng >= 6 && lng <= 15) {
                  addToGrid(grid, lat, lng);
                  parsedCount++;
                  if (parsedCount % 50_000 === 0) {
                    job.parsedUnits = parsedCount;
                    job.message = `${parsedCount.toLocaleString("de")} Einheiten geladen…`;
                  }
                }
              }
            }
          });

          entry.on("end", () => {
            job.parsedUnits = parsedCount;
            job.message = `${parsedCount.toLocaleString("de")} MaStR-Einheiten geladen`;
          });

          entry.on("error", reject);
        } else {
          entry.autodrain();
        }
      })
      .on("finish", () => {
        if (!foundSolarFile) reject(new Error("EinheitenSolar.xml nicht im ZIP gefunden"));
        else resolve();
      })
      .on("error", reject);
  });
}

// ── Hauptjob ──────────────────────────────────────────────────────────────────
async function runBackfill(source: { url?: string; localPath?: string }): Promise<void> {
  const supabase = createAdminClient();

  try {
    const grid: Grid = new Map();

    if (source.localPath) {
      // ── Lokale Datei (per SCP hochgeladen) ──────────────────────────────────
      const absPath = path.resolve(source.localPath);
      if (!fs.existsSync(absPath)) throw new Error(`Datei nicht gefunden: ${absPath}`);
      const stat = fs.statSync(absPath);
      job.status = "parsing";
      job.downloadedMB = Math.round(stat.size / 1_048_576);
      job.message = `Lese lokale Datei (${job.downloadedMB} MB)…`;
      await parseZipStream(fs.createReadStream(absPath), grid);

    } else if (source.url) {
      // ── Download vom MaStR-Server ────────────────────────────────────────────
      job.status = "downloading";
      job.message = `Lade MaStR ZIP…`;

      const response = await fetch(source.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; SolarLead/1.0)" },
        signal: AbortSignal.timeout(90 * 60 * 1000),
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} beim Download`);

      const contentLength = Number(response.headers.get("content-length") ?? 0);
      let downloaded = 0;

      const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream);
      const byteCounter = new PassThrough();
      byteCounter.on("data", (chunk: Buffer) => {
        downloaded += chunk.length;
        job.downloadedMB = Math.round(downloaded / 1_048_576);
        job.message = `Download: ${job.downloadedMB} MB${contentLength ? ` von ~${Math.round(contentLength / 1_048_576)} MB` : ""}`;
      });
      nodeStream.pipe(byteCounter);

      job.status = "parsing";
      await parseZipStream(byteCounter, grid);
    } else {
      throw new Error("Weder URL noch lokaler Pfad angegeben");
    }

    if (grid.size === 0) throw new Error("Keine MaStR-Koordinaten in Deutschland gefunden");

    // Leads laden
    job.status = "matching";
    job.message = "Lade Leads aus Datenbank…";
    const leads = await fetchAllLeads();
    job.leadsTotal = leads.length;

    // Abgleich
    const matchIds: string[] = [];
    for (let i = 0; i < leads.length; i++) {
      if (hasNearby(grid, leads[i].latitude, leads[i].longitude)) matchIds.push(leads[i].id);
      job.leadsChecked = i + 1;
      if ((i + 1) % 200 === 0) job.message = `${i + 1}/${leads.length} geprüft, ${matchIds.length} Treffer`;
    }
    job.matchesFound = matchIds.length;

    // DB-Update
    if (matchIds.length > 0) {
      job.status = "updating";
      const now = new Date().toISOString();
      let updated = 0;
      for (let i = 0; i < matchIds.length; i += 200) {
        const batch = matchIds.slice(i, i + 200);
        await supabase.from("solar_lead_mass").update({ status: "existing_solar", updated_at: now }).in("id", batch);
        updated += batch.length;
        job.updatedCount = updated;
      }
    }

    job.status = "done";
    job.finishedAt = new Date().toISOString();
    job.message = matchIds.length > 0
      ? `Fertig! ${matchIds.length} Leads als 'existing_solar' markiert.`
      : "Fertig! Keine neuen Solar-Treffer gefunden.";

  } catch (err) {
    job.status = "error";
    job.error = err instanceof Error ? err.message : String(err);
    job.message = `Fehler: ${job.error}`;
    job.finishedAt = new Date().toISOString();
    console.error("[MaStR-Backfill] Fehler:", err);
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
  const localPath: string = body.localPath ?? "";
  const zipUrl: string = body.url ?? "";

  resetJob();

  if (localPath) {
    runBackfill({ localPath });
    return NextResponse.json({ ok: true, message: "Job gestartet (lokale Datei)" });
  }

  if (zipUrl) {
    runBackfill({ url: zipUrl });
    return NextResponse.json({ ok: true, message: "Job gestartet (Download)" });
  }

  // Auto-detect URL
  job.status = "fetching_url";
  job.message = "Suche aktuelle MaStR-Download-URL…";
  (async () => {
    const detected = await detectMastrUrl();
    if (!detected) {
      job.status = "error";
      job.error = "URL konnte nicht erkannt werden. Bitte manuell von marktstammdatenregister.de kopieren oder ZIP per SCP hochladen und localPath angeben.";
      job.message = job.error;
      job.finishedAt = new Date().toISOString();
      return;
    }
    await runBackfill({ url: detected });
  })();

  return NextResponse.json({ ok: true, message: "Job gestartet (URL-Erkennung…)" });
}
