"use client";

/**
 * Kanban-Board for the reply-team workflow.
 *
 * Columns map to outcome values:
 *   New → In Bearbeitung → Termin → Rückruf → Nicht erreicht / On hold → Won/Lost
 *
 * Drag a card across a column → PATCH outcome on the server.
 * Specialists see their own + pool by default; team-leads/admins see all
 * (toggle via filter).
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
} from "@dnd-kit/core";
import { Loader2, MapPin, Clock, AlertCircle, RefreshCw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { OUTCOME_OPTIONS, outcomeMeta } from "@/lib/constants/reply-outcomes";
import type { ReplyOutcome } from "@/types/database";

interface JobCard {
  id: string;
  company_name: string | null;
  company_city: string | null;
  contact_name: string | null;
  outcome: ReplyOutcome;
  next_action_at: string | null;
  next_action_note: string | null;
  replied_at: string | null;
  last_activity_at: string | null;
  assigned_to: string | null;
  closed_value_eur: number | null;
}

// Columns shown on the board (we hide a couple of edge states; use detail page for those)
const BOARD_COLUMNS: ReplyOutcome[] = [
  "new", "in_progress", "appointment_set", "callback_requested", "not_reached", "on_hold", "closed_won", "closed_lost",
];

function timeUntil(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return `überfällig (${Math.abs(Math.floor(ms / 3600_000))}h)`;
  if (ms < 3600_000) return `in ${Math.floor(ms / 60_000)} min`;
  if (ms < 86400_000) return `in ${Math.floor(ms / 3600_000)} h`;
  return `in ${Math.floor(ms / 86400_000)} Tagen`;
}

function CardItem({ job, isOverlay }: { job: JobCard; isOverlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: job.id });
  const isOverdue = job.next_action_at && new Date(job.next_action_at) < new Date();

  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`bg-white rounded-md border border-slate-200 p-3 shadow-sm cursor-grab active:cursor-grabbing select-none ${
        isDragging ? "opacity-30" : ""
      } ${isOverlay ? "shadow-2xl ring-2 ring-blue-300 rotate-2" : ""}`}
    >
      <Link
        href={`/team/${job.id}`}
        onClick={(e) => e.stopPropagation()}
        className="font-medium text-slate-900 hover:text-blue-600 line-clamp-2 text-sm"
      >
        {job.company_name ?? "(ohne Name)"}
      </Link>
      {job.contact_name && (
        <div className="text-xs text-slate-500 truncate mt-0.5">{job.contact_name}</div>
      )}
      <div className="flex flex-wrap gap-1.5 text-[10px] mt-2">
        {job.company_city && (
          <span className="inline-flex items-center gap-0.5 text-slate-500">
            <MapPin className="h-2.5 w-2.5" />{job.company_city}
          </span>
        )}
        {job.next_action_at && (
          <span className={`inline-flex items-center gap-0.5 ${isOverdue ? "text-red-600" : "text-amber-600"}`}>
            {isOverdue ? <AlertCircle className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
            {timeUntil(job.next_action_at)}
          </span>
        )}
        {job.outcome === "closed_won" && job.closed_value_eur && (
          <span className="text-green-700 font-medium">
            €{job.closed_value_eur.toLocaleString("de-DE", { maximumFractionDigits: 0 })}
          </span>
        )}
      </div>
    </div>
  );
}

function Column({
  outcome, jobs,
}: {
  outcome: ReplyOutcome;
  jobs: JobCard[];
}) {
  const meta = outcomeMeta(outcome);
  const { setNodeRef, isOver } = useDroppable({ id: outcome });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-w-[260px] flex flex-col rounded-lg border ${
        isOver ? "border-blue-400 bg-blue-50/50" : "border-slate-200 bg-slate-50/50"
      } transition-colors`}
    >
      <div className={`flex items-center gap-2 px-3 py-2.5 border-b ${meta.color} rounded-t-lg`}>
        <span>{meta.emoji}</span>
        <span className="font-semibold text-sm">{meta.short}</span>
        <Badge variant="outline" className="ml-auto bg-white/80 text-xs">
          {jobs.length}
        </Badge>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[70vh]">
        {jobs.length === 0 ? (
          <div className="text-xs text-slate-300 text-center py-8">leer</div>
        ) : (
          jobs.map((j) => <CardItem key={j.id} job={j} />)
        )}
      </div>
    </div>
  );
}

export default function TeamBoardPage() {
  const { toast } = useToast();
  const [jobs, setJobs] = useState<JobCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"mine" | "all">("mine");
  const [role, setRole] = useState<string>("reply_specialist");

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function fetchData(showSpinner = false) {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch("/api/team/inbox");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setRole(d.role);
      // Combine all visible jobs into one flat list, then we'll group by outcome below
      const allRows: JobCard[] = [
        ...d.overdue, ...d.today, ...d.mine, ...d.pool,
      ];
      // Dedup by id (a job may appear in multiple sections)
      const seen = new Set<string>();
      const unique: JobCard[] = [];
      for (const j of allRows) {
        if (!seen.has(j.id)) { seen.add(j.id); unique.push(j); }
      }
      setJobs(unique);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchData();
    const iv = setInterval(() => fetchData(false), 30_000);
    return () => clearInterval(iv);
  }, []);

  const visibleJobs = useMemo(() => {
    if (filter === "all" || role === "reply_specialist") return jobs;
    return jobs;
  }, [jobs, filter, role]);

  const byColumn = useMemo(() => {
    const map: Record<string, JobCard[]> = {};
    for (const c of BOARD_COLUMNS) map[c] = [];
    for (const j of visibleJobs) {
      if (map[j.outcome]) map[j.outcome].push(j);
    }
    return map;
  }, [visibleJobs]);

  const activeJob = activeId ? jobs.find((j) => j.id === activeId) : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const jobId = String(e.active.id);
    const newOutcome = e.over?.id ? String(e.over.id) as ReplyOutcome : null;
    if (!newOutcome) return;
    const job = jobs.find((j) => j.id === jobId);
    if (!job || job.outcome === newOutcome) return;

    // Optimistic
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, outcome: newOutcome } : j)));

    try {
      const res = await fetch(`/api/team/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: newOutcome }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Fehler");
      toast({ title: "Outcome geändert", description: `${outcomeMeta(job.outcome).short} → ${outcomeMeta(newOutcome).short}` });
    } catch (err) {
      // Revert
      setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, outcome: job.outcome } : j)));
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/team/inbox" className="text-slate-400 hover:text-slate-700 mt-1">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Kanban-Board</h1>
            <p className="text-sm text-slate-500">
              Karte ziehen → Outcome ändert sich automatisch
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchData(true)} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4">
          {BOARD_COLUMNS.map((c) => (
            <Column key={c} outcome={c} jobs={byColumn[c] ?? []} />
          ))}
        </div>
        <DragOverlay>
          {activeJob ? <CardItem job={activeJob} isOverlay /> : null}
        </DragOverlay>
      </DndContext>

      <div className="text-xs text-slate-400 text-center mt-4">
        {jobs.length} Karten · Auto-Refresh alle 30s
      </div>
    </div>
  );
}
