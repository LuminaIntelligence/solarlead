"use client";

import { useTransition } from "react";
import { updateLead } from "@/lib/actions/leads";
import { useToast } from "@/components/ui/use-toast";
import type { LeadStatus } from "@/types/database";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "Neu" },
  { value: "reviewed", label: "Geprüft" },
  { value: "contacted", label: "Kontaktiert" },
  { value: "qualified", label: "Qualifiziert" },
  { value: "rejected", label: "Abgelehnt" },
  { value: "existing_solar", label: "☀️ Bereits Solar vorhanden" },
];

interface LeadStatusEditorProps {
  leadId: string;
  currentStatus: LeadStatus;
}

export function LeadStatusEditor({
  leadId,
  currentStatus,
}: LeadStatusEditorProps) {
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();

  function handleStatusChange(value: string) {
    startTransition(async () => {
      const result = await updateLead(leadId, {
        status: value as LeadStatus,
      });

      if (result) {
        toast({
          title: "Status aktualisiert",
          description: `Lead-Status wurde auf "${value}" geändert.`,
        });
      } else {
        toast({
          title: "Fehler",
          description: "Status konnte nicht aktualisiert werden. Bitte versuchen Sie es erneut.",
          variant: "destructive",
        });
      }
    });
  }

  return (
    <Select
      defaultValue={currentStatus}
      onValueChange={handleStatusChange}
      disabled={isPending}
    >
      <SelectTrigger className={isPending ? "opacity-50" : ""}>
        <SelectValue placeholder="Status auswählen" />
      </SelectTrigger>
      <SelectContent>
        {STATUS_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
