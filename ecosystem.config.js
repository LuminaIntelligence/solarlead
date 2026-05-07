/**
 * Zwei-Prozess-Architektur:
 *   - solarlead-web    (3003): User-Traffic — UI, Dashboards, Admin/Team-APIs
 *   - solarlead-worker (3004): Background-Work — /api/cron/* + /api/webhooks/*
 *
 * Nginx routet pfad-basiert (siehe /etc/nginx/sites-available/solarlead).
 * Damit blockiert ein hängender Discovery-Tick / Apollo-Call / Impressum-
 * Scraper niemals die Web-Anfragen — der Web-Prozess hat seinen eigenen
 * Event-Loop, der von Background-Work komplett unbeeinflusst ist.
 *
 * Beide Prozesse:
 *   - laufen denselben Next.js-Build (.next/) aus /opt/solarlead
 *   - lesen dieselbe .env.local (Supabase, Mailgun, IMAP, Apollo, etc.)
 *   - haben max_memory_restart-Schutz
 */
module.exports = {
  apps: [
    {
      name: "solarlead-web",
      script: "npm",
      args: "start -- -p 3003",
      cwd: "/opt/solarlead",
      max_memory_restart: "800M",
      min_uptime: "60s",
      max_restarts: 10,
      listen_timeout: 10000,
      kill_timeout: 5000,
      autorestart: true,
      env: { NODE_ENV: "production" },
      error_file: "/opt/solarlead/.pm2/logs/web-error.log",
      out_file: "/opt/solarlead/.pm2/logs/web-out.log",
    },
    {
      name: "solarlead-worker",
      script: "npm",
      args: "start -- -p 3004",
      cwd: "/opt/solarlead",
      // Worker darf größer werden — Scraping/Discovery hat größere Working-Sets.
      // Bei 1.5 GB greift dann das Sicherheitsnetz.
      max_memory_restart: "1500M",
      min_uptime: "60s",
      max_restarts: 10,
      listen_timeout: 15000,
      kill_timeout: 10000,
      autorestart: true,
      env: { NODE_ENV: "production" },
      error_file: "/opt/solarlead/.pm2/logs/worker-error.log",
      out_file: "/opt/solarlead/.pm2/logs/worker-out.log",
    },
  ],
};
