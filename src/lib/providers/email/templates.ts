const CATEGORY_LABELS: Record<string, string> = {
  logistics: "Logistik",
  warehouse: "Lager",
  cold_storage: "Kühlhaus",
  supermarket: "Supermarkt",
  food_production: "Lebensmittelproduktion",
  manufacturing: "Fertigung",
  metalworking: "Metallverarbeitung",
  car_dealership: "Autohaus",
  hotel: "Hotel",
  furniture_store: "Möbelhaus",
  hardware_store: "Baumarkt",
  shopping_center: "Einkaufszentrum",
};

export interface OutreachTemplateData {
  contactName: string | null;
  contactTitle: string | null;
  companyName: string;
  city: string;
  category: string;
}

function getAnrede(name: string | null, title: string | null): string {
  if (!name) return "Sehr geehrte Damen und Herren";
  const lower = (title ?? "").toLowerCase();
  const isFemale =
    lower.includes("in ") ||
    lower.includes("leiterin") ||
    lower.includes("geschäftsführerin") ||
    lower.includes("direktorin");
  const salutation = isFemale ? "Sehr geehrte Frau" : "Sehr geehrter Herr";
  const lastName = name.split(" ").slice(-1)[0];
  return `${salutation} ${lastName}`;
}

export function generateOutreachEmail(data: OutreachTemplateData): {
  subject: string;
  text: string;
  html: string;
} {
  const { contactName, contactTitle, companyName, city, category } = data;
  const anrede = getAnrede(contactName, contactTitle);
  const branche = CATEGORY_LABELS[category] ?? category;

  const subject = `Pachteinnahmen für Ihr Dach – ${companyName}`;

  const text = `${anrede},

mein Name ist Thomas von GreenScout e.V. — wir sind ein gemeinnütziger Verein, der gewerbliche Dachflächen identifiziert, die wirtschaftlich stärker genutzt werden könnten.

Bei ${companyName} in ${city} sehen wir als ${branche}-Betrieb interessantes Potenzial für ein Pachtmodell:

✓ Regelmäßige Pachteinnahmen aus Ihrer Dachfläche
✓ Keine eigene Investition erforderlich
✓ Möglicher Vorteil bei den Stromkosten
✓ Kein Aufwand für Sie

Wir prüfen derzeit, ob ein solches Modell für Ihr Unternehmen wirtschaftlich Sinn ergibt — völlig unverbindlich.

Hätten Sie in den nächsten Tagen 15 Minuten für ein kurzes Gespräch?

Mit freundlichen Grüßen,
Thomas Müller
GreenScout e.V.
pachteinnahme@greenscout-ev.de

---
Wenn Sie keine weiteren E-Mails von uns erhalten möchten, antworten Sie bitte mit "Abmelden".`;

  const html = `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: Arial, sans-serif; font-size: 15px; color: #222; max-width: 600px; margin: 0 auto; padding: 20px; line-height: 1.6;">

<p>${anrede},</p>

<p>mein Name ist Thomas von <strong>GreenScout e.V.</strong> — wir sind ein gemeinnütziger Verein, der gewerbliche Dachflächen identifiziert, die wirtschaftlich stärker genutzt werden könnten.</p>

<p>Bei <strong>${companyName}</strong> in ${city} sehen wir als ${branche}-Betrieb interessantes Potenzial für ein <strong>Pachtmodell</strong>:</p>

<ul style="padding-left: 20px;">
  <li>Regelmäßige Pachteinnahmen aus Ihrer Dachfläche</li>
  <li>Keine eigene Investition erforderlich</li>
  <li>Möglicher Vorteil bei den Stromkosten</li>
  <li>Kein Aufwand für Sie</li>
</ul>

<p>Wir prüfen derzeit, ob ein solches Modell für Ihr Unternehmen wirtschaftlich Sinn ergibt — völlig unverbindlich.</p>

<p><strong>Hätten Sie in den nächsten Tagen 15 Minuten für ein kurzes Gespräch?</strong></p>

<p>Mit freundlichen Grüßen,<br>
Thomas Müller<br>
GreenScout e.V.<br>
<a href="mailto:pachteinnahme@greenscout-ev.de">pachteinnahme@greenscout-ev.de</a></p>

<hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
<p style="font-size: 12px; color: #999;">
Wenn Sie keine weiteren E-Mails von uns erhalten möchten, antworten Sie bitte mit "Abmelden".
GreenScout e.V. | Deutschland
</p>

</body>
</html>`;

  return { subject, text, html };
}
