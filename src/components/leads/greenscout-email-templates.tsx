"use client";

import { useState } from "react";
import { Copy, Check, Mail, ChevronDown, ChevronUp, Send, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { formatLease, formatArea } from "@/lib/utils/lease";

interface SenderProfile {
  name: string;
  title: string;
  email: string;
  phone: string;
}

interface GreenScoutEmailTemplatesProps {
  leadId: string;
  contactName: string | null;
  contactEmail: string | null;
  contactTitle: string | null;
  roofAreaM2: number | null;
  companyName: string;
  city: string;
  category: string;
  senderProfile?: SenderProfile | null;
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


const DEFAULT_SENDER: SenderProfile = {
  name: "Sebastian Trautschold",
  title: "Vorstand",
  email: "sebastian.trautschold@greenscout-ev.de",
  phone: "038875 169780",
};

function buildSignature(sender: SenderProfile): string {
  return `Herzliche Grüße
${sender.name}
${sender.title}

Telefon: ${sender.phone}
E-Mail: ${sender.email}
Internet: https://www.greenscout-ev.de

GreenScout e.V.
Utechter Str. 5
19217 Utecht`;
}

type TemplateType = "erstkontakt" | "followup" | "finale";

const TEMPLATE_LABELS: Record<TemplateType, string> = {
  erstkontakt: "1. Erstkontakt",
  followup: "2. Follow-up",
  finale: "3. Finale E-Mail",
};

const TEMPLATE_COLORS: Record<TemplateType, string> = {
  erstkontakt: "#3b82f6",
  followup: "#eab308",
  finale: "#f97316",
};

const TEMPLATE_BADGE: Record<TemplateType, string> = {
  erstkontakt: "bg-blue-100 text-blue-800",
  followup: "bg-yellow-100 text-yellow-800",
  finale: "bg-orange-100 text-orange-800",
};

export function GreenScoutEmailTemplates({
  leadId,
  contactName,
  contactEmail,
  contactTitle,
  roofAreaM2,
  companyName,
  city,
  category,
  senderProfile,
}: GreenScoutEmailTemplatesProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState<TemplateType | null>(null);
  const [expanded, setExpanded] = useState<TemplateType>("erstkontakt");
  const [sending, setSending] = useState<TemplateType | null>(null);
  const [sent, setSent] = useState<Set<TemplateType>>(new Set());

  const sender = senderProfile ?? DEFAULT_SENDER;
  const signature = buildSignature(sender);

  const salutation = detectSalutation(contactTitle);
  const lastName = getLastName(contactName);
  const salutationLine = buildSalutationLine(salutation, lastName);
  const area = roofAreaM2 ? formatArea(roofAreaM2) : "XXXX";
  const lease = roofAreaM2 ? formatLease(roofAreaM2) : "XX.XXX";

  const emails: Record<TemplateType, { subject: string; body: string }> = {
    erstkontakt: {
      subject: `Wir möchten gerne Ihre Dachfläche pachten – keine Werbung!`,
      body: `${salutationLine}

mein Name ist ${sender.name}, ich bin ${sender.title} der GreenScout e.V. und über einen unserer Mitglieder bin ich auf Ihre Dachfläche aufmerksam gemacht worden.

Nach meiner Ersteinschätzung wäre Ihre Dachfläche zur Anpachtung geeignet.
Gern würde ich mich hierzu einmal austauschen. Bei der Dachgröße von ${area} m² würde eine Pacht von rund ${lease} € für Sie zu erzielen sein.

Wenn das für Sie grundsätzlich interessant ist, erläutere ich Ihnen das gerne in einem kurzen Termin von 15–20 Minuten telefonisch.
Passt es Ihnen eher Anfang oder Ende der Woche?

${signature}`,
    },
    followup: {
      subject: `Kurze Nachfrage zu Ihrer Dachfläche`,
      body: `${salutationLine}

ich wollte mich noch einmal kurz zu meiner letzten E-Mail melden.

Ihre Dachfläche ist wirtschaftlich für uns interessant.
Für Sie kann das bedeuten eine Pachteinnahme von ${lease} Euro, darüber hinaus eine mögliche Senkung Ihrer Stromkosten von bis zu 20%.

Wir verkaufen keine Solaranlagen!
Wir prüfen, ob sich Ihre Fläche für unser Modell eignet.

Ich würde mich freuen, wenn wir ins Gespräch kommen, dazu reicht ein Kennenlerntelefonat von 15 Minuten, und wir können die Chancen für Ihr Unternehmen einordnen.

Wann würde es bei Ihnen passen?

${signature}`,
    },
    finale: {
      subject: `Wir haben uns bisher verpasst`,
      body: `${salutationLine}

leider haben wir uns bisher verpasst.

Nach meiner Ersteinschätzung wäre Ihre Dachfläche zur Anpachtung geeignet. Bei einer Dachgröße von ${area} m² läge das Potenzial bei rund ${lease} € Dachpacht. Zusätzlich prüfen wir, ob sich für Ihr Unternehmen ein wirtschaftlicher Vorteil bei den Stromkosten darstellen lässt.

Gern würde ich mich hierzu einmal mit Ihnen austauschen. Wenn das für Sie grundsätzlich interessant ist, erläutere ich Ihnen das gerne in einem kurzen Termin von 15–20 Minuten telefonisch.

Über Ihr Feedback würde ich mich freuen.

${signature}`,
    },
  };

  function handleCopy(type: TemplateType) {
    const email = emails[type];
    const full = `Betreff: ${email.subject}\n\n${email.body}`;
    navigator.clipboard.writeText(full).then(() => {
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  async function handleSend(type: TemplateType) {
    if (!contactEmail) return;
    setSending(type);
    try {
      const res = await fetch("/api/dashboard/outreach/send-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          contact_email: contactEmail,
          contact_name: contactName,
          contact_title: contactTitle,
          company_name: companyName,
          city,
          category,
          roof_area_m2: roofAreaM2,
          template_type: type,
        }),
      });

      const data = await res.json() as { ok?: boolean; error?: string; message?: string };

      if (res.ok && data.ok) {
        setSent((prev) => new Set(prev).add(type));
        toast({
          title: "E-Mail gesendet",
          description: data.message ?? `${TEMPLATE_LABELS[type]} an ${contactEmail} gesendet.`,
        });
      } else {
        toast({
          title: "Fehler beim Senden",
          description: data.error ?? "Unbekannter Fehler",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Fehler",
        description: "Verbindungsfehler beim Senden",
        variant: "destructive",
      });
    } finally {
      setSending(null);
    }
  }

  const templates: TemplateType[] = ["erstkontakt", "followup", "finale"];

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

      {!senderProfile && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          Keine persönliche Signatur hinterlegt — E-Mails werden mit dem Standard-Absender (Sebastian Trautschold) versendet.{" "}
          <a href="/dashboard/settings" className="underline font-medium">Signatur einrichten →</a>
        </div>
      )}

      {!contactEmail && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Kein Ansprechpartner mit E-Mail-Adresse gefunden. Bitte zuerst einen Kontakt mit E-Mail im Tab <strong>Kontakte</strong> hinterlegen.
        </div>
      )}

      {templates.map((type) => {
        const email = emails[type];
        const isSending = sending === type;
        const isSent = sent.has(type);

        return (
          <Card
            key={type}
            className="border-l-4"
            style={{ borderLeftColor: TEMPLATE_COLORS[type] }}
          >
            <CardHeader className="pb-2 pt-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge className={`text-xs shrink-0 ${TEMPLATE_BADGE[type]} border-0`}>
                    {TEMPLATE_LABELS[type]}
                  </Badge>
                  <span className="text-sm font-medium text-muted-foreground truncate">
                    {email.subject}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* Mailto-Link */}
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

                  {/* Kopieren */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1.5"
                    onClick={() => handleCopy(type)}
                  >
                    {copied === type ? (
                      <><Check className="h-3.5 w-3.5 text-green-500" /> Kopiert!</>
                    ) : (
                      <><Copy className="h-3.5 w-3.5" /> Kopieren</>
                    )}
                  </Button>

                  {/* Senden via Mailgun */}
                  {contactEmail && (
                    <Button
                      size="sm"
                      className={`h-7 text-xs gap-1.5 ${isSent ? "bg-green-600 hover:bg-green-700" : ""}`}
                      disabled={isSending || isSent}
                      onClick={() => handleSend(type)}
                    >
                      {isSending ? (
                        <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sendet…</>
                      ) : isSent ? (
                        <><Check className="h-3.5 w-3.5" /> Gesendet</>
                      ) : (
                        <><Send className="h-3.5 w-3.5" /> Senden</>
                      )}
                    </Button>
                  )}

                  {/* Expand/Collapse */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setExpanded(expanded === type ? ("" as TemplateType) : type)}
                  >
                    {expanded === type
                      ? <ChevronUp className="h-4 w-4" />
                      : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </CardHeader>

            {expanded === type && (
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
        );
      })}
    </div>
  );
}
