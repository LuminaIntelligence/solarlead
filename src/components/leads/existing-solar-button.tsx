"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sun } from "lucide-react";
import { updateLead } from "@/lib/actions/leads";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";

export function ExistingSolarButton({ leadId }: { leadId: string }) {
  const [isPending, startTransition] = useTransition();
  const { toast } = useToast();
  const router = useRouter();

  function handleClick() {
    if (!confirm("Diesen Lead als 'Bereits Solar vorhanden' markieren? Er wird aus allen Kampagnen ausgeschlossen.")) return;
    startTransition(async () => {
      const result = await updateLead(leadId, { status: "existing_solar" });
      if (result) {
        toast({ title: "Markiert", description: "Lead wird aus Kampagnen ausgeschlossen." });
        router.refresh();
      } else {
        toast({ title: "Fehler", description: "Konnte nicht gespeichert werden.", variant: "destructive" });
      }
    });
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      disabled={isPending}
      className="w-full border-orange-300 text-orange-700 hover:bg-orange-50 hover:text-orange-800"
    >
      <Sun className="h-4 w-4 mr-2" />
      {isPending ? "Wird gespeichert…" : "Bereits Solar vorhanden"}
    </Button>
  );
}
