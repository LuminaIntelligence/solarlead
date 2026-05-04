"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { Separator } from "@/components/ui/separator";

interface LeadCrmSidebarProps {
  leadId: string;
  nextContactDate: string | null;
  winProbability: number | null;
  dealValue: number | null;
  currentNotes: string;
  currentLinkedIn: string;
  companyName: string;
  city: string;
}

function probabilityColor(value: number): string {
  if (value > 70) return "text-green-600";
  if (value >= 30) return "text-yellow-600";
  return "text-red-600";
}

function probabilityTrackColor(value: number): string {
  if (value > 70) return "accent-green-500";
  if (value >= 30) return "accent-yellow-500";
  return "accent-red-500";
}

export function LeadCrmSidebar({
  leadId,
  nextContactDate,
  winProbability,
  dealValue,
  currentNotes,
  currentLinkedIn,
  companyName,
  city,
}: LeadCrmSidebarProps) {
  const { toast } = useToast();

  const [probability, setProbability] = useState<number>(
    winProbability ?? 50
  );
  const [nextContact, setNextContact] = useState<string>(
    nextContactDate
      ? nextContactDate.slice(0, 10)
      : ""
  );
  // Deal value as a string so users can clear the input or type comma/dot
  const [dealValueStr, setDealValueStr] = useState<string>(
    dealValue != null ? String(dealValue) : ""
  );
  const [notes, setNotes] = useState(currentNotes);
  const [linkedin, setLinkedin] = useState(currentLinkedIn);
  const [saving, setSaving] = useState(false);
  const [linkedinSearching, setLinkedinSearching] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      // Parse deal value: accept "12.345,67" (DE) and "12345.67" (US)
      let parsedDealValue: number | null = null;
      const dvTrim = dealValueStr.trim();
      if (dvTrim) {
        const normalized = dvTrim.replace(/\./g, "").replace(",", ".");
        const n = Number(normalized);
        if (Number.isFinite(n) && n >= 0) parsedDealValue = n;
      }

      const payload: Record<string, unknown> = {
        notes: notes || null,
        linkedin_url: linkedin || null,
        win_probability: probability,
        next_contact_date: nextContact || null,
        deal_value: parsedDealValue,
      };

      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Fehler beim Speichern");
      }

      toast({
        title: "Gespeichert",
        description: "CRM-Daten wurden erfolgreich aktualisiert.",
      });
    } catch (err) {
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleLinkedInAutoSearch() {
    setLinkedinSearching(true);
    try {
      const res = await fetch("/api/linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          company_name: companyName,
          city,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Fehler bei der LinkedIn-Suche");
      }

      const data = await res.json();
      if (data.linkedin_url) {
        setLinkedin(data.linkedin_url);
        toast({
          title: "LinkedIn gefunden",
          description: "LinkedIn-URL wurde automatisch gefunden.",
        });
      } else {
        toast({
          title: "Kein Ergebnis",
          description: "Keine LinkedIn-URL gefunden.",
        });
      }
    } catch (err) {
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setLinkedinSearching(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Deal-Informationen */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Vertrieb</h4>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label htmlFor="win_probability">Gewinnwahrscheinlichkeit</Label>
            <span
              className={`text-sm font-semibold tabular-nums ${probabilityColor(probability)}`}
            >
              {probability} %
            </span>
          </div>
          <input
            id="win_probability"
            type="range"
            min={0}
            max={100}
            value={probability}
            onChange={(e) => setProbability(Number(e.target.value))}
            className={`w-full h-2 rounded-lg cursor-pointer appearance-none bg-muted ${probabilityTrackColor(probability)}`}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>0 %</span>
            <span>50 %</span>
            <span>100 %</span>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="next_contact">Nächster Kontakt</Label>
          <Input
            id="next_contact"
            type="date"
            value={nextContact}
            onChange={(e) => setNextContact(e.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="deal_value">Geschätzter Deal-Wert (€)</Label>
          <div className="relative">
            <Input
              id="deal_value"
              type="text"
              inputMode="decimal"
              value={dealValueStr}
              onChange={(e) => setDealValueStr(e.target.value)}
              placeholder="z.B. 25000"
              className="pr-8"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">€</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Leer lassen = unbekannt. Punkt oder Komma als Dezimal- oder Tausender-Trenner.
          </p>
        </div>
      </div>

      <Separator />

      {/* Notizen */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Notizen</h4>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Interne Notizen zum Lead..."
          rows={4}
        />
      </div>

      <Separator />

      {/* LinkedIn */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">LinkedIn</h4>
        <Input
          type="url"
          value={linkedin}
          onChange={(e) => setLinkedin(e.target.value)}
          placeholder="https://linkedin.com/company/..."
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={handleLinkedInAutoSearch}
          disabled={linkedinSearching}
        >
          {linkedinSearching ? "Suche läuft..." : "Auto-Suche"}
        </Button>
      </div>

      <Button
        type="button"
        className="w-full"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? "Speichern..." : "Speichern"}
      </Button>
    </div>
  );
}
