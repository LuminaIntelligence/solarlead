import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  MapPin,
  Globe,
  Phone,
  Mail,
  Sun,
  Zap,
  Leaf,
  PanelTop,
  ArrowLeft,
  Tag,
  Hash,
  Clock,
  BarChart3,
  FileText,
  Search,
  MessageSquare,
  Users,
} from "lucide-react";
import { getLead } from "@/lib/actions/leads";
import { calculateScore, generateOutreachNotes } from "@/lib/scoring";
import type { ScoringBreakdown } from "@/lib/scoring/types";
import type { LeadWithRelations } from "@/types/database";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { LeadStatusEditor } from "@/components/leads/lead-status-editor";
import { LeadContacts } from "@/components/leads/lead-contacts";
import { LeadActivities } from "@/components/leads/lead-activities";
import { LeadCrmSidebar } from "@/components/leads/lead-crm-sidebar";
import { GreenScoutEmailTemplates } from "@/components/leads/greenscout-email-templates";

const CATEGORY_LABELS: Record<string, string> = {
  logistics: "Logistik",
  warehouse: "Lager",
  cold_storage: "Kühlhaus",
  manufacturing: "Produktion",
  retail: "Einzelhandel",
  supermarket: "Supermarkt",
  shopping_center: "Einkaufszentrum",
  office: "Büro",
  hotel: "Hotel",
  hospital: "Krankenhaus",
  school: "Schule",
  university: "Universität",
  agriculture: "Landwirtschaft",
  parking: "Parkhaus",
  data_center: "Rechenzentrum",
  industrial: "Industrie",
  commercial: "Gewerbe",
};

