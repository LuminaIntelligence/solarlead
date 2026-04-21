const MAILGUN_EU_BASE = "https://api.eu.mailgun.net/v3";

export interface MailgunMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  "o:tag"?: string[];
  "v:job-id"?: string;
}

export async function sendEmail(msg: MailgunMessage): Promise<{ id: string } | null> {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const from = process.env.MAILGUN_FROM ?? `GreenScout e.V. <outreach@${domain}>`;

  if (!apiKey || !domain) {
    console.error("[Mailgun] Missing MAILGUN_API_KEY or MAILGUN_DOMAIN");
    return null;
  }

  const body = new URLSearchParams({
    from: `GreenScout e.V. <${from}>`,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });

  if (msg["v:job-id"]) body.set("v:job-id", msg["v:job-id"]);
  if (msg["o:tag"]) msg["o:tag"].forEach((t) => body.append("o:tag", t));

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
