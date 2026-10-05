"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/use-toast";
import { FollowUpDateDialog } from "@/components/leads/follow-up-date-dialog";
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
  { value: "follow_up", label: "Wiedervorlage" },
  { value: "qualified", label: "Qualifiziert" },
  { value: "rejected", label: "Abgelehnt" },
  { value: "existing_solar", label: "☀️ Bereits Solar vorhanden" },
];

interface LeadStatusEditorProps {
  leadId: string;
  currentStatus: LeadStatus;
  companyName?: string;
  currentNextContactDate?: string | null;
}

export function LeadStatusEditor({
  leadId,
  currentStatus,
  companyName,
  currentNextContactDate,
}: LeadStatusEditorProps) {
  const [isPending, startTransition] = useTransition();
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  async function applyStatus(status: LeadStatus, nextContactDate?: string | null) {
    const payload: Record<string, string | null> = { status };
    if (nextContactDate !== undefined) payload.next_contact_date = nextContactDate;
    // Wenn kein follow_up mehr, Datum löschen
    if (status !== "follow_up" && nextContactDate === undefined) {
      payload.next_contact_date = null;
    }

    const res = await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      toast({
        title: "Status aktualisiert",
        description:
          status === "follow_up" && nextContactDate
            ? `Wiedervorlage am ${new Date(nextContactDate).toLocaleDateString("de-DE")}`
            : `Lead-Status geändert.`,
      });
      router.refresh();
    } else {
      toast({
        title: "Fehler",
        description: "Status konnte nicht aktualisiert werden.",
        variant: "destructive",
      });
    }
  }

  function handleStatusChange(value: string) {
    const status = value as LeadStatus;
    if (status === "follow_up") {
      setFollowUpOpen(true);
      return;
    }
    startTransition(() => applyStatus(status));
  }

  return (
    <>
      <Select
        value={currentStatus}
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
      <FollowUpDateDialog
        open={followUpOpen}
        companyName={companyName}
        defaultDate={currentNextContactDate}
        onConfirm={(date) => {
          setFollowUpOpen(false);
          startTransition(() => applyStatus("follow_up", date));
        }}
        onCancel={() => setFollowUpOpen(false)}
      />
    </>
  );
}
