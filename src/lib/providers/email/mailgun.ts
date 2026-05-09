import crypto from "crypto";

const MAILGUN_EU_BASE = "https://api.eu.mailgun.net/v3";

/** Persönliches Absender-Profil eines Nutzers */
export interface SenderProfile {
  name: string;
  title: string;
  email: string;
  phone: string;
}

export interface MailgunMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Wenn gesetzt: E-Mail erscheint als von diesem Nutzer gesendet */
  senderProfile?: SenderProfile | null;
  replyToJobId?: string;
  "o:tag"?: string[];
  "v:job-id"?: string;
}

export async function sendEmail(msg: MailgunMessage): Promise<{ id: string } | null> {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const fromAddr = process.env.MAILGUN_FROM ?? `outreach@${domain}`;

  if (!apiKey || !domain) {
    console.error("[Mailgun] Missing MAILGUN_API_KEY or MAILGUN_DOMAIN");
    return null;
  }

  // From: Nutzerprofil wenn vorhanden, sonst GreenScout-Standard
  const fromDisplay = msg.senderProfile
    ? `${msg.senderProfile.name} <${msg.senderProfile.email}>`
    : `GreenScout e.V. <${fromAddr}>`;

  const body = new URLSearchParams({
    from: fromDisplay,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });

  // Reply-To: Job-Tracking-Adresse für automatische Antwort-Erkennung.
  // Bleibt die Mailgun-Adresse — Antworten werden so weiterhin dem Job zugeordnet.
  // Die From-Adresse des Nutzers sorgt für die visuelle Maskierung beim Empfänger.
  if (msg.replyToJobId) {
    body.set("h:Reply-To", `reply+${msg.replyToJobId}@${domain}`);
  }

  if (msg["v:job-id"]) body.set("v:job-id", msg["v:job-id"]);
  if (msg["o:tag"]) msg["o:tag"].forEach((t) => body.append("o:tag", t));

  // Mailgun-natives Tracking aktivieren — liefert Events an
  // /api/webhooks/mailgun-events (Open/Click/Delivered/Bounced).
  // Mailgun setzt automatisch ein 1×1-Tracking-Pixel + rewrited Links
  // mit Redirect über mailgun.org für Click-Tracking.
  body.set("o:tracking", "yes");
  body.set("o:tracking-opens", "yes");
  // Click-Tracking nur für HTML — Plain-Text-Mails würden die
  // Redirect-URLs sonst hässlich darstellen.
  body.set("o:tracking-clicks", "htmlonly");

  const credentials = Buffer.from(`api:${apiKey}`).toString("base64");

  const res = await fetch(`${MAILGUN_EU_BASE}/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[Mailgun] Send failed ${res.status}: ${text}`);
    return null;
  }

  const data = await res.json();
  return { id: data.id ?? "" };
}

// Mailgun Webhook-Signatur verifizieren
export function verifyMailgunWebhook(
  timestamp: string,
  token: string,
  signature: string
): boolean {
  const signingKey = process.env.MAILGUN_WEBHOOK_KEY;
  if (!signingKey) return true; // Kein Key konfiguriert → nicht prüfen (dev mode)

  const value = timestamp + token;
  const expectedSig = crypto
    .createHmac("sha256", signingKey)
    .update(value)
    .digest("hex");
  return expectedSig === signature;
}
