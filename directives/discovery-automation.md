# Discovery Automation — Operations Guide

> Guide für die automatisierte Lead-Suche. Bei Problemen **zuerst hier reinschauen**, dann Health-Dashboard, dann Server-Logs.

## Architektur in einem Satz

Eine Kampagne wird in **search_cells** zerlegt (ein Geo-Punkt × eine Kategorie = eine Cell), und ein **Cron-Tick** auf dem Server arbeitet diese alle 5 Minuten Stück für Stück ab. **Status persistiert in der DB**, daher kann der Server jederzeit neu starten ohne Datenverlust.

## Server-Setup (einmalig)

### 1. Migrations ausführen

Im **Supabase SQL-Editor** in dieser Reihenfolge ausführen (alle sind idempotent, doppeltes Ausführen ist sicher):

```bash
# Bisherige Security-Fixes (falls noch nicht angewendet)
supabase/migrations/20260502_contact_search_status.sql
supabase/migrations/20260503_user_role_db_backed.sql

# Discovery Automation
supabase/migrations/20260504_discovery_automation.sql
```

### 2. Cron-Job auf dem Server einrichten

SSH zum Server und `crontab -e`:

```cron
# SolarLead — Discovery Tick alle 5 Minuten
*/5 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/discovery-tick > /dev/null 2>&1
```

`$CRON_SECRET` muss in der Crontab ENV verfügbar sein. Entweder:
- Crontab-Variable: `CRON_SECRET=xxxxx` als erste Zeile
- Direkt in den Befehl einsetzen (von `/opt/solarlead/.env.local` kopieren)

**Alternative**: Aufruf aus einem Wrapper-Script `/opt/solarlead/cron/discovery-tick.sh`, das `.env.local` lädt:

```bash
#!/usr/bin/env bash
set -euo pipefail
source /opt/solarlead/.env.local
curl -s -H "Authorization: Bearer $CRON_SECRET" \
     http://localhost:3000/api/cron/discovery-tick > /dev/null
```

```cron
*/5 * * * * /opt/solarlead/cron/discovery-tick.sh
```

### 3. Settings konfigurieren (`/admin/settings`)

| Feld | Wo | Default | Empfehlung |
|---|---|---|---|
| `user_settings.role` | DB (gesetzt durch Migration) | `user` | Admin-User auf `admin` |
| `user_settings.places_daily_budget_eur` | UI | `10` | je nach Budget — `0` = unbegrenzt |
| `user_settings.alert_email` | UI | `null` | **dringend setzen!** sonst keine E-Mail-Benachrichtigung |

**Wichtig:** Ohne `alert_email` wird das System bei kritischen Fehlern (API-Key abgelaufen, Budget aufgebraucht) niemand informieren — du erfährst es nur wenn du selbst auf das Health-Dashboard schaust.

## Daily Operations

### Kampagne starten

`/admin/discovery/new` → Form ausfüllen (Gebiete + Kategorien) → "Kampagne starten"

Dann sofort sichtbar:
- Cells werden in der DB angelegt (`search_cells` mit status='pending')
- Geschätzte Kosten werden zurückgegeben
- Kampagne ist in Status `running`

Der Cron-Tick übernimmt den Rest automatisch alle 5 Minuten.

### Status prüfen

`/admin/discovery/health` zeigt **alles auf einer Seite**:
- Heartbeat-Status (rot wenn Cron seit >15 Min nicht gelaufen ist)
- Cell-Counter (pending/searching/done/error)
- Tagesbudget mit Fortschrittsbalken
- Letzte Fehler nach Typ gruppiert
- Live-Event-Feed
- Aktive Kampagnen
- Cron-Setup-Snippet zum Kopieren

Der Heartbeat ist der **wichtigste Indikator**:
- 🟢 Grün + "OK — letzter Tick vor X min" = alles läuft
- 🔴 Rot + "STALE — Cron läuft nicht" = irgendwas ist kaputt → Server-Logs prüfen

### Sofort etwas pushen (statt 5 Min warten)

Auf `/admin/discovery/health` der Button **"Jetzt beschleunigen"** → öffnet einen Browser-Driven Loop, der bis 5 Min lang oder bis Queue leer ist Cells abarbeitet.

## Was tun wenn…

### Heartbeat ist STALE (rot)

