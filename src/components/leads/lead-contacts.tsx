"use client";

import { useState, useEffect } from "react";
import {
  Users,
  Loader2,
  Mail,
  Phone,
  Linkedin,
  RefreshCw,
  Building2,
  UserCheck,
  TrendingUp,
  Briefcase,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import type { LeadContact } from "@/types/database";

interface CompanyEnrichment {
  estimated_num_employees: number | null;
  annual_revenue: number | null;
  industry: string | null;
  description: string | null;
  linkedin_url: string | null;
}

interface LeadContactsProps {
  leadId: string;
  website: string | null;
  companyName: string;
  city: string;
  initialContacts: LeadContact[];
}

function seniorityLabel(s: string | null): string {
  switch (s) {
    case "c_suite": return "C-Suite";
    case "vp": return "VP";
    case "director": return "Director";
    case "manager": return "Manager";
    case "individual_contributor": return "Mitarbeiter";
    default: return s ?? "";
  }
}

function seniorityColor(s: string | null): string {
  switch (s) {
    case "c_suite": return "bg-purple-100 text-purple-800";
    case "vp": return "bg-blue-100 text-blue-800";
    case "director": return "bg-indigo-100 text-indigo-800";
    case "manager": return "bg-green-100 text-green-800";
    default: return "bg-slate-100 text-slate-600";
  }
}

function formatRevenue(rev: number | null): string {
  if (!rev) return "–";
  if (rev >= 1_000_000_000) return `${(rev / 1_000_000_000).toFixed(1)} Mrd. €`;
  if (rev >= 1_000_000) return `${(rev / 1_000_000).toFixed(1)} Mio. €`;
  return `${rev.toLocaleString("de-DE")} €`;
}

export function LeadContacts({
  leadId,
  website,
  companyName,
  city,
  initialContacts,
}: LeadContactsProps) {
  const { toast } = useToast();
  const [contacts, setContacts] = useState<LeadContact[]>(initialContacts);
  const [company, setCompany] = useState<CompanyEnrichment | null>(null);
  const [loading, setLoading] = useState(false);

  // Domain aus Website extrahieren (Client-Seite)
  const domain =
    website
      ? (() => {
          try {
            const url = website.includes("://") ? website : `https://${website}`;
            return new URL(url).hostname.replace(/^www\./, "");
          } catch {
            return website.replace(/^www\./, "").split("/")[0];
          }
        })()
      : null;

  const handleSearch = async () => {
    if (!domain && !companyName) {
      toast({
        title: "Keine Domain verfügbar",
        description: "Fügen Sie dem Lead eine Website hinzu, um Kontakte zu suchen.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          domain: domain ?? companyName,
          company_name: companyName,
          city,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Fehler" }));
        throw new Error(err.error);
      }

      const data = await res.json();
      setContacts(data.contacts ?? []);
      setCompany(data.company ?? null);

      if ((data.contacts ?? []).length === 0) {
        toast({
          title: "Keine Kontakte gefunden",
          description: `Für ${domain ?? companyName} wurden keine Ansprechpartner gefunden.`,
        });
      } else {
        toast({
          title: `${data.contacts.length} Kontakt${data.contacts.length !== 1 ? "e" : ""} gefunden`,
          description: `Über ${data.provider === "apollo" ? "Apollo.io" : "Mock-Daten"}`,
        });
      }
    } catch (error) {
      toast({
        title: "Suche fehlgeschlagen",
        description: error instanceof Error ? error.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Aktionsleiste */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {domain ? (
            <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded">
              {domain}
            </span>
          ) : (
            <span className="text-amber-600 text-xs">Keine Website hinterlegt</span>
          )}
        </div>
        <Button
          size="sm"
          onClick={handleSearch}
          disabled={loading}
          variant={contacts.length > 0 ? "outline" : "default"}
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : contacts.length > 0 ? (
            <RefreshCw className="mr-2 h-4 w-4" />
          ) : (
            <Users className="mr-2 h-4 w-4" />
          )}
          {loading
            ? "Suche läuft..."
            : contacts.length > 0
            ? "Neu suchen"
            : "Kontakte suchen"}
        </Button>
      </div>

      {/* Firmographics */}
      {company && (
        <div className="rounded-lg border bg-slate-50 p-4 space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2 text-slate-700">
            <Building2 className="h-4 w-4" />
            Unternehmens-Daten
          </h4>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {company.estimated_num_employees && (
              <div className="flex items-center gap-2">
                <UserCheck className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-muted-foreground">Mitarbeiter:</span>
                <span className="font-medium">
                  {company.estimated_num_employees.toLocaleString("de-DE")}
                </span>
              </div>
            )}
            {company.annual_revenue && (
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-muted-foreground">Umsatz:</span>
                <span className="font-medium">
                  {formatRevenue(company.annual_revenue)}
                </span>
              </div>
            )}
            {company.industry && (
              <div className="flex items-center gap-2 col-span-2">
                <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-muted-foreground">Branche:</span>
                <span className="font-medium">{company.industry}</span>
              </div>
            )}
            {company.linkedin_url && (
              <div className="flex items-center gap-2 col-span-2">
                <Linkedin className="h-3.5 w-3.5 text-[#0a66c2]" />
                <span className="text-muted-foreground">LinkedIn:</span>
                <a
                  href={company.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[#0a66c2] hover:underline font-medium text-xs"
                >
                  Firmenprofil öffnen
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
          {company.description && (
            <p className="text-xs text-muted-foreground leading-relaxed pt-1 border-t">
              {company.description}
            </p>
          )}
        </div>
      )}

      {/* Kontaktliste */}
      {contacts.length > 0 ? (
        <div className="space-y-3">
          {contacts.map((contact) => (
            <div
              key={contact.id}
              className="rounded-lg border bg-white p-4 space-y-2 hover:shadow-sm transition-shadow"
            >
              {/* Name + Seniority */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{contact.name}</p>
                  {contact.title && (
                    <p className="text-sm text-muted-foreground">{contact.title}</p>
                  )}
                </div>
                {contact.seniority && (
                  <Badge
                    variant="secondary"
                    className={`text-xs shrink-0 ${seniorityColor(contact.seniority)}`}
                  >
                    {seniorityLabel(contact.seniority)}
                  </Badge>
                )}
              </div>

              {/* Kontaktdaten */}
              <div className="flex flex-wrap gap-3 text-sm">
                {contact.email && (
                  <a
                    href={`mailto:${contact.email}`}
                    className="flex items-center gap-1.5 text-blue-600 hover:underline"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {contact.email}
                  </a>
                )}
                {contact.phone && (
                  <a
                    href={`tel:${contact.phone}`}
                    className="flex items-center gap-1.5 text-slate-600 hover:text-slate-900"
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {contact.phone}
                  </a>
                )}
                {contact.linkedin_url && (
                  <a
                    href={contact.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[#0a66c2] hover:underline"
                  >
                    <Linkedin className="h-3.5 w-3.5" />
                    LinkedIn
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : !loading ? (
        <div className="flex h-40 items-center justify-center rounded-lg border-2 border-dashed border-slate-200">
          <div className="text-center">
            <Users className="mx-auto h-8 w-8 text-slate-300 mb-2" />
            <p className="text-sm text-muted-foreground">
              Noch keine Kontakte gesucht.
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Klicken Sie auf „Kontakte suchen" um Ansprechpartner via Apollo.io zu finden.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
