export type TemplateType = "erstkontakt" | "followup" | "finale";

export interface OutreachTemplateData {
  contactName: string | null;
  contactTitle: string | null;
  companyName: string;
  city: string;
  category: string;
  roofAreaM2?: number | null;
  templateType?: TemplateType;
}

function detectSalutation(title: string | null): "Herr" | "Frau" | "Herr/Frau" {
  const t = (title ?? "").toLowerCase();
  const female = ["in ", "inhaberin", "geschäftsführerin", "direktorin", "leiterin", "vorständin", "frau "];
  const male = ["inhaber", "geschäftsführer", "direktor", "leiter", "vorstand", "herr "];
  if (female.some((f) => t.includes(f))) return "Frau";
  if (male.some((m) => t.includes(m))) return "Herr";
  return "Herr/Frau";
}

function buildGreeting(contactName: string | null, contactTitle: string | null): string {
  if (!contactName) return "Guten Tag,";
  const salutation = detectSalutation(contactTitle);
  if (salutation === "Herr/Frau") {
    // Gender unknown — use full name without title
    return `Guten Tag ${contactName.trim()},`;
  }
  const lastName = contactName.trim().split(" ").slice(-1)[0];
  return `Guten Tag ${salutation} ${lastName},`;
}

function formatLease(roofAreaM2: number): string {
  const rounded = Math.round((roofAreaM2 * 4) / 500) * 500;
  return rounded.toLocaleString("de-DE");
}

function formatArea(m2: number): string {
  return Math.round(m2).toLocaleString("de-DE");
}

const SIGNATURE_TEXT = `Herzliche Grüße
Sebastian Trautschold
Vorstand

Telefon: 038875 169780
E-Mail: sebastian.trautschold@greenscout-ev.de
Internet: https://www.greenscout-ev.de

GreenScout e.V.
Utechter Str. 5
19217 Utecht`;

const SIGNATURE_HTML = `
<table style="margin-top: 24px; border-top: 2px solid #6B8F47; padding-top: 16px;">
  <tr>
    <td style="font-size: 14px; color: #222; line-height: 1.7;">
      Herzliche Grüße<br>
      <strong>Sebastian Trautschold</strong><br>
      Vorstand<br><br>
      Telefon: 038875 169780<br>
      E-Mail: <a href="mailto:sebastian.trautschold@greenscout-ev.de" style="color: #6B8F47;">sebastian.trautschold@greenscout-ev.de</a><br>
      Internet: <a href="https://www.greenscout-ev.de" style="color: #6B8F47;">https://www.greenscout-ev.de</a><br><br>
      <strong>GreenScout e.V.</strong><br>
      Utechter Str. 5 · 19217 Utecht
    </td>
  </tr>
</table>`;

function htmlWrap(greeting: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; font-size: 15px; color: #222; max-width: 600px; margin: 0 auto; padding: 24px; line-height: 1.7;">
  <p>${greeting}</p>
  ${bodyHtml}
  ${SIGNATURE_HTML}
  <p style="margin-top: 32px; font-size: 11px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px;">
    Wenn Sie keine weiteren E-Mails von uns erhalten möchten, antworten Sie bitte mit „Abmelden".
  </p>
</body>
</html>`;
}

// ─── Template 1: Erstkontakt ────────────────────────────────────────────────

function generateErstkontakt(data: OutreachTemplateData): { subject: string; text: string; html: string } {
  const { contactName, contactTitle, companyName, roofAreaM2 } = data;
  const greeting = buildGreeting(contactName, contactTitle);
  const area = roofAreaM2 ? `${formatArea(roofAreaM2)} m²` : "Ihrer Dachfläche";
  const lease = roofAreaM2 ? `rund ${formatLease(roofAreaM2)} €` : "einer attraktiven Summe";

  const subject = `Wir möchten gerne Ihre Dachfläche pachten – keine Werbung!`;

  const text = `${greeting}

mein Name ist Sebastian Trautschold, ich bin Vorstand der GreenScout e.V. und über einen unserer Mitglieder bin ich auf Ihre Dachfläche aufmerksam gemacht worden.

Nach meiner Ersteinschätzung wäre Ihre Dachfläche zur Anpachtung geeignet.
Gern würde ich mich hierzu einmal austauschen. Bei der Dachgröße von ${area} würde eine Pacht von ${lease} für Sie zu erzielen sein.

Wenn das für Sie grundsätzlich interessant ist, erläutere ich Ihnen das gerne in einem kurzen Termin von 15–20 Minuten telefonisch.
Passt es Ihnen eher Anfang oder Ende der Woche?

${SIGNATURE_TEXT}

---
Wenn Sie keine weiteren E-Mails von uns erhalten möchten, antworten Sie bitte mit „Abmelden".`;

  const html = htmlWrap(greeting, `
    <p>mein Name ist Sebastian Trautschold, ich bin Vorstand der <strong>GreenScout e.V.</strong> und über einen unserer Mitglieder bin ich auf Ihre Dachfläche aufmerksam gemacht worden.</p>
    <p>Nach meiner Ersteinschätzung wäre Ihre Dachfläche zur Anpachtung geeignet.<br>
    Gern würde ich mich hierzu einmal austauschen. Bei der Dachgröße von <strong>${area}</strong> würde eine Pacht von <strong>${lease}</strong> für Sie zu erzielen sein.</p>
    <p>Wenn das für Sie grundsätzlich interessant ist, erläutere ich Ihnen das gerne in einem kurzen Termin von 15–20 Minuten telefonisch.<br>
    <strong>Passt es Ihnen eher Anfang oder Ende der Woche?</strong></p>
  `);

  return { subject, text, html };
}