1. **PM2-Logs:** `ssh solarlead@<host> "pm2 logs solarlead --lines 100 --nostream"`
2. **Cron-Logs:** `ssh solarlead@<host> "tail -50 /var/log/syslog | grep CRON"` — prüft ob der Cron überhaupt feuert
3. **Manuelles Test-Tick:**
   ```bash
   ssh solarlead@<host> "source /opt/solarlead/.env.local && curl -v -H 'Authorization: Bearer \$CRON_SECRET' http://localhost:3000/api/cron/discovery-tick"
   ```
   - 401 → CRON_SECRET stimmt nicht
   - 200 + Body → Tick läuft, aber Cron ruft ihn nicht → Crontab prüfen
   - Connection refused → App ist offline → `pm2 restart solarlead`

### Viele Fehler vom Typ `auth`

Google Places API-Key ist abgelaufen oder das Quota wurde überschritten.

1. Google Cloud Console → API & Services → Credentials prüfen
2. Quotas → "Places API (New)" → aktuelle Auslastung
3. Wenn neuer Key: in `.env.local` setzen + `pm2 restart solarlead --update-env`

### Viele Fehler vom Typ `rate_limit`

Tagesbudget Google Places erreicht. Das System pausiert automatisch bis Mitternacht. Wenn das nicht akzeptabel ist:
- `places_daily_budget_eur` in den Settings hochsetzen
- Oder akzeptieren, dass es länger dauert

### Cells stehen seit Stunden in `searching`

Das sollte nicht passieren — der Reclaim-Job in `claimNextCell` setzt Cells nach 10 Min wieder auf `pending`. Wenn doch:

```sql
UPDATE search_cells SET status='pending'
WHERE status='searching' AND last_attempt_at < NOW() - INTERVAL '10 minutes';
```

### Kampagne hängt in `running` obwohl alle Cells `done` sind

Das passiert wenn `markCompletedCampaigns()` einen Cron-Tick verpasst hat. Manuell:

```sql
UPDATE discovery_campaigns SET status='completed', completed_at=NOW()
WHERE id='<campaign_id>'
  AND NOT EXISTS (
    SELECT 1 FROM search_cells
    WHERE campaign_id='<campaign_id>'
      AND status IN ('pending','searching','error')
  );
```

## Email-Alerts

Empfänger: `user_settings.alert_email` (nur die zuerst gefundene Admin-Adresse).

Auslöser:
| Alert-Typ | Wann | Dedup-Fenster |
|---|---|---|
| `cell_repeat_failure_<kind>` | Cell hat 3 Versuche mit gleichem Fehler-Typ | 60 Min |
| `budget_exceeded` | Tagesbudget heute erreicht | 60 Min |
| `no_heartbeat` | (zukünftig — externer Watchdog) | — |

Dedup verhindert Spam: derselbe Alert-Typ wird max 1× pro Stunde verschickt. Im Health-Dashboard ist sichtbar wieviele Alerts in den letzten 24h rausgingen.

## Self-Healing

Das System repariert sich selbst in folgenden Fällen automatisch:

| Problem | Mechanismus |
|---|---|
| Server-Crash mitten in der Bearbeitung | Reclaim setzt `searching` ältere als 10 Min zurück auf `pending` |
| Transient API-Fehler (timeout, 5xx) | Cell bleibt auf `error`, wird beim nächsten Tick erneut versucht |
| Permanenter API-Fehler | Nach 8 Versuchen wird die Cell aus der Queue genommen (manuell zurücksetzen via `attempts=0`) |
| Budget aufgebraucht | Cron-Tick exit-early; nächsten Tag automatisch wieder aktiv |

## Files

| Pfad | Zweck |
|---|---|
| `src/lib/discovery/cell-generator.ts` | Areas+Categories → Cells |
| `src/lib/discovery/cell-runner.ts` | Eine Cell durchziehen (claim + search + insert + finalize) |
| `src/lib/discovery/cost-tracker.ts` | Daily API usage + Budget-Check |
| `src/lib/discovery/health-tracker.ts` | Events + Email-Alerts |
| `src/app/api/cron/discovery-tick/route.ts` | Cron-Endpoint (CRON_SECRET) |
| `src/app/api/admin/tools/discovery-run/route.ts` | Browser-Boost (admin-only) |
| `src/app/api/admin/discovery/health/route.ts` | Health-API für das Dashboard |
| `src/app/admin/discovery/health/page.tsx` | Live-Dashboard |
