"use client";

/**
 * DeleteLeadButton — small destructive button on the lead detail header.
 * Opens a confirmation dialog with the company name as a typed-confirmation
 * gate (you must type the name to enable the delete button — prevents accidents).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

interface Props {
  leadId: string;
  companyName: string;
}

export function DeleteLeadButton({ leadId, companyName }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const canDelete = confirmText.trim().toLowerCase() === companyName.trim().toLowerCase();

  async function handleDelete() {
    if (!canDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast({ title: "Lead gelöscht", description: `"${companyName}" wurde entfernt.` });
      router.push("/dashboard/leads");
      router.refresh();
    } catch (e) {
      toast({
        title: "Löschen fehlgeschlagen",
        description: e instanceof Error ? e.message : "Unbekannter Fehler",
        variant: "destructive",
      });
      setDeleting(false);
    }
  }

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
      >
        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
        Lead löschen
      </Button>
    );
  }

  // Inline confirmation modal
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => !deleting && setOpen(false)}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md mx-4 bg-white rounded-xl shadow-2xl border border-slate-200"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            <h2 className="font-semibold text-slate-900">Lead unwiderruflich löschen?</h2>
          </div>
          <button onClick={() => !deleting && setOpen(false)} className="text-slate-400 hover:text-slate-700" disabled={deleting}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <p className="text-slate-700">
            Du bist dabei <strong>&quot;{companyName}&quot;</strong> komplett zu löschen. Damit gehen auch alle damit verknüpften Daten verloren:
          </p>
          <ul className="text-xs text-slate-600 space-y-0.5 pl-4 list-disc">
            <li>Alle gespeicherten Kontakte</li>
            <li>Solar-Bewertung &amp; Anreicherungs-Daten</li>
            <li>Aktivitäten / Notizen / Follow-ups</li>
            <li>Outreach-Historie (sofern vorhanden)</li>
          </ul>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Tippe zum Bestätigen den Firmennamen exakt ein:
          </p>
          <Input
            autoFocus
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={companyName}
            disabled={deleting}
            onKeyDown={(e) => { if (e.key === "Enter" && canDelete) void handleDelete(); }}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={deleting}>
              Abbrechen
            </Button>
            <Button
              onClick={handleDelete}
              disabled={!canDelete || deleting}
              className="bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1.5" />}
              Endgültig löschen
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
