"use client";

/**
 * ReassignDropdown — small UI for lead/admin to change a job's assignee.
 *
 * Options: each team member (with current workload count) plus "Pool"
 * (returns to unassigned). The currently-selected option is highlighted.
 *
 * On change, fires PATCH /api/team/jobs/[id]/assign and calls onChange
 * so the parent can refresh.
 */
import { useEffect, useState } from "react";
import { ChevronDown, Hand, Loader2, UserCheck } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

interface Member {
  id: string;
  email: string | null;
  role: string;
  open_count: number;
}

interface Props {
  jobId: string;
  currentAssigneeId: string | null;
  currentAssigneeEmail?: string | null;
  /** Called after a successful assign so the parent can refetch. */
  onChange?: () => void;
  size?: "sm" | "md";
}

export function ReassignDropdown({ jobId, currentAssigneeId, currentAssigneeEmail, onChange, size = "md" }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || members) return;
    fetch("/api/team/members")
      .then((r) => r.json())
      .then((d) => setMembers(d.members ?? []))
      .catch(() => setMembers([]));
  }, [open, members]);

  async function assign(userId: string | null) {
    setBusy(true);
    try {
      const res = await fetch(`/api/team/jobs/${jobId}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast({ title: userId ? "Zugewiesen" : "In den Pool zurückgegeben" });
      setOpen(false);
      onChange?.();
    } catch (e) {
      toast({
        title: "Fehler",
        description: e instanceof Error ? e.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const padding = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  const label = currentAssigneeEmail
    ? currentAssigneeEmail.split("@")[0]
    : "Pool";

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 rounded-md border bg-white hover:bg-slate-50 ${padding} ${
          currentAssigneeId ? "border-slate-300 text-slate-700" : "border-amber-300 text-amber-700 bg-amber-50"
        }`}
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : currentAssigneeId ? <UserCheck className="h-3 w-3" /> : <Hand className="h-3 w-3" />}
        <span className="max-w-[140px] truncate" title={currentAssigneeEmail ?? "Pool"}>{label}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-40 min-w-[260px] bg-white rounded-md shadow-lg border border-slate-200 overflow-hidden">
            {/* Pool option */}
            <button
              type="button"
              onClick={() => assign(null)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-slate-50 ${
                !currentAssigneeId ? "bg-amber-50 text-amber-800 font-semibold" : ""
              }`}
            >
              <span className="flex items-center gap-2">
                <Hand className="h-3.5 w-3.5" />
                Pool — unzugewiesen
              </span>
              {!currentAssigneeId && <span className="text-xs">✓</span>}
            </button>

            <div className="border-t border-slate-100" />

            {!members ? (
              <div className="px-3 py-3 text-xs text-slate-500 flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Lädt…
              </div>
            ) : members.length === 0 ? (
              <div className="px-3 py-3 text-xs text-slate-500">Keine Team-Mitglieder.</div>
            ) : (
              <ul className="max-h-64 overflow-auto">
                {members.map((m) => {
                  const isSelected = m.id === currentAssigneeId;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => assign(m.id)}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-slate-50 ${
                          isSelected ? "bg-blue-50 text-blue-900 font-semibold" : ""
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <UserCheck className={`h-3.5 w-3.5 ${m.role === "team_lead" ? "text-purple-500" : m.role === "admin" ? "text-amber-500" : "text-slate-400"}`} />
                          <span className="truncate">{m.email ?? m.id.slice(0, 8)}</span>
                        </span>
                        <span className="text-xs text-slate-500 tabular-nums shrink-0 ml-2">
                          {m.open_count} offen{isSelected ? " ✓" : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