function formatCategory(category: string): string {
  return CATEGORY_LABELS[category] ?? category
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatEnergy(kwh: number): string {
  if (kwh >= 1000) {
    return `${(kwh / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MWh`;
  }
  return `${kwh.toLocaleString()} kWh`;
}

function formatArea(m2: number): string {
  return `${m2.toLocaleString(undefined, { maximumFractionDigits: 0 })} m\u00B2`;
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-600";
}

function scoreBg(score: number): string {
  if (score >= 75) return "bg-green-500";
  if (score >= 50) return "bg-yellow-500";
  return "bg-red-500";
}

// Rendert die Vertriebsanweisung mit strukturierter Darstellung
function OutreachNotesRenderer({ notes }: { notes: string }) {
  // Abschnitte anhand von "---" trennen
  const sections = notes.split(/\n---\n/);

  return (
    <div className="space-y-4">
      {sections.map((section, idx) => {
        // Titel-Zeile extrahieren (beginnt mit # oder ##)
        const lines = section.trim().split('\n');
        const titleLine = lines.find(l => l.startsWith('#'));
        const isMain = titleLine?.startsWith('# ');
        const title = titleLine?.replace(/^#+\s*/, '') ?? '';
        const body = lines.filter(l => l !== titleLine).join('\n').trim();

        if (isMain) {
          return (
            <div key={idx} className="rounded-lg border-2 border-primary/20 bg-primary/5 p-4">
              <h2 className="text-lg font-bold text-primary">{title}</h2>
            </div>
          );
        }

        // Priorität-Badge
        const isPrio = body.startsWith('► HOCH') || body.startsWith('► BEDINGT') || body.startsWith('► EHER');
        const prioColor = body.startsWith('► HOCH') ? 'bg-green-100 text-green-800 border-green-200'
          : body.startsWith('► BEDINGT') ? 'bg-yellow-100 text-yellow-800 border-yellow-200'
          : 'bg-red-100 text-red-800 border-red-200';

        // Code-Blöcke erkennen (Telefonskript, E-Mail)
        const hasCode = body.includes('```');

        return (
          <Card key={idx}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-muted-foreground">{title}</CardTitle>
            </CardHeader>
            <CardContent>
              {isPrio && (
                <div className={`inline-block rounded-md border px-3 py-1.5 text-sm font-semibold mb-3 ${prioColor}`}>
                  {body.split('\n')[0].replace('► ', '')}
                </div>
              )}
              {hasCode ? (
                <div className="space-y-2">
                  {body.split('```').map((part, i) => {
                    if (i % 2 === 1) {
                      return (
                        <pre key={i} className="rounded-md bg-slate-900 text-slate-100 p-4 text-xs leading-relaxed whitespace-pre-wrap overflow-x-auto">
                          {part.trim()}
                        </pre>
                      );
                    }
                    return part.trim() ? <MarkdownBlock key={i} text={part.trim()} /> : null;
                  })}
                </div>
              ) : (
                <MarkdownBlock text={isPrio ? body.split('\n').slice(1).join('\n').trim() : body} />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// Einfaches Markdown-Rendering (Listen, Fettschrift, Tabellen)
function MarkdownBlock({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split('\n');

  // Tabellen-Erkennung
  if (lines.some(l => l.startsWith('|'))) {
    const tableLines = lines.filter(l => l.startsWith('|') && !l.match(/^\|[-\s|]+\|$/));
    const others = lines.filter(l => !l.startsWith('|'));
    return (
      <div className="space-y-2">
        {others.length > 0 && <MarkdownBlock text={others.join('\n')} />}
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <tbody>
              {tableLines.map((row, i) => {
                const cells = row.split('|').filter(c => c.trim() !== '');
                return (
                  <tr key={i} className={i === 0 ? 'bg-slate-50 font-medium' : 'border-t'}>
                    {cells.map((cell, j) => (
                      <td key={j} className="px-3 py-1.5 text-sm" dangerouslySetInnerHTML={{
                        __html: cell.trim().replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                      }} />
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1 text-sm">
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1" />;
        // Listen-Eintrag
        const isList = line.match(/^[-•►*]\s+/) || line.match(/^\d+\.\s+/);
        const isStrong = line.startsWith('**');
        const html = line
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/`(.+?)`/g, '<code class="bg-slate-100 px-1 rounded text-xs">$1</code>');
        if (isList) {
          return (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-muted-foreground mt-0.5 shrink-0">
                {line.match(/^\d+\./) ? line.match(/^\d+\./)?.[0] : '•'}
              </span>
              <span
                className="leading-relaxed text-slate-700"
                dangerouslySetInnerHTML={{ __html: html.replace(/^[-•►*\d.]+\s+/, '') }}
              />
            </div>
          );
        }
        return (
          <p
            key={i}
            className={`leading-relaxed ${isStrong ? 'font-semibold' : 'text-slate-700'}`}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
}

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const lead = await getLead(id);

  if (!lead) {
    redirect("/dashboard/leads");
  }

  const solarData = lead.solar_assessments?.[0] ?? null;
  const enrichmentData = lead.lead_enrichment?.[0] ?? null;
  const contactsData = lead.lead_contacts ?? [];
  const activitiesData = lead.lead_activities ?? [];

  const scoring: ScoringBreakdown = calculateScore({
    category: lead.category,
    solarData: solarData
      ? {
          solar_quality: solarData.solar_quality,
          max_array_panels_count: solarData.max_array_panels_count,
          max_array_area_m2: solarData.max_array_area_m2,
          annual_energy_kwh: solarData.annual_energy_kwh,
        }
      : null,
    enrichmentData: enrichmentData
      ? {
          detected_keywords: enrichmentData.detected_keywords,
          enrichment_score: enrichmentData.enrichment_score,
        }
      : null,
    hasWebsite: !!lead.website,
    hasPhone: !!lead.phone,
    hasEmail: !!lead.email,
  });

  const outreachNotes = generateOutreachNotes(
    { company_name: lead.company_name, category: lead.category, city: lead.city },
    scoring,
    solarData
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard/leads"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück zu Leads
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {lead.company_name}
          </h1>
          <p className="text-muted-foreground mt-1">
            {formatCategory(lead.category)} &middot; {lead.city}, {lead.country}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className={`text-4xl font-bold ${scoreColor(lead.total_score)}`}
          >
            {lead.total_score}
          </div>
          <div className="text-sm text-muted-foreground leading-tight">
            / 100
            <br />
            Score
          </div>
        </div>
      </div>

      {/* Main layout: tabs + sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Tabs area */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="overview" className="gap-1.5">
              <Building2 className="h-4 w-4" />
              Übersicht
            </TabsTrigger>
            <TabsTrigger value="solar" className="gap-1.5">
              <Sun className="h-4 w-4" />
              Solar
            </TabsTrigger>
            <TabsTrigger value="contacts" className="gap-1.5">
              <Users className="h-4 w-4" />
              Kontakte
              {contactsData.length > 0 && (
                <span className="ml-1 rounded-full bg-green-500 text-white text-xs px-1.5 py-0.5 leading-none">
                  {contactsData.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="activities" className="gap-1.5">
              <Clock className="h-4 w-4" />
              Aktivitäten
              {activitiesData.length > 0 && (
                <span className="ml-1 rounded-full bg-blue-500 text-white text-xs px-1.5 py-0.5 leading-none">
                  {activitiesData.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="enrichment" className="gap-1.5">
              <Search className="h-4 w-4" />
              Anreicherung
            </TabsTrigger>
            <TabsTrigger value="outreach" className="gap-1.5">
              <MessageSquare className="h-4 w-4" />
              Vertrieb
            </TabsTrigger>
          </TabsList>

          {/* Tab: Overview */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Company Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Building2 className="h-5 w-5" />
                    Unternehmensinformationen
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <InfoRow
                    icon={<Building2 className="h-4 w-4" />}
                    label="Name"
                    value={lead.company_name}
                  />
                  <InfoRow
                    icon={<Tag className="h-4 w-4" />}
                    label="Kategorie"
                    value={formatCategory(lead.category)}
                  />
                  <InfoRow
                    icon={<MapPin className="h-4 w-4" />}
                    label="Adresse"
                    value={`${lead.address}${lead.postal_code ? `, ${lead.postal_code}` : ""}`}
                  />
                  <InfoRow
                    icon={<MapPin className="h-4 w-4" />}
                    label="Stadt"
                    value={`${lead.city}, ${lead.country}`}
                  />
                  {lead.website && (
                    <InfoRow
                      icon={<Globe className="h-4 w-4" />}
                      label="Webseite"
                      value={
                        <a
                          href={
                            lead.website.startsWith("http")
                              ? lead.website
                              : `https://${lead.website}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline truncate block max-w-[200px]"
                        >
                          {lead.website}
                        </a>
                      }
                    />
                  )}
                  {lead.phone && (
                    <InfoRow
                      icon={<Phone className="h-4 w-4" />}
                      label="Telefon"
                      value={lead.phone}
                    />
                  )}
                  {lead.email && (
                    <InfoRow
                      icon={<Mail className="h-4 w-4" />}
                      label="E-Mail"
                      value={
                        <a
                          href={`mailto:${lead.email}`}
                          className="text-blue-600 hover:underline"
                        >
                          {lead.email}
                        </a>
                      }
                    />
                  )}
                  {lead.place_id && (
                    <InfoRow
                      icon={<Hash className="h-4 w-4" />}
                      label="Place ID"
                      value={
                        <span className="text-xs font-mono text-muted-foreground truncate block max-w-[200px]">
                          {lead.place_id}
                        </span>
                      }
                    />
                  )}
                  <InfoRow
                    icon={<FileText className="h-4 w-4" />}
                    label="Quelle"
                    value={
                      <Badge variant="outline">
                        {lead.source === "google_places" ? "Google Places" : lead.source === "csv_import" ? "CSV-Import" : lead.source === "manual" ? "Manuell" : lead.source}
                      </Badge>
                    }
                  />
                </CardContent>
              </Card>

              {/* Score Overview */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <BarChart3 className="h-5 w-5" />
                    Score-Aufschlüsselung
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="text-center">
                    <div
                      className={`text-5xl font-bold ${scoreColor(scoring.total_score)}`}
                    >
                      {scoring.total_score}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Gesamtscore
                    </p>
                  </div>

                  <Separator />

                  <ScoreBar
                    label="Unternehmenseignung"
                    score={scoring.business_score}
                    icon={<Building2 className="h-4 w-4" />}
                    explanation={scoring.explanations.business}
                  />
                  <ScoreBar
                    label="Stromverbrauch"
                    score={scoring.electricity_score}
                    icon={<Zap className="h-4 w-4" />}
                    explanation={scoring.explanations.electricity}
                  />
                  <ScoreBar
                    label="Solarpotenzial"
                    score={scoring.solar_score}
                    icon={<Sun className="h-4 w-4" />}
                    explanation={scoring.explanations.solar}
                  />
                  <ScoreBar
                    label="Vertriebsbereitschaft"
                    score={scoring.outreach_score}
                    icon={<Mail className="h-4 w-4" />}
                    explanation={scoring.explanations.outreach}
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Tab: Solar Assessment */}
          <TabsContent value="solar" className="space-y-4">
            <RoofSatelliteCard
              address={lead.address}
              postalCode={lead.postal_code ?? ""}
              city={lead.city}
              country={lead.country}
              companyName={lead.company_name}
            />
            {solarData ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-lg">
                      <Sun className="h-5 w-5" />
                      Solar-Bewertung
                    </span>
                    <SolarQualityBadge
                      quality={solarData.solar_quality}
                    />
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <StatCard
                      icon={<PanelTop className="h-5 w-5 text-blue-500" />}
                      label="Nutzbare Dachfläche"
                      value={
                        solarData.max_array_area_m2 != null
                          ? formatArea(solarData.max_array_area_m2)
                          : "N/A"
                      }
                    />
                    <StatCard
                      icon={<PanelTop className="h-5 w-5 text-indigo-500" />}
                      label="Max. Panele"
                      value={
                        solarData.max_array_panels_count != null
                          ? solarData.max_array_panels_count.toLocaleString()
                          : "N/A"
                      }
                    />
                    <StatCard
                      icon={<Zap className="h-5 w-5 text-emerald-500" />}
                      label="Anlagenleistung (kWp)"
                      value={
                        solarData.max_array_panels_count != null
                          ? `${((solarData.max_array_panels_count * (solarData.panel_capacity_watts ?? 400)) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWp`
                          : "N/A"
                      }
                    />
                    <StatCard
                      icon={<Zap className="h-5 w-5 text-yellow-500" />}
                      label="Jahresenergie"
                      value={
                        solarData.annual_energy_kwh != null
                          ? formatEnergy(solarData.annual_energy_kwh)
                          : "N/A"
                      }
                    />
                    <StatCard
                      icon={<Sun className="h-5 w-5 text-orange-500" />}
                      label="Sonnenstunden"
                      value={
                        solarData.sunshine_hours != null
                          ? `${solarData.sunshine_hours.toLocaleString()} Std.`
                          : "N/A"
                      }
                    />
                    <StatCard
                      icon={<Leaf className="h-5 w-5 text-green-500" />}
                      label="CO₂-Einsparung"
                      value={
                        solarData.carbon_offset != null
                          ? `${solarData.carbon_offset.toLocaleString()} kg/Jahr`
                          : "N/A"
                      }
                    />
                    <StatCard
                      icon={<PanelTop className="h-5 w-5 text-gray-500" />}
                      label="Dachsegmente"
                      value={
                        solarData.segment_count != null
                          ? solarData.segment_count.toLocaleString()
                          : "N/A"
                      }
                    />
                  </div>

                  <Separator />

                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    Letzte Bewertung:{" "}
                    {new Date(solarData.created_at).toLocaleDateString(
                      undefined,
                      {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      }
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <Sun className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="text-muted-foreground text-lg font-medium">
                    Noch keine Solar-Bewertung vorhanden
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Führen Sie eine Solaranalyse durch, um das Dachpotenzial für diesen Lead zu sehen.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tab: Kontakte (Apollo.io) */}
          <TabsContent value="contacts" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5" />
                  Ansprechpartner
                </CardTitle>
              </CardHeader>
              <CardContent>
                <LeadContacts
                  leadId={lead.id}
                  website={lead.website}
                  companyName={lead.company_name}
                  city={lead.city}
                  initialContacts={contactsData}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Aktivitäten */}
          <TabsContent value="activities" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Clock className="h-5 w-5" />
                  Aktivitäten
                </CardTitle>
              </CardHeader>
              <CardContent>
                <LeadActivities
                  leadId={lead.id}
                  initialActivities={activitiesData}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Enrichment */}
          <TabsContent value="enrichment" className="space-y-4">
            {enrichmentData ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Search className="h-5 w-5" />
                    Website-Anreicherung
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {enrichmentData.website_title && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">
                        Website-Titel
                      </p>
                      <p className="text-sm">{enrichmentData.website_title}</p>
                    </div>
                  )}
                  {enrichmentData.meta_description && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">
                        Meta-Beschreibung
                      </p>
                      <p className="text-sm">
                        {enrichmentData.meta_description}
                      </p>
                    </div>
                  )}
                  {enrichmentData.detected_keywords.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">
                        Erkannte Schlüsselwörter
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {enrichmentData.detected_keywords.map((kw) => (
                          <Badge key={kw} variant="secondary">
                            {kw}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  <Separator />
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Anreicherungs-Score
                    </span>
                    <span className="font-semibold">
                      {enrichmentData.enrichment_score}/100
                    </span>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="py-12 text-center">
                  <Search className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
                  <p className="text-muted-foreground text-lg font-medium">
                    Noch keine Anreicherungsdaten vorhanden
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Reichern Sie diesen Lead an, um Website- und Keyword-Daten zu sammeln.
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Tab: Outreach */}
          <TabsContent value="outreach" className="space-y-6">
            {/* GreenScout E-Mail-Vorlagen */}
            <Card>
              <CardContent className="pt-5">
                <GreenScoutEmailTemplates
                  contactName={contactsData[0]?.name ?? null}
                  contactEmail={contactsData[0]?.email ?? null}
                  contactTitle={contactsData[0]?.title ?? null}
                  roofAreaM2={solarData?.max_array_area_m2 ?? null}
                  companyName={lead.company_name}
                  city={lead.city}
                />
              </CardContent>
            </Card>

            {/* KI-Vertriebsanalyse */}
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 px-1">
                KI-Vertriebsanalyse
              </h3>
              <OutreachNotesRenderer notes={outreachNotes} />
            </div>
          </TabsContent>
        </Tabs>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <LeadStatusEditor
                leadId={lead.id}
                currentStatus={lead.status}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">CRM</CardTitle>
            </CardHeader>
            <CardContent>
              <LeadCrmSidebar
                leadId={lead.id}
                nextContactDate={lead.next_contact_date ?? null}
                winProbability={lead.win_probability ?? null}
                currentNotes={lead.notes ?? ""}
                currentLinkedIn={lead.linkedin_url ?? ""}
                companyName={lead.company_name}
                city={lead.city}
              />
            </CardContent>
          </Card>

          <Link
            href="/dashboard/leads"
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Zurück zu Leads
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper sub-components                                              */
/* ------------------------------------------------------------------ */

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm font-medium">{value}</div>
      </div>
    </div>
  );
}

function ScoreBar({
  label,
  score,
  icon,
  explanation,
}: {
  label: string;
  score: number;
  icon: React.ReactNode;
  explanation: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className={`font-semibold ${scoreColor(score)}`}>{score}</span>
      </div>
      <Progress value={score} className="h-2" />
      <p className="text-xs text-muted-foreground">{explanation}</p>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border p-3 space-y-1">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function RoofSatelliteCard({
  address,
  postalCode,
  city,
  country,
  companyName,
}: {
  address: string;
  postalCode: string;
  city: string;
  country: string;
  companyName: string;
}) {
  const apiKey = process.env.GOOGLE_MAPS_STATIC_API_KEY;
  const fullAddress = [address, postalCode, city, country].filter(Boolean).join(", ");
  const encodedAddress = encodeURIComponent(fullAddress);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;

  if (!apiKey) return null;

  const imageUrl =
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?center=${encodedAddress}` +
    `&zoom=17` +
    `&size=640x480` +
    `&scale=2` +
    `&maptype=satellite` +
    `&markers=color:red%7Csize:mid%7C${encodedAddress}` +
    `&key=${apiKey}`;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-lg">
          <span className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Dachfläche — Satellitenansicht
          </span>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm font-normal text-blue-500 hover:text-blue-600 transition-colors"
          >
            <Globe className="h-4 w-4" />
            In Google Maps öffnen
          </a>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{fullAddress}</p>
      </CardHeader>
      <CardContent className="p-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={`Satellitenansicht Dach – ${companyName}`}
          className="w-full h-auto"
          loading="lazy"
        />
      </CardContent>
    </Card>
  );
}

function SolarQualityBadge({ quality }: { quality: string | null }) {
  const q = (quality ?? "").toUpperCase();
  let variant: "default" | "secondary" | "destructive" | "outline" =
    "secondary";
  let className = "";

  if (q === "HIGH") {
    className = "bg-green-100 text-green-800 border-green-200";
  } else if (q === "MEDIUM") {
    className = "bg-yellow-100 text-yellow-800 border-yellow-200";
  } else if (q === "LOW") {
    className = "bg-red-100 text-red-800 border-red-200";
  }

  return (
    <Badge variant="outline" className={className}>
      {q === "HIGH" ? "HOHE" : q === "MEDIUM" ? "MITTLERE" : q === "LOW" ? "NIEDRIGE" : "UNBEKANNTE"} Solarqualität
    </Badge>
  );
}
