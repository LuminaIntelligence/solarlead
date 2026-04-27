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

/** Pacht = Dachfläche / 5 * 100, gerundet auf 100er */
function formatLease(roofAreaM2: number): string {
  const value = Math.round((roofAreaM2 / 5) * 100 / 100) * 100;
  return value.toLocaleString("de-DE");
}

function formatArea(m2: number): string {
  return Math.round(m2).toLocaleString("de-DE");
}

const SIGNATURE_TEXT = `Sebastian Trautschold
Vorstandsvorsitzender
Telefon: 038875 169780
E-Mail: sebastian.trautschold@greenscout-ev.de
Internet: https://www.greenscout-ev.de
GreenScout e.V.
Utechter Str. 5
19217 Utecht

Registriert als GreenScout eingetragener Verein, Schwerin VR 10779
Umsatzsteuer-Identifikationsnummer: DE460360934`;

const GREENSCOUT_LOGO_BASE64 = "data:image/png;base64,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";

const SIGNATURE_HTML = `
<table style="margin-top: 24px; border-top: 2px solid #1F3D2E; padding-top: 0; width: 100%; border-collapse: collapse;">
  <tr>
    <td style="font-size: 14px; color: #222; line-height: 1.8; padding-bottom: 16px;">
      <strong>Sebastian Trautschold</strong><br>
      Vorstandsvorsitzender<br>
      Telefon: 038875 169780<br>
      E-Mail: <a href="mailto:sebastian.trautschold@greenscout-ev.de" style="color: #1F3D2E;">sebastian.trautschold@greenscout-ev.de</a><br>
      Internet: <a href="https://www.greenscout-ev.de" style="color: #1F3D2E;">https://www.greenscout-ev.de</a><br>
      GreenScout e.V.<br>
      Utechter Str. 5<br>
      19217 Utecht
    </td>
  </tr>
  <tr>
    <td style="padding: 12px 0;">
      <a href="https://www.greenscout-ev.de" target="_blank" style="text-decoration: none;">
        <img src="${GREENSCOUT_LOGO_BASE64}"
             alt="GreenScout e.V."
             height="40"
             style="display: block; height: 40px; width: auto; background-color: #1F3D2E; padding: 8px 14px; border-radius: 4px;" />
      </a>
    </td>
  </tr>
  <tr>
    <td style="font-size: 12px; color: #666; line-height: 1.6; padding-top: 4px;">
      Registriert als GreenScout eingetragener Verein, Schwerin VR 10779<br>
      Umsatzsteuer-Identifikationsnummer: DE460360934
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
  <p style="margin-top: 24px;">Mit freundlichen Grüßen<br><br>Sebastian Trautschold</p>
  ${SIGNATURE_HTML}
  <p style="margin-top: 32px; font-size: 11px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px;">
    Wenn Sie keine weiteren E-Mails von uns erhalten möchten, antworten Sie bitte mit „Abmelden".
  </p>
</body>
</html>`;
}

// ─── Template 1: Erstkontakt ────────────────────────────────────────────────

function generateErstkontakt(data: OutreachTemplateData): { subject: string; text: string; html: string } {
  const { contactName, contactTitle, roofAreaM2 } = data;
  const greeting = buildGreeting(contactName, contactTitle);
  const area = roofAreaM2 ? `ca. ${formatArea(roofAreaM2)} m²` : "Ihrer Dachfläche";
  const lease = roofAreaM2 ? `${formatLease(roofAreaM2)} Euro` : "einer attraktiven Summe";

  const subject = `Wir möchten gerne Ihre Dachfläche pachten – keine Werbung!`;

  const text = `${greeting}

mein Name ist Sebastian Trautschold, ich bin Vorstand der GreenScout e.V. und über einen unserer Mitglieder bin ich auf Ihre Dachfläche aufmerksam gemacht worden.

Nach meiner Ersteinschätzung wäre Ihre Dachfläche zur Anpachtung geeignet.

Gern würde ich mich hierzu einmal austauschen. Bei der Dachgröße von ${area} würde Ihre Dachfläche eine Pacht von einer möglichen Summe von ${lease} für Sie zu erzielen sein.

Wenn das für Sie grundsätzlich interessant ist, erläutere ich Ihnen das gerne in einem kurzen Termin von 15–20 Minuten telefonisch.

Passt es Ihnen eher Anfang oder Ende der Woche?

Mit freundlichen Grüßen

Sebastian Trautschold

${SIGNATURE_TEXT}

---
Wenn Sie keine weiteren E-Mails von uns erhalten möchten, antworten Sie bitte mit „Abmelden".`;

  const html = htmlWrap(greeting, `
    <p>mein Name ist Sebastian Trautschold, ich bin Vorstand der <strong>GreenScout e.V.</strong> und über einen unserer Mitglieder bin ich auf Ihre Dachfläche aufmerksam gemacht worden.</p>
    <p>Nach meiner Ersteinschätzung wäre Ihre Dachfläche zur Anpachtung geeignet.</p>
    <p>Gern würde ich mich hierzu einmal austauschen. Bei der Dachgröße von <strong>${area}</strong> würde Ihre Dachfläche eine Pacht von einer möglichen Summe von <strong>${lease}</strong> für Sie zu erzielen sein.</p>
    <p>Wenn das für Sie grundsätzlich interessant ist, erläutere ich Ihnen das gerne in einem kurzen Termin von 15–20 Minuten telefonisch.</p>
    <p><strong>Passt es Ihnen eher Anfang oder Ende der Woche?</strong></p>
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

Mit freundlichen Grüßen

Sebastian Trautschold

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

Mit freundlichen Grüßen

Sebastian Trautschold

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
