# Deploy SOP — SolarLead

> Diese Datei ist die maßgebliche Quelle dafür, wie SolarLead deployed wird. Bei jedem Deploy-Task **zuerst hier reinschauen**, bevor irgendwas anderes geprüft oder erfunden wird.

## Kurzfassung

**Deploy = `git push origin master`.** Mehr nicht. GitHub Actions übernimmt den Rest automatisch.

```bash
git push origin master
```

Die Action `.github/workflows/deploy.yml` läuft an, SSH'd auf den Server, pullt, baut, restartet PM2. Dauer typisch ~1–3 Min.

## Was die Action genau tut

Trigger: `push` auf `master`.

Schritte (siehe `.github/workflows/deploy.yml`):
1. Lädt `SSH_PRIVATE_KEY` aus GitHub Secrets in einen SSH-Agent
2. Fügt `SERVER_HOST` zu `known_hosts` hinzu
3. Sync der Server-Secrets: `CRON_SECRET` aus GitHub Secrets in `/opt/solarlead/.env.local` schreiben (idempotent — `sed` falls vorhanden, sonst anhängen)
4. Deploy via SSH als User `solarlead@<SERVER_HOST>`:
   - `cd /opt/solarlead`
   - `git checkout -- package.json package-lock.json` (verwirft lokale Änderungen an Lockfiles, falls Server vorher manuell gefummelt hat)
   - `git pull origin master`
   - `npm install`
   - `rm -rf .next` (frischer Build, kein stale cache)
   - `npm run build`
   - `pm2 restart solarlead --update-env` (`--update-env` lädt aktualisierte `.env.local`)

## Manuell deployen (Notfall)

Falls die Action kaputt ist oder der Push nicht möglich:

```bash
ssh solarlead@<SERVER_HOST>
bash /opt/solarlead/deploy.sh
```

`deploy.sh` auf dem Server macht im Wesentlichen das Gleiche wie die Action (siehe `deploy.sh` im Repo-Root) — `git pull`, `npm install`, `npm run build`, `pm2 restart solarlead --update-env`. **Unterschied:** Sync der GitHub Secrets passiert nicht, also vorher manuell prüfen ob `.env.local` aktuell ist.

## Server-Setup (Referenz)

| Wert | Pfad / Name |
|---|---|
| App-Verzeichnis | `/opt/solarlead` |
| Linux-User | `solarlead` |
| PM2-Prozessname | `solarlead` |
| Env-Datei | `/opt/solarlead/.env.local` |
| Zugang | SSH-Key (privater Key in GitHub Secret `SSH_PRIVATE_KEY`) |

## GitHub Secrets (benötigt)

| Secret | Zweck |
|---|---|
| `SSH_PRIVATE_KEY` | Privater SSH-Key für `solarlead@<host>` |
| `SERVER_HOST` | Hostname/IP des Servers |
| `CRON_SECRET` | Wird vor jedem Deploy in `.env.local` synchronisiert |

Ändern: Repo → Settings → Secrets and variables → Actions.

## Status prüfen

**CI-Status (vom lokalen Rechner):**
```bash
gh run list --workflow=deploy.yml --limit 5
gh run watch
```

**Live-Status auf dem Server:**
```bash
ssh solarlead@<SERVER_HOST> "pm2 status && pm2 logs solarlead --lines 50 --nostream"
```

## Häufige Probleme

**Action schlägt im `ssh-keyscan` Step fehl** → `SERVER_HOST` Secret prüfen, ggf. neu setzen.

**`npm install` bricht ab wegen Lockfile-Konflikt** → Die Action macht extra `git checkout -- package.json package-lock.json` vorher. Falls trotzdem: lokal `npm install` laufen lassen, neuen Lockfile committen, push.

**Build OK, aber neue Version läuft nicht** → `pm2 restart solarlead --update-env` hat versagt oder `.env.local` ist veraltet. Per SSH:
```bash
ssh solarlead@<SERVER_HOST> "cd /opt/solarlead && pm2 logs solarlead --lines 100"
```

**`CRON_SECRET` stimmt nicht zwischen Cron-Jobs und App** → Die Action synchronisiert das Secret vor jedem Deploy. Wenn das schief ging, händisch in `.env.local` setzen und `pm2 restart solarlead --update-env`.

## Was Du **nicht** machen solltest

- **Kein direkter SSH-Edit von Code-Dateien.** Der nächste `git pull` würde sie überschreiben oder Konflikte produzieren.
- **Kein `force-push` auf `master`** — triggert sofort ein Deploy mit potenziell kaputtem Code.
- **Kein manuelles `npm run build` ohne anschließenden `pm2 restart`** — Build-Output landet in `.next/`, läuft aber nicht bis PM2 neu lädt.

## Rollback

Schnellster Weg: einen früheren Commit auf master pushen.

```bash
git revert <bad-commit>
git push origin master
```

Das triggert wieder die Action und stellt den vorherigen Stand her. Auf dem Server gibt es keine zweite Version zum Hot-Swap — Rollback geht nur über Git.
