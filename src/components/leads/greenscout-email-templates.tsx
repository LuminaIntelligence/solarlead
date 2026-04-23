"use client";

import { useState } from "react";
import { Copy, Check, Mail, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface GreenScoutEmailTemplatesProps {
  contactName: string | null;
  contactEmail: string | null;
  contactTitle: string | null;
  roofAreaM2: number | null;
  companyName: string;
  city: string;
}

function detectSalutation(title: string | null): "Herr" | "Frau" | "Herr/Frau" {
  const t = (title ?? "").toLowerCase();
  const femaleIndicators = ["in ", "inhaberin", "geschäftsführerin", "direktorin", "leiterin", "vorständin", "frau "];
  const maleIndicators = ["inhaber", "geschäftsführer", "direktor", "leiter", "vorstand", "herr "];
  if (femaleIndicators.some((f) => t.includes(f))) return "Frau";
  if (maleIndicators.some((m) => t.includes(m))) return "Herr";
  return "Herr/Frau";
}

function buildSalutationLine(salutation: "Herr" | "Frau" | "Herr/Frau", lastName: string | null): string {
  const name = lastName ?? "XXXXXXXXX";
  return `Guten Tag ${salutation} ${name},`;
}

function getLastName(fullName: string | null): string | null {
  if (!fullName) return null;
  const parts = fullName.trim().split(" ");
  return parts[parts.length - 1];
}

function formatLease(roofAreaM2: number): string {
  // Schätzung: ~4 €/m²/Jahr, gerundet auf 500 €
  const raw = roofAreaM2 * 4;
  const rounded = Math.round(raw / 500) * 500;
  return rounded.toLocaleString("de-DE");
}

function formatArea(m2: number): string {
  return Math.round(m2).toLocaleString("de-DE");
}

const SIGNATURE = `Herzliche Grüße
Sebastian Trautschold
Vorstand

Telefon: 038875 169780
E-Mail: sebastian.trautschold@greenscout-ev.de
Internet: https://www.greenscout-ev.de

GreenScout e.V.
Utechter Str. 5
19217 Utecht`;

export function GreenScoutEmailTemplates({
  contactName,
  contactEmail,
  contactTitle,
  roofAreaM2,
  companyName,
}: GreenScoutEmailTemplatesProps) {
  const [copied, setCopied] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number>(0);

  const salutation = detectSalutation(contactTitle);
  const lastName = getLastName(contactName);
  const salutationLine = buildSalutationLine(salutation, lastName);
  const area = roofAreaM2 ? formatArea(roofAreaM2) : "XXXX";
  const lease = roofAreaM2 ? formatLease(roofAreaM2) : "XX.XXX";

  const emails = [
    {
      label: "1. Erstkontakt",
      badgeColor: "bg-blue-100 text-blue-800",
      subject: `Wir möchten gerne Ihre Dachfläche pachten – keine Werbung!`,
      body: `${salutationLine}

mein Name ist Sebastian Trautschold, ich bin Vorstand der GreenScout e.V. und über einen unserer Mitglieder bin ich auf Ihre Dachfläche aufmerksam gemacht worden.

Nach meiner Ersteinschätzung wäre Ihre Dachfläche zur Anpachtung geeignet.
Gern würde ich mich hierzu einmal austauschen. Bei der Dachgröße von ${area} m² würde eine Pacht von rund ${lease} € für Sie zu erzielen sein.

Wenn das für Sie grundsätzlich interessant ist, erläutere ich Ihnen das gerne in einem kurzen Termin von 15–20 Minuten telefonisch.
Passt es Ihnen eher Anfang oder Ende der Woche?

${SIGNATURE}`,
    },
    {
      label: "2. Follow-up",
      badgeColor: "bg-yellow-100 text-yellow-800",
      subject: `Kurze Nachfrage zu Ihrer Dachfläche`,
      body: `${salutationLine}

ich wollte mich noch einmal kurz zu meiner letzten E-Mail melden.

Ihre Dachfläche ist wirtschaftlich für uns interessant.
Für Sie kann das bedeuten eine Pachteinnahme von ${lease} Euro, darüber hinaus eine mögliche Senkung Ihrer Stromkosten von bis zu 20%.

Wir verkaufen keine Solaranlagen!
Wir prüfen, ob sich Ihre Fläche für unser Modell eignet.

Ich würde mich freuen, wenn wir ins Gespräch kommen, dazu reicht ein Kennenlerntelefonat von 15 Minuten, und wir können die Chancen für Ihr Unternehmen einordnen.

Wann würde es bei Ihnen passen?

${SIGNATURE}`,
    },
    {
      label: "3. Finale E-Mail",
      badgeColor: "bg-orange-100 text-orange-800",
      subject: `Wir haben uns bisher verpasst`,
      body: `${salutationLine}

leider haben wir uns bisher verpasst.

Nach meiner Ersteinschätzung wäre Ihre Dachfläche zur Anpachtung geeignet. Bei einer Dachgröße von ${area} m² läge das Potenzial bei rund ${lease} € Dachpacht. Zusätzlich prüfen wir, ob sich für Ihr Unternehmen ein wirtschaftlicher Vorteil bei den Stromkosten darstellen lässt.

Gern würde ich mich hierzu einmal mit Ihnen austauschen. Wenn das für Sie grundsätzlich interessant ist, erläutere ich Ihnen das gerne in einem kurzen Termin von 15–20 Minuten telefonisch.

Über Ihr Feedback würde ich mich freuen.

${SIGNATURE}`,
    },
  ];

  function handleCopy(idx: number, subject: string, body: string) {
    const full = `Betreff: ${subject}\n\n${body}`;
    navigator.clipboard.writeText(full).then(() => {
      setCopied(idx);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 pb-1">
        <Mail className="h-5 w-5 text-[#6B8F47]" />
        <h3 className="font-semibold text-base">E-Mail-Vorlagen (GreenScout e.V.)</h3>
        {contactName && (
          <span className="text-sm text-muted-foreground">
            für <strong>{contactName}</strong>
            {roofAreaM2 && (
              <> · {area} m² · <span className="text-[#6B8F47] font-medium">~{lease} €/Jahr</span></>
            )}
          </span>
        )}
      </div>

      {emails.map((email, idx) => (
        <Card key={idx} className="border-l-4" style={{ borderLeftColor: idx === 0 ? "#3b82f6" : idx === 1 ? "#eab308" : "#f97316" }}>
          <CardHeader className="pb-2 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Badge className={`text-xs shrink-0 ${email.badgeColor} border-0`}>{email.label}</Badge>
                <span className="text-sm font-medium text-muted-foreground truncate">
                  Betreff: {email.subject}
                </span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {contactEmail && (
                  <a
                    href={`mailto:${contactEmail}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`}
                    className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 hover:underline"
                    title="In E-Mail-Programm öffnen"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Öffnen
                  </a>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => handleCopy(idx, email.subject, email.body)}
                >
                  {copied === idx ? (
                    <><Check className="h-3.5 w-3.5 text-green-500" /> Kopiert!</>
                  ) : (
                    <><Copy className="h-3.5 w-3.5" /> Kopieren</>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setExpanded(expanded === idx ? -1 : idx)}
                >
                  {expanded === idx
                    ? <ChevronUp className="h-4 w-4" />
                    : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </CardHeader>

          {expanded === idx && (
            <CardContent className="pt-0 pb-4">
              <div className="bg-slate-50 rounded-lg border p-4 mt-1">
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                  Betreff: {email.subject}
                </p>
                <pre className="text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">
                  {email.body}
                </pre>
              </div>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
