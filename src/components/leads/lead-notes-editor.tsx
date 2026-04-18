"use client";

import { useState, useTransition } from "react";
import { updateLead } from "@/lib/actions/leads";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, Search, Linkedin } from "lucide-react";

interface LeadNotesEditorProps {
  leadId: string;
  companyName: string;
  city: string;
  currentNotes: string;
  currentLinkedIn: string;
}

export function LeadNotesEditor({
  leadId,
  companyName,
  city,
  currentNotes,
  currentLinkedIn,
}: LeadNotesEditorProps) {
  const [notes, setNotes] = useState(currentNotes);
  const [linkedIn, setLinkedIn] = useState(currentLinkedIn);
  const [isPending, startTransition] = useTransition();
  const [searchingLinkedIn, setSearchingLinkedIn] = useState(false);
  const { toast } = useToast();

  const hasChanges =
    notes !== currentNotes || linkedIn !== currentLinkedIn;

  function handleSave() {
    startTransition(async () => {
      const result = await updateLead(leadId, {
        notes: notes || null,
        linkedin_url: linkedIn || null,
      });

      if (result) {
        toast({
          title: "Erfolgreich gespeichert",
          description: "Notizen und LinkedIn-URL aktualisiert.",
        });
      } else {
        toast({
          title: "Fehler",
          description: "Speichern fehlgeschlagen. Bitte versuchen Sie es erneut.",
          variant: "destructive",
        });
      }
    });
  }

  async function handleLinkedInSearch() {
    setSearchingLinkedIn(true);
    try {
      const res = await fetch("/api/linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          company_name: companyName,
          city: city,
        }),
      });

      if (!res.ok) {
        throw new Error("Suche fehlgeschlagen");
      }

      const data = await res.json();

      if (data.linkedin_url) {
        setLinkedIn(data.linkedin_url);
        toast({
          title: "LinkedIn-Profil gefunden",
          description: `Konfidenz: ${data.confidence === "high" ? "Hoch" : data.confidence === "medium" ? "Mittel" : "Niedrig"}${data.cached ? " (bereits gespeichert)" : ""}`,
        });
      } else {
        toast({
          title: "Kein LinkedIn-Profil gefunden",
          description: "Versuchen Sie es manuell über linkedin.com.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Fehler bei LinkedIn-Suche",
        description: "Bitte versuchen Sie es später erneut.",
        variant: "destructive",
      });
    } finally {
      setSearchingLinkedIn(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="notes">Notizen</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notizen zu diesem Lead hinzufügen..."
          rows={5}
          className="resize-y"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="linkedin">LinkedIn-URL</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLinkedInSearch}
            disabled={searchingLinkedIn}
            className="h-7 text-xs gap-1.5"
          >
            {searchingLinkedIn ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            {searchingLinkedIn ? "Suche..." : "Auto-Suche"}
          </Button>
        </div>
        <div className="relative">
          <Linkedin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            id="linkedin"
            type="url"
            value={linkedIn}
            onChange={(e) => setLinkedIn(e.target.value)}
            placeholder="https://linkedin.com/company/..."
            className="pl-9"
          />
        </div>
      </div>

      <Button
        onClick={handleSave}
        disabled={isPending || !hasChanges}
        className="w-full"
        size="sm"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
        ) : (
          <Save className="h-4 w-4 mr-2" />
        )}
        {isPending ? "Wird gespeichert..." : "Speichern"}
      </Button>
    </div>
  );
}