// ─── Template 2: Follow-up ──────────────────────────────────────────────────

function generateFollowup(data: OutreachTemplateData): { subject: string; text: string; html: string } {
  const { contactName, contactTitle, roofAreaM2 } = data;
  const greeting = buildGreeting(contactName, contactTitle);
  const lease = roofAreaM2 ? `${formatLease(roofAreaM2)} Euro` : "einer attraktiven Summe";

  const subject = `Kurze Nachfrage zu Ihrer Dachfläche`;

  const text = `${greeting}

ich wollte mich noch einmal kurz zu meiner letzten E-Mail melden.

Ihre Dachfläche ist wirtschaftlich für uns interessant.
Für Sie kann das bedeuten eine Pachteinnahme von ${lease}, darüber hinaus eine mögliche Senkung Ihrer Stromkosten von bis zu 20%.

Wir verkaufen keine Solaranlagen!
Wir prüfen, ob sich Ihre Fläche für unser Modell eignet.

Ich würde mich freuen, wenn wir ins Gespräch kommen, dazu reicht ein Kennenlerntelefonat von 15 Minuten, und wir können die Chancen für Ihr Unternehmen einordnen.

Wann würde es bei Ihnen passen?

${SIGNATURE_TEXT}

---
Wenn Sie keine weiteren E-Mails von uns erhalten möchten, antworten Sie bitte mit „Abmelden".`;

  const html = htmlWrap(greeting, `
    <p>ich wollte mich noch einmal kurz zu meiner letzten E-Mail melden.</p>
    <p>Ihre Dachfläche ist wirtschaftlich für uns interessant.<br>
    Für Sie kann das bedeuten eine Pachteinnahme von <strong>${lease}</strong>, darüber hinaus eine mögliche Senkung Ihrer Stromkosten von bis zu 20%.</p>
    <p style="font-weight: bold; color: #6B8F47;">Wir verkaufen keine Solaranlagen!</p>
    <p>Wir prüfen, ob sich Ihre Fläche für unser Modell eignet.</p>
    <p>Ich würde mich freuen, wenn wir ins Gespräch kommen, dazu reicht ein Kennenlerntelefonat von 15 Minuten, und wir können die Chancen für Ihr Unternehmen einordnen.</p>
    <p><strong>Wann würde es bei Ihnen passen?</strong></p>
  `);

  return { subject, text, html };
}

// ─── Template 3: Finale E-Mail ──────────────────────────────────────────────

function generateFinale(data: OutreachTemplateData): { subject: string; text: string; html: string } {
  const { contactName, contactTitle, roofAreaM2 } = data;
  const greeting = buildGreeting(contactName, contactTitle);
  const area = roofAreaM2 ? `${formatArea(roofAreaM2)} m²` : "Ihrer Dachfläche";
  const lease = roofAreaM2 ? `rund ${formatLease(roofAreaM2)} €` : "einer attraktiven Summe";

  const subject = `Wir haben uns bisher verpasst`;

  const text = `${greeting}

leider haben wir uns bisher verpasst.

Nach meiner Ersteinschätzung wäre Ihre Dachfläche zur Anpachtung geeignet. Bei einer Dachgröße von ${area} läge das Potenzial bei ${lease} Dachpacht. Zusätzlich prüfen wir, ob sich für Ihr Unternehmen ein wirtschaftlicher Vorteil bei den Stromkosten darstellen lässt.

Gern würde ich mich hierzu einmal mit Ihnen austauschen. Wenn das für Sie grundsätzlich interessant ist, erläutere ich Ihnen das gerne in einem kurzen Termin von 15–20 Minuten telefonisch.

Über Ihr Feedback würde ich mich freuen.

${SIGNATURE_TEXT}

---
Wenn Sie keine weiteren E-Mails von uns erhalten möchten, antworten Sie bitte mit „Abmelden".`;

  const html = htmlWrap(greeting, `
    <p>leider haben wir uns bisher verpasst.</p>
    <p>Nach meiner Ersteinschätzung wäre Ihre Dachfläche zur Anpachtung geeignet. Bei einer Dachgröße von <strong>${area}</strong> läge das Potenzial bei <strong>${lease} Dachpacht</strong>. Zusätzlich prüfen wir, ob sich für Ihr Unternehmen ein wirtschaftlicher Vorteil bei den Stromkosten darstellen lässt.</p>
    <p>Gern würde ich mich hierzu einmal mit Ihnen austauschen. Wenn das für Sie grundsätzlich interessant ist, erläutere ich Ihnen das gerne in einem kurzen Termin von 15–20 Minuten telefonisch.</p>
    <p>Über Ihr Feedback würde ich mich freuen.</p>
  `);

  return { subject, text, html };
}

// ─── Main export ────────────────────────────────────────────────────────────

export function generateOutreachEmail(data: OutreachTemplateData): {
  subject: string;
  text: string;
  html: string;
} {
  const type = data.templateType ?? "erstkontakt";
  if (type === "followup") return generateFollowup(data);
  if (type === "finale") return generateFinale(data);
  return generateErstkontakt(data);
}
