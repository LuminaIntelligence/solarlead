"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Clock, Inbox as InboxIcon, Loader2, RefreshCw,
  AlertCircle, CheckCircle2, MapPin, Mail, ChevronRight, Hand, Search, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { OUTCOME_OPTIONS, outcomeMeta, SLA } from "@/lib/constants/reply-outcomes";
import { ReassignDropdown } from "@/components/team/reassign-dropdown";
import type { ReplyOutcome } from "@/types/database";

interface JobCard {
  id: string;
  company_name: string | null;
  company_city: string | null;
  contact_name: string | null;
  contact_email: string | null;
  outcome: ReplyOutcome;
  next_action_at: string | null;
  next_action_note: string | null;
  replied_at: string | null;
  last_activity_at: string | null;
  assigned_to: string | null;
  pipeline_stage: string | null;
  closed_value_eur: number | null;
}

interface InboxData {
  role: "admin" | "team_lead" | "reply_specialist";
  canSeeAll: boolean;
  counts: { overdue: number; today: number; mine: number; pool: number; sla_pool: number; sla_response: number };
  overdue: JobCard[];
  today: JobCard[];
  mine: JobCard[];
  pool: JobCard[];
  sla_pool: JobCard[];
  sla_response: JobCard[];
  assignees: Record<string, { email: string }>;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)} min`;
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)} h`;
  return `${Math.floor(ms / 86400_000)} Tage`;
}

function timeUntil(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return `vor ${timeAgo(iso)}`;
  if (ms < 3600_000) return `in ${Math.floor(ms / 60_000)} min`;
  if (ms < 86400_000) return `in ${Math.floor(ms / 3600_000)} h`;
  return `in ${Math.floor(ms / 86400_000)} Tagen`;
}

