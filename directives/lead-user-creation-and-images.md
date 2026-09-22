---
name: Field-Member Lead-Anlage & Lead-Bilder
version: alpha
description: Konzept für zwei zusammenhängende Features — (1) Field-Members wie Gisela/Jan legen eigene Leads an, (2) alle User können Bilder an Leads hängen (z.B. Dachfoto, Ortsbesuch, Visitenkarte).
---

# Design Doc: Field-Member Lead-Anlage & Lead-Bilder

## Context & Goals

### Problem

Aktuell können nur Admins Leads systemweit anlegen (via Discovery-Kampagne, MaStR-Import oder händisch über `/admin/leads`). Field-Members wie **Gisela Weingartner**, **Jan Schoner**, **Stefan Schmidt**, **Andreas Siewer** und **Stephan Schallenberg** bekommen Leads *zugewiesen*, können aber selbst keine erfassen — obwohl sie im Außendienst regelmäßig auf Objekte stoßen:

- Ortstermin bei Kunde A und beim Vorbeifahren fällt Dach von Firma B auf
- Empfehlung eines Vereinsmitglieds („Ruf mal bei der Molkerei in Trostberg an")
- Selbst recherchierte Zielobjekte aus Handelsregister, Immobilienportalen, Vereinsnetzwerk

Zweiter Reibungspunkt: Leads sind heute reine Text-/GPS-Objekte. Kein visueller Kontext. Ein Feldberater kann weder:
- Ein Foto vom Dach nach Ortsbesuch dokumentieren
- Eine Visitenkarte des Ansprechpartners anhängen
- Skizzen vom Meeting oder Notizzettel aufbewahren

Das führt zu Wissensverlust: Erkenntnisse aus dem Außendienst landen in WhatsApp-Chats statt am Lead.

### Goals

1. **Field-Members können Leads selbstständig anlegen** über eine geführte Erfassungsmaske im `/dashboard`. Neu erzeugte Leads werden automatisch dem Anleger zugewiesen (`assigned_to = self`, `user_id = self`).
2. **Duplikat-Erkennung** verhindert doppelte Bearbeitung: wenn eine Firma schon im System liegt (auch bei einem anderen User), wird das transparent angezeigt statt eines Duplikats.
3. **Adress-Autocomplete** via Google Places macht die Eingabe schnell und liefert saubere Geo-Koordinaten für das spätere Solar-Assessment.
4. **Automatisches Scoring** startet nach Anlage — Dachfläche via Google Solar API, Enrichment via Firecrawl/Apollo, Existing-Solar-Check via OSM. Field-Member sieht innerhalb weniger Minuten einen Score.
5. **Bilder-Upload** auf Lead-Detail-Ebene: Fotos vom Dach, Gebäude, Ansprechpartner, Visitenkarten, Notizen. Mobile-friendly (Kamera direkt).
6. **Bilder sind Team-sichtbar**: Wenn Admin oder Reply-Specialist den Lead öffnet, sieht er die Bilder des Field-Members.

### Non-Goals

- **Kein Bulk-Import** aus CSV für Field-Members — nur Einzel-Anlage über UI. Bulk bleibt Admin-Feature.
- **Keine Bild-Bearbeitung** im System (Cropping, Rotation, Annotations). User macht das im Handy vor dem Upload.
- **Kein OCR** auf Visitenkarten-Bildern in Version 1. Bild wird als Bild gespeichert, Kontakt-Daten trägt User separat ein. OCR kann Phase 2 werden.
- **Kein Video-Upload** — nur Standbilder. Videos wären Storage-Overkill für den erwarteten Nutzen.
- **Keine Bild-Freigabe an Kunden** — Bilder sind interne Doku, nicht Teil des Outreach-Templates.

## Proposed Design

### Feature 1: Field-Member Lead-Anlage

#### System-Architektur

```
Field-Member
  └─ /dashboard/leads/new  (neuer Screen, Client-Component)
       │
       ├─ Formular mit Feldern (Company, Address, Category, Contact, ...)
       ├─ Google-Places-Autocomplete-Widget für Address-Feld
       └─ Klick "Speichern"
            │
            └─ POST /api/leads (server-action saveLead)
                 │
                 ├─ 1. checkLeadDuplicate() [existiert bereits]
                 │      ├─ Duplikat gefunden → Response mit duplicate-Info
                 │      │                       + "Zu Lead X springen"
                 │      └─ Kein Duplikat      → Insert
                 │
                 ├─ 2. Insert solar_lead_mass
                 │      ├─ user_id = auth.uid()
                 │      ├─ assigned_to = auth.uid()  ← neu
                 │      ├─ status = 'new'
                 │      ├─ source = 'manual_user'    ← neuer Enum-Wert
                 │      └─ score = null (wird async berechnet)
                 │
                 ├─ 3. Enqueue Enrichment-Tasks (Background)
                 │      ├─ Google Solar API (max_array_area_m2)
                 │      ├─ Firecrawl/Apollo (Kontakte, Website-Details)
                 │      ├─ OSM Existing-Solar Check
                 │      └─ Score-Berechnung nach Enrichment
                 │
                 └─ 4. Response { lead_id, edit_url }
                        └─ Frontend redirect zu /dashboard/leads/{lead_id}
```

#### Datenmodell-Änderungen

`solar_lead_mass` bekommt keinen neuen Spalten — alles vorhandene reicht. Nur der bestehende `source`-Wertebereich muss um `'manual_user'` erweitert werden (Diskriminierung von `google_places` / `mastr_backfill` / etc. — wichtig für Statistik).

Prüfung offen: Ist `source` eine ENUM oder ein freier Text? Falls ENUM: Migration nötig.

```sql
-- Migration 20260922_source_manual_user.sql
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'manual_user';
-- (Falls source ein Text-Feld ist: kein Schema-Change nötig)
```

Optional aber empfohlen: `created_via` bekommt zusätzlichen Wert `'field_member_ui'` (falls es die Spalte gibt, sonst weglassen).

#### API-Design

Bestehender Endpoint `POST /api/search` wird für Massen-Discovery verwendet. Für die manuelle Anlage gibt es eine **neue** Server-Action:

```typescript
// src/lib/actions/leads.ts

export interface CreateLeadInput {
  company_name: string;
  address: string;
  city: string;
  postal_code?: string;
  category: string;                    // aus CATEGORY_OPTIONS
  phone?: string;
  email?: string;
  website?: string;
  linkedin_url?: string;
  notes?: string;
  // Aus Google Places (wenn Autocomplete genutzt):
  place_id?: string;
  latitude?: number;
  longitude?: number;
}

export async function createFieldMemberLead(
  input: CreateLeadInput
): Promise<SaveLeadResult> {
  // 1. Auth
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Nicht angemeldet" };

  // 2. Duplikat-Check (bestehende Funktion wiederverwenden)
  const dup = await checkLeadDuplicate({
    place_id: input.place_id ?? null,
    company_name: input.company_name,
    postal_code: input.postal_code ?? null,
    city: input.city,
  });
  if (dup) return { ok: false, duplicate: dup };

  // 3. Insert mit user_id UND assigned_to = self
  const { data, error } = await supabase
    .from("solar_lead_mass")
    .insert({
      ...input,
      user_id: user.id,
      assigned_to: user.id,
      status: "new",
      source: "manual_user",
      total_score: null,       // wird durch async Enrichment gesetzt
    })
    .select()
    .single();
  if (error) return { ok: false, error: error.message };

  // 4. Enrichment im Hintergrund anstoßen (fire-and-forget)
  triggerBackgroundEnrichment(data.id).catch(console.error);

  revalidatePath("/dashboard/leads");
  return { ok: true, lead: data };
}
```

Die `triggerBackgroundEnrichment` postet an einen internen Endpoint auf dem Worker-Port (analog zu bestehenden Cron-Endpoints), der Solar-Assessment + Firecrawl + Scoring sequenziell durchläuft. Kein GitHub-Actions-Cron nötig — läuft direkt nach Erstellung.

#### UI-Konzept

**Neuer Screen** `/dashboard/leads/new`:

```
┌────────────────────────────────────────────────────────┐
│  ← Zurück zu meinen Leads                              │
│                                                         │
│  Neuen Lead anlegen                                     │
│  Ein Objekt aus deinem Vertriebsgebiet erfassen         │
│                                                         │
│  ┌─ Firmendaten ────────────────────────────────────┐  │
│  │  Firmenname *          [_________________]         │  │
│  │  Kategorie *           [Logistik ▾]                │  │
│  │  Adresse *             [Autocomplete Google Places]│  │
│  │      ↳ Straße, PLZ, Stadt werden auto-gefüllt      │  │
│  │      ↳ GPS-Koordinaten aus Places-Result           │  │
│  └────────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Kontakt (optional) ────────────────────────────┐   │
│  │  Ansprechpartner       [_________________]        │   │
│  │  Telefon               [_________________]        │   │
│  │  E-Mail                [_________________]        │   │
│  │  Website               [_________________]        │   │
│  │  LinkedIn              [_________________]        │   │
│  └───────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─ Notizen (optional) ────────────────────────────┐   │
│  │  [Freitext-Feld, mehrzeilig]                      │   │
│  │  Z.B. "Am 20.9. am Dach vorbeigefahren, wirkt     │   │
│  │  gut instand gehalten, große Süd-Fläche."         │   │
│  └───────────────────────────────────────────────────┘   │
│                                                         │
│  [Abbrechen]              [Anlegen & auf Detail-Seite]  │
└────────────────────────────────────────────────────────┘
```

**Einstiegspunkt:** Button `+ Neuer Lead` oben rechts auf `/dashboard/leads`, zwischen der Suche und der Sortierung.

**Nach Klick "Anlegen":**
- Bei Duplikat: Modal „Diese Firma ist bereits im System. Sie ist X zugewiesen. Willst du sie öffnen oder anders erfassen?"
- Bei Erfolg: Sofort-Redirect zur Lead-Detail-Seite. Ein Info-Banner oben: „Lead angelegt. Dachfläche und Score werden gerade berechnet, kommen in wenigen Minuten." Solar/Firecrawl laufen asynchron.

### Feature 2: Bilder an Leads

#### System-Architektur

```
Field-Member auf /dashboard/leads/{id}
    │
    ├─ Bilder-Card (neuer Bereich in der Lead-Detail-Sidebar)
    │    │
    │    ├─ Upload-Zone (Drag & Drop ODER Klick ODER Kamera)
    │    │    │
    │    │    ├─ Client-side Validierung:
    │    │    │    - Max 15 MB pro Bild
    │    │    │    - Max 20 Bilder pro Lead
    │    │    │    - Nur JPG, PNG, HEIC, WebP
    │    │    │
    │    │    ├─ Client-side Konvertierung:
    │    │    │    - HEIC → JPG via heic2any (Browser-lib)
    │    │    │    - Auto-Resize wenn > 2000px Kantenlänge (Speicherplatz sparen)
    │    │    │
    │    │    └─ POST /api/leads/{id}/images (multipart)
    │    │         │
    │    │         └─ Server:
    │    │              ├─ hasLeadAccess Check
    │    │              ├─ Upload zu Supabase Storage
    │    │              │   Path: lead-images/{lead_id}/{uuid}.{ext}
    │    │              └─ Insert lead_images Row
    │    │
    │    └─ Gallery-Grid (bestehende Bilder)
    │         │
    │         ├─ Thumbnail-Ansicht (150px Kacheln)
    │         ├─ Klick → Lightbox mit Original + Meta
    │         ├─ Caption editieren (nur eigene oder Admin)
    │         └─ Delete (nur eigene oder Admin)
```

#### Datenmodell — neue Tabelle

```sql
-- Migration 20260922_lead_images.sql
CREATE TABLE lead_images (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id       uuid NOT NULL REFERENCES solar_lead_mass(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,                    -- Supabase-Storage-Pfad
  file_name     text,                             -- Original-Dateiname
  file_size_bytes int,
  mime_type     text,
  width_px      int,                              -- für Layout ohne Layout-Shift
  height_px     int,
  caption       text,                             -- optionaler User-Kommentar
  uploaded_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lead_images_lead ON lead_images(lead_id, uploaded_at DESC);

ALTER TABLE lead_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_all_access" ON lead_images
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

#### Storage-Bucket

Supabase-Storage-Bucket `lead-images`:
- **Privat** (kein anonymer Zugriff)
- Zugriff ausschließlich über **signierte URLs**, die der Server bei GET erzeugt (Ablauf: 1 Stunde)
- Ordnerstruktur: `{lead_id}/{image_id}.{ext}` — Löschen des Leads löscht durch Cascade den DB-Row; ein nächtlicher Cleanup-Cron löscht die verwaisten Files.

#### API-Design

```typescript
// POST /api/leads/[id]/images
//   multipart/form-data:
//     file: <Bild>
//     caption?: <String>
//   Response: { image: LeadImage }

// GET /api/leads/[id]/images
//   Response: {
//     images: [
//       {
//         id, caption, uploaded_at, uploader_email,
//         signed_url: "https://.../lead-images/...?token=..." (1h Ablauf),
//         signed_thumb_url: "..." (Storage-Transform: width=300)
//       }
//     ]
//   }

// PATCH /api/leads/[id]/images/[imgId]
//   Body: { caption: string | null }

// DELETE /api/leads/[id]/images/[imgId]
//   Löscht DB-Row UND Storage-Datei.
//   Nur wenn: uploaded_by = self ODER user ist admin/team_lead.
```

Alle vier Endpoints prüfen `hasLeadAccess(supabase, leadId, userId)` bevor irgendwas passiert.

#### UI-Komponente

**Neuer Bereich auf `/dashboard/leads/{id}`** — unter dem CRM-Sidebar-Block, in der Hauptspalte zwischen „Kontakte" und „Aktivitäten":

```
┌─ Bilder (3) ────────────────────────── + Foto hinzufügen ┐
│                                                            │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌ Drag & Drop      ┐ │
│  │ [Dach] │  │[Visite]│  │[Skizze]│  │ oder [Kamera] 📷 │ │
│  │        │  │ karte  │  │        │  │ oder [Datei] 📁  │ │
│  └────────┘  └────────┘  └────────┘  └──────────────────┘ │
│  Von Gisela   Von Gisela  Von Jan                          │
│  22.09.       22.09.      15.09.                           │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

Klick auf Thumbnail öffnet Lightbox mit:
- Original-Bild
- Caption (editierbar wenn eigenes Bild)
- „Hochgeladen von X am Y"
- „Löschen"-Button (wenn eigenes Bild oder Admin)

**Mobile-Optimierung:** Der „+ Foto hinzufügen"-Button ist auf Mobil ein `<input type="file" accept="image/*" capture="environment">` — öffnet direkt die Kamera-App auf iPhone/Android.

## Alternatives Considered

### Alternative A für Feature 1: „Field-Members nutzen den bestehenden `/dashboard/search`-Flow"

Der Google-Places-basierte Such-Flow existiert schon und legt Leads an. Man könnte argumentieren, dass Field-Members einfach da suchen und speichern.

**Warum verworfen:** Der Such-Flow ist optimiert für „viele Leads aus einem Suchbegriff bulk-anlegen". Für die Feld-Situation (einzelnes Objekt vor Ort, oft ohne exakten Firmennamen) ist er umständlich. Außerdem generiert er den Lead ohne `assigned_to = self` — er würde als unzugewiesener Lead im System landen und via `getLeads()` für den Field-Member nicht sichtbar sein. Man müsste den Flow deutlich umbauen und für einen anderen Use-Case optimieren.

### Alternative B für Feature 1: „Admin legt Leads für Field-Member per Whatsapp-Anweisung an"

Status quo. Field-Member schreibt an Admin, Admin trägt ein.

**Warum verworfen:** Skaliert nicht (Admin-Bottleneck) und verursacht Verzögerung von Stunden bis Tagen zwischen Beobachtung und Erfassung. Bei einem 5-User-Team mit je ~3 Ad-hoc-Sichtungen pro Woche entstehen 15 wöchentliche Admin-Tickets nur für Lead-Anlage.

### Alternative C für Feature 2: „Bilder als BLOB in Postgres speichern"

Statt Supabase Storage direkt als `bytea`-Feld in einer Tabelle.

**Warum verworfen:**
- Postgres BLOB verbraucht das DB-Backup-Budget massiv (schnell Gigabytes)
- Keine effizienten Thumbnails/Transforms out-of-the-box
- Kein CDN → langsame Auslieferung, insbesondere mobil
- Supabase Storage hat integrierte Image-Transform-API (`width=300` in der URL) und wird über CDN ausgeliefert. Das ist genau der Use-Case dafür.

### Alternative D für Feature 2: „S3 oder Cloudflare R2 statt Supabase Storage"

Externes Object-Storage.

**Warum verworfen:** Zusätzliche Auth-Komplexität (extra Access-Keys, extra Rechnung, extra Ausfall-Domäne). Supabase Storage sitzt schon im Auth-Kontext, RLS-freundlich, und die Kostenordnung (~0,02 USD/GB) unterscheidet sich nicht signifikant von R2. Erst bei > 500 GB Volumen wäre R2 signifikant günstiger — heute nicht relevant.

### Alternative E für Feature 2: „Bilder ausschließlich über WhatsApp / Google Drive Link"

Field-Members verlinken externe Cloud-Ordner in der Lead-Notiz.

**Warum verworfen:** Erstens Datenschutz (Fotos von Firmendächern sind heikel, sollen nicht in privaten Cloud-Accounts der User liegen). Zweitens Wissensverlust wenn ein User das Team verlässt (Link ist tot). Drittens keine strukturelle Verknüpfung zum Lead — man kann nicht filtern „alle Leads mit Foto".

## Components

### `<LeadCreateForm />` (Feature 1)

- **Speicherort:** `src/components/leads/lead-create-form.tsx`
- **Client-Component** (`"use client"`) wegen Google-Places-Autocomplete + interaktive Validierung
- **Props:** keine (nutzt Auth-Context)
- **State:** Formfelder + Loading + Duplikat-Info
- **Externe Abhängigkeiten:** `@googlemaps/js-api-loader` für Places-Autocomplete (bereits im Bundle vorhanden via Discovery)
- **Verwendet bestehende UI-Komponenten:** `Input`, `Select`, `Textarea`, `Button`, `Card`, `Label` aus `@/components/ui/*`

### `<LeadImagesGallery />` (Feature 2)

- **Speicherort:** `src/components/leads/lead-images-gallery.tsx`
- **Client-Component** — Upload-Zustand + Lightbox
- **Props:** `{ leadId: string; canManage: boolean }` — `canManage` steuert ob Upload/Delete-Buttons sichtbar sind (kommt aus Serverseiten-Check)
- **Externe Abhängigkeiten:**
  - `heic2any` für iPhone-HEIC-Konvertierung im Browser
  - `browser-image-compression` für Resize (2000px Kantenlänge)
  - Kein Lightbox-Framework — eigenes Modal mit `<dialog>`-Element reicht

### Server-Action `createFieldMemberLead()`

- **Speicherort:** `src/lib/actions/leads.ts` (bestehende Datei erweitern)
- **Setzt `user_id = assigned_to = auth.uid()`, `status='new'`, `source='manual_user'`**
- **Fire-and-forget Enrichment-Trigger** via internen HTTP-Call an Worker

### API-Route `/api/leads/[id]/images` (POST + GET)

- **Speicherort:** `src/app/api/leads/[id]/images/route.ts`
- **Auth:** `hasLeadAccess()` (bestehender Helper)
- **Upload-Handling:** Standard-Formidable/Native-FormData-Parsing
- **Server-side Validation:** MIME-Type-Check, max 15 MB, max 20 pro Lead

### API-Route `/api/leads/[id]/images/[imgId]` (PATCH + DELETE)

- **Speicherort:** `src/app/api/leads/[id]/images/[imgId]/route.ts`
- **Auth-Zusatz:** Delete nur wenn `uploaded_by = self` ODER `role in ('admin', 'team_lead')`

## Do's and Don'ts

### Do

- **Adress-Autocomplete verpflichtend anbieten**, damit Geo-Koordinaten sauber sind. Ohne Koordinaten kann Solar-Assessment nicht laufen.
- **Duplikat-Check freundlich präsentieren** — nicht als Fehler, sondern als Angebot („Diese Firma ist schon im System — öffnen?").
- **Score-Berechnung als Progress-Indicator** zeigen — „Score wird berechnet, kommt in wenigen Minuten". Sonst denkt der User das System sei kaputt.
- **Mobile-First** für Feature 2 — der Haupt-Use-Case ist Foto direkt auf der Baustelle vom Handy.
- **Thumbnail-Transforms nutzen** (`width=300` in der Storage-URL) statt Original-Bilder im Grid — spart Bandbreite auf Mobil.
- **Uploader-Name unter jedem Bild** zeigen — Team-Transparenz („Aha, der Jan war da").
- **Wenn `source='manual_user'`** ist, Score ohne Solar-Assessment-Daten auf `null` lassen (nicht 0!). `null` = „berechnung offen", `0` = „schlecht bewertet".

### Don't

- **Kein Bulk-Upload von 50 Bildern gleichzeitig** — Kacheln würden endlos scrollen. Limit auf 20 pro Lead ist bewusst.
- **Keine Bilder direkt im Outreach-Template einbetten** — sind interne Doku, nicht Marketing.
- **Keinen Auto-Delete alter Bilder** einbauen — Field-Member hat Foto vor 6 Monaten gemacht, ist der einzige verlässliche Beleg für „damals war noch kein Solar drauf".
- **Keine Assignee-Automatik überschreiben** — wenn der Admin einen selbst-angelegten Lead an einen anderen Kollegen re-assignt, bleibt das so. `assigned_to = self` gilt nur bei der initialen Anlage.
- **Keinen `NOT NULL`-Constraint auf `caption`** — die meisten Bilder haben keine Beschriftung, und das ist okay.
- **Keine HEIC-Konvertierung server-seitig** in Version 1 — Browser-lib reicht und spart Worker-CPU. Falls doch nötig: `sharp` mit `libheif` würde funktionieren, ist aber zusätzliche Deployment-Komplexität.

## Cross-cutting Concerns

### Sicherheit

- **Storage-Bucket privat + signierte URLs** — Fotos von Firmendächern sind sensibel, dürfen nicht öffentlich indexierbar sein.
- **`hasLeadAccess()`-Gate auf allen Image-Endpoints** — konsistent mit dem Rest der Codebase. Verhindert dass User A Bilder von User B's Leads sieht/löscht.
- **Datei-Content-Validation** server-side per magic bytes (nicht nur MIME-Header) — sonst könnte man `.exe` als `.jpg` umbenannt hochladen.
- **Rate-Limiting** auf Upload-Endpoint: max 30 Uploads pro Minute pro User. Verhindert versehentliche „Kamera-Rollen-Dump"-Aktionen.
- **DSGVO:** Aufnahme von erkennbaren Personen im Hintergrund von Dachfotos → im Onboarding-Text der Field-Members einen Hinweis „Bitte keine Personen fotografieren, nur Gebäude und Sachen".

### Skalierbarkeit

- **Erwartetes Volumen Bilder:** 5 Field-Members × ~10 Bilder pro Woche = 50 Bilder/Woche = 2.600/Jahr. Bei durchschnittlich 2 MB pro Bild → ~5 GB/Jahr. Absolut unkritisch für Supabase Storage.
- **Erwartetes Volumen Leads (manuell):** 5 Field-Members × ~5 manuelle Leads/Woche = 25/Woche = 1.300/Jahr. Insignifikant im Vergleich zu Discovery (10.000+ pro Kampagne).
- **DB-Impact:** eine neue Tabelle `lead_images`, index auf `(lead_id, uploaded_at)`. Kein Performance-Risiko.
- **Enrichment-Queue:** Solar-Assessment + Firecrawl brauchen ~30-60s pro Lead. Bei 5 gleichzeitig anlegenden Field-Members → 3 Min Queue-Wartezeit. Akzeptabel.

### Kompatibilität

- **Bestehende Discovery-Kampagnen** bleiben unberührt — `source='manual_user'` ist ein neuer Diskriminator, alle Statistik-Routen filtern schon nach `source`.
- **Admin-Sicht `/admin/leads`** zeigt neu-angelegte Field-Member-Leads automatisch mit der Assignee-Email in der Owner-Spalte. Kein Sonderfall nötig.
- **LinkedIn-Pool-Autosync + Email-Batches** — greifen automatisch auch auf manuell-angelegte Leads zu (die existing_solar/roof-area-Filter bleiben aktiv).

### Beobachtbarkeit

- **Neue Rows in `system_health_events`** für jede manuelle Lead-Anlage: `kind='info', source='field_member_lead_create'` — damit im Health-Dashboard sichtbar ist, wie aktiv die Field-Members das Feature nutzen.
- **Storage-Quota-Alarm** — wenn Bucket > 80 % voll, Email an Admin. Wird via existing Watchdog-Cron gecheckt.

### Rollout-Strategie

Zwei getrennte Deploys, damit Feature 2 nicht Feature 1 blockiert wenn Storage-Setup länger dauert.

**Phase 1: Lead-Anlage** (geschätzt ~1 Tag Arbeit)
1. Migration `source='manual_user'` (falls ENUM)
2. `createFieldMemberLead()` Server-Action
3. `LeadCreateForm` Component
4. `/dashboard/leads/new` Route + Button auf `/dashboard/leads`
5. Test mit Gisela als Probeuser

**Phase 2: Bilder** (geschätzt ~1-2 Tage Arbeit)
1. Migration `lead_images` Tabelle
2. Supabase Storage Bucket `lead-images` erstellen + RLS
3. API-Routes für Upload/List/Update/Delete
4. `LeadImagesGallery` Component
5. Test mobile Kamera-Upload auf iPhone/Android
6. Storage-Quota-Alarm im Watchdog

### Offene Fragen

1. **Google-Places-API-Kosten:** Autocomplete kostet ~$2,83/1000 Session-Tokens. Bei 5 Field-Members × 5 Leads/Woche = 25 Tokens = ~7 Cent/Woche. Minimal, aber im daily_api_usage tracken.
2. **HEIC-Support:** iPhone-Standardformat. Die Client-side Konvertierung via `heic2any` funktioniert in Safari/Chrome auf iOS, ist aber ~1 MB Bundle-Add. Alternative: Server-side mit `sharp`+`libheif` in einem separaten Endpoint (mehr Setup, aber schlankerer Client).
3. **Wer setzt `assigned_to` zurück auf `NULL`?** Wenn ein Field-Member einen Lead anlegt und Firma sich als „nicht interessiert" outet, soll der Lead trotzdem beim Field-Member bleiben oder in den Pool zurück? Vorschlag: bleibt bei Field-Member, aber der Status `rejected` zeigt an dass er nicht mehr aktiv bearbeitet werden muss.
4. **Sortierung im Bilder-Grid:** Chronologisch DESC (neueste zuerst) oder DESC nach Uploader-Zugehörigkeit („meine zuerst")? Vorschlag: rein chronologisch.

---

**Nächste Schritte:** Wenn dieses Konzept OK ist, würde ich mit Phase 1 (Lead-Anlage) starten, weil unabhängig deploybar und für die Field-Members sofort spürbar hilfreich. Phase 2 (Bilder) danach — braucht Supabase-Storage-Setup, das wir aktuell noch nicht nutzen.