function JobRow({
  job, assignees, onClaim, claiming, canReassign, onReassigned,
}: {
  job: JobCard;
  assignees: Record<string, { email: string }>;
  onClaim?: (id: string) => void;
  claiming?: string | null;
  canReassign?: boolean;
  onReassigned?: () => void;
}) {
  const meta = outcomeMeta(job.outcome);
  const assignee = job.assigned_to ? assignees[job.assigned_to] : null;
  return (
    <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-b-0">
      <span className="text-lg shrink-0" title={meta.label}>{meta.emoji}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/team/${job.id}`}
            className="font-medium text-slate-900 hover:text-blue-600 truncate"
          >
            {job.company_name ?? "(unbenannt)"}
          </Link>
          <Badge className={`${meta.color} text-[10px] border-0`}>{meta.short}</Badge>
          {job.company_city && (
            <span className="text-xs text-slate-500 inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />{job.company_city}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
          {job.contact_name && (
            <span className="truncate">{job.contact_name}</span>
          )}
          {job.next_action_at && (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <Clock className="h-3 w-3" />{timeUntil(job.next_action_at)}
            </span>
          )}
          {job.next_action_note && (
            <span className="text-slate-400 truncate max-w-[300px]">„{job.next_action_note}"</span>
          )}
          {assignee && !canReassign && (
            <span className="ml-auto text-slate-400">→ {assignee.email}</span>
          )}
        </div>
      </div>
      {canReassign && (
        <ReassignDropdown
          jobId={job.id}
          currentAssigneeId={job.assigned_to}
          currentAssigneeEmail={assignee?.email}
          onChange={onReassigned}
          size="sm"
        />
      )}
      {onClaim && !job.assigned_to && !canReassign && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onClaim(job.id)}
          disabled={claiming === job.id}
        >
          {claiming === job.id
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <><Hand className="h-3.5 w-3.5 mr-1.5" />Übernehmen</>
          }
        </Button>
      )}
      {!onClaim && (
        <ChevronRight className="h-4 w-4 text-slate-300 shrink-0" />
      )}
    </div>
  );
}

function Section({
  title, icon, color, jobs, empty, assignees, onClaim, claiming, canReassign, onReassigned,
}: {
  title: string;
  icon: React.ReactNode;
  color: string;
  jobs: JobCard[];
  empty?: string;
  assignees: Record<string, { email: string }>;
  onClaim?: (id: string) => void;
  claiming?: string | null;
  canReassign?: boolean;
  onReassigned?: () => void;
}) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
      <div className={`flex items-center justify-between px-4 py-3 ${color}`}>
        <div className="flex items-center gap-2 font-semibold text-sm">
          {icon}
          {title}
          <span className="ml-1 text-xs opacity-70">({jobs.length})</span>
        </div>
      </div>
      {jobs.length > 0 ? (
        <div>
          {jobs.map((j) => (
            <JobRow
              key={j.id}
              job={j}
              assignees={assignees}
              onClaim={onClaim}
              claiming={claiming}
              canReassign={canReassign}
              onReassigned={onReassigned}
            />
          ))}
        </div>
      ) : (
        <div className="px-4 py-8 text-center text-sm text-slate-400">
          {empty ?? "Keine Einträge."}
        </div>
      )}
    </div>
  );
}

export default function TeamInboxPage() {
  const { toast } = useToast();
  const [data, setData] = useState<InboxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function fetchData(showSpinner = false) {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch("/api/team/inbox");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchData();
    // Auto-refresh every 30s so reminders/SLA stay current
    const iv = setInterval(() => fetchData(false), 30_000);
    return () => clearInterval(iv);
  }, []);

  async function handleClaim(jobId: string) {
    setClaiming(jobId);
    try {
      const res = await fetch(`/api/team/jobs/${jobId}/claim`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Fehler");
      toast({ title: "Übernommen", description: "Reply liegt jetzt in deiner Inbox." });
      await fetchData();
    } catch (e) {
      toast({
        title: "Übernahme fehlgeschlagen",
        description: e instanceof Error ? e.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setClaiming(null);
    }
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const isLead = data.canSeeAll;
  const q = search.trim().toLowerCase();
  const filterFn = (rows: JobCard[]) => {
    if (!q) return rows;
    return rows.filter((j) => {
      return (
        (j.company_name ?? "").toLowerCase().includes(q) ||
        (j.company_city ?? "").toLowerCase().includes(q) ||
        (j.contact_name ?? "").toLowerCase().includes(q) ||
        (j.contact_email ?? "").toLowerCase().includes(q) ||
        (j.next_action_note ?? "").toLowerCase().includes(q)
      );
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inbox</h1>
          <p className="text-sm text-slate-500">
            {isLead
              ? "Team-Übersicht: alle Replies, SLA-Verletzungen, Pool"
              : "Deine Tasks: was heute fällig ist + freier Pool zum Übernehmen"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchData(true)} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Firma, Kontakt, Stadt oder Notiz suchen…"
          className="pl-10 pr-10"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Counter chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <CounterCard label="Überfällig" value={data.counts.overdue} color="bg-red-50 border-red-200 text-red-900" />
        <CounterCard label="Heute fällig" value={data.counts.today} color="bg-amber-50 border-amber-200 text-amber-900" />
        <CounterCard label={isLead ? "Alle aktiv" : "Meine offen"} value={data.counts.mine + (isLead ? data.counts.pool : 0)} color="bg-blue-50 border-blue-200 text-blue-900" />
        <CounterCard label="Pool" value={data.counts.pool} color="bg-slate-50 border-slate-200 text-slate-700" />
      </div>

      {/* SLA warnings — only for leads */}
      {isLead && (data.counts.sla_pool > 0 || data.counts.sla_response > 0) && (
        <div className="bg-red-50 border border-red-300 rounded-lg p-4">
          <div className="flex items-center gap-2 font-semibold text-red-900 mb-2">
            <AlertTriangle className="h-4 w-4" /> SLA-Verletzungen
          </div>
          <div className="text-sm text-red-800 space-y-1">
            {data.counts.sla_pool > 0 && (
              <p>
                <strong>{data.counts.sla_pool}</strong> Reply{data.counts.sla_pool === 1 ? "" : "s"} {">"}{SLA.ASSIGN_HOURS}h im Pool ohne Zuweisung
              </p>
            )}
            {data.counts.sla_response > 0 && (
              <p>
                <strong>{data.counts.sla_response}</strong> zugewiesene Reply{data.counts.sla_response === 1 ? "" : "s"} {">"}{SLA.RESPOND_HOURS}h ohne Aktivität
              </p>
            )}
          </div>
        </div>
      )}

      <Section
        title="Überfällig"
        icon={<AlertCircle className="h-4 w-4 text-red-600" />}
        color="bg-red-50/50 text-red-900"
        jobs={filterFn(data.overdue)}
        empty="Keine überfälligen Tasks 🎉"
        assignees={data.assignees}
        canReassign={isLead}
        onReassigned={() => fetchData()}
      />

      <Section
        title="Heute fällig"
        icon={<Clock className="h-4 w-4 text-amber-600" />}
        color="bg-amber-50/50 text-amber-900"
        jobs={filterFn(data.today)}
        empty="Keine Reminder für heute."
        assignees={data.assignees}
        canReassign={isLead}
        onReassigned={() => fetchData()}
      />

      <Section
        title={isLead ? "Aktive (alle)" : "Meine offenen Replies"}
        icon={<InboxIcon className="h-4 w-4 text-blue-600" />}
        color="bg-blue-50/50 text-blue-900"
        jobs={filterFn(data.mine)}
        empty="Keine offenen Replies."
        assignees={data.assignees}
        canReassign={isLead}
        onReassigned={() => fetchData()}
      />

      <Section
        title="Pool — frei zum Übernehmen"
        icon={<Hand className="h-4 w-4 text-slate-600" />}
        color="bg-slate-50 text-slate-700"
        jobs={filterFn(data.pool)}
        empty="Pool ist leer — alles zugewiesen!"
        assignees={data.assignees}
        onClaim={!isLead || data.role === "team_lead" ? handleClaim : undefined}
        claiming={claiming}
      />

      {isLead && data.sla_response.length > 0 && (
        <Section
          title="SLA: Reaktionszeit überschritten"
          icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
          color="bg-red-50 text-red-900"
          jobs={data.sla_response}
          assignees={data.assignees}
          canReassign={isLead}
          onReassigned={() => fetchData()}
        />
      )}
    </div>
  );
}

function CounterCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${color}`}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-bold mt-0.5">{value}</div>
    </div>
  );
}
