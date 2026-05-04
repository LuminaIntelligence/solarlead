"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Building2, Mail, Phone, MapPin, Loader2, Send,
  Clock, AlertCircle, ExternalLink, Star, Calendar, CheckCircle2,
  Pencil, MessageSquare, Hand, UserCheck,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { OUTCOME_OPTIONS, outcomeMeta, ACTIVITY_KIND_LABELS } from "@/lib/constants/reply-outcomes";
import type { ReplyOutcome, OutreachJob, OutreachActivity, LeadContact, ActivityKind } from "@/types/database";

interface DetailData {
  job: OutreachJob;
  lead: { id: string; company_name: string; address: string; city: string; phone: string | null; email: string | null; website: string | null; total_score: number; max_array_area_m2: number | null; category: string } | null;
  contacts: LeadContact[];
  batch: { id: string; name: string; template_type: string; created_at: string } | null;
  activities: OutreachActivity[];
  assignee: { id: string; email: string } | null;
  userEmails: Record<string, string>;
  outcomeMeta: { label: string; emoji: string; color: string; defaultReminderDays?: number; terminal?: boolean };
  role: "admin" | "team_lead" | "reply_specialist";
}

function formatDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  // YYYY-MM-DDTHH:mm for datetime-local
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dateInputToISO(s: string): string | null {
  if (!s) return null;
  return new Date(s).toISOString();
}

export default function TeamReplyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [outcome, setOutcome] = useState<ReplyOutcome>("new");
  const [nextActionAt, setNextActionAt] = useState<string>("");
  const [nextActionNote, setNextActionNote] = useState<string>("");
  const [closedValue, setClosedValue] = useState<string>("");
  const [noteDraft, setNoteDraft] = useState("");
  const [savingForm, setSavingForm] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [logging, setLogging] = useState<ActivityKind | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/team/jobs/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          toast({ title: "Reply nicht gefunden / kein Zugriff", variant: "destructive" });
          router.push("/team/inbox");
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const d: DetailData = await res.json();
      setData(d);
      setOutcome(d.job.outcome);
      setNextActionAt(formatDateInput(d.job.next_action_at));
      setNextActionNote(d.job.next_action_note ?? "");
      setClosedValue(d.job.closed_value_eur != null ? String(d.job.closed_value_eur) : "");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [id, router, toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Quick-action: set outcome + auto-suggest reminder
  function applyOutcomeQuick(value: ReplyOutcome) {
    const meta = outcomeMeta(value);
    setOutcome(value);
    if (meta.defaultReminderDays != null && !nextActionAt) {
      const d = new Date();
      d.setDate(d.getDate() + meta.defaultReminderDays);
      d.setHours(10, 0, 0, 0); // default 10:00
      setNextActionAt(formatDateInput(d.toISOString()));
    }
  }

  async function handleSaveForm() {
    if (!data) return;
    setSavingForm(true);
    try {
      const payload: Record<string, unknown> = {};
      if (outcome !== data.job.outcome) payload.outcome = outcome;
      const nextIso = dateInputToISO(nextActionAt);
      if (nextIso !== data.job.next_action_at) payload.next_action_at = nextIso;
      if ((nextActionNote ?? "") !== (data.job.next_action_note ?? "")) {
        payload.next_action_note = nextActionNote || null;
      }
      const dvNum = closedValue.trim() === "" ? null : Number(closedValue.replace(/\./g, "").replace(",", "."));
      if (dvNum !== data.job.closed_value_eur && (dvNum == null || Number.isFinite(dvNum))) {
        payload.closed_value_eur = dvNum;
      }
      if (Object.keys(payload).length === 0) {
        toast({ title: "Nichts geändert" });
        return;
      }
      const res = await fetch(`/api/team/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Fehler");
      toast({ title: "Gespeichert", description: `${json.activities_logged} Aktion${json.activities_logged === 1 ? "" : "en"} geloggt.` });
      await fetchData();
    } catch (e) {
      toast({ title: "Speichern fehlgeschlagen", description: e instanceof Error ? e.message : "Unbekannter Fehler", variant: "destructive" });
    } finally {
      setSavingForm(false);
    }
  }

  async function handleAddNote() {
    if (!noteDraft.trim()) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/team/jobs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: noteDraft.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Fehler");
      }
      setNoteDraft("");
      toast({ title: "Notiz gespeichert" });
      await fetchData();
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : "Unbekannter Fehler", variant: "destructive" });
    } finally {
      setSavingNote(false);
    }
  }

  async function logActivity(kind: ActivityKind, content: string) {
    setLogging(kind);
    try {
      // Reuse the PATCH endpoint by sending a note with a special prefix?
      // Cleaner: we add a separate endpoint or just use the activity table directly.
      // For now we tunnel through the PATCH note channel BUT we mark the kind.
      const res = await fetch(`/api/team/jobs/${id}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Fehler");
      }
      toast({ title: "Aktivität protokolliert" });
      await fetchData();
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : "Unbekannter Fehler", variant: "destructive" });
    } finally {
      setLogging(null);
    }
  }

  async function handleClaim() {
    setSavingForm(true);
    try {
      const res = await fetch(`/api/team/jobs/${id}/claim`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Fehler");
      toast({ title: "Übernommen" });
      await fetchData();
    } catch (e) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : "Unbekannter Fehler", variant: "destructive" });
    } finally {
      setSavingForm(false);
    }
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const { job, lead, contacts, batch, activities, assignee } = data;
  const meta = outcomeMeta(job.outcome);
  const primaryContact = contacts.find((c) => c.is_primary) ?? contacts[0];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Link href="/team/inbox" className="text-slate-400 hover:text-slate-700 mt-1">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold text-slate-900">
                {job.company_name ?? "(ohne Firmenname)"}
              </h1>
              <Badge className={`${meta.color} border-0`}>{meta.emoji} {meta.label}</Badge>
              {job.pipeline_stage && (
                <Badge variant="outline">{job.pipeline_stage}</Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-500 mt-1">
              {job.company_city && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{job.company_city}</span>}
              {batch && <span>Batch: {batch.name}</span>}
              {assignee ? (
                <span className="inline-flex items-center gap-1"><UserCheck className="h-3.5 w-3.5" />{assignee.email}</span>
              ) : (
                <span className="text-amber-600">unzugewiesen</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {!job.assigned_to && (
            <Button onClick={handleClaim} disabled={savingForm}>
              <Hand className="h-4 w-4 mr-1.5" /> Übernehmen
            </Button>
          )}
          {lead && (
            <Link href={`/dashboard/leads/${lead.id}`} target="_blank">
              <Button variant="outline" size="sm">
                Lead-Details <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left column: original mail + reply + activities */}
        <div className="lg:col-span-2 space-y-5">
          {/* Original outreach */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Send className="h-4 w-4 text-blue-600" />
                Original-Outreach
                {job.sent_at && (
                  <span className="text-xs font-normal text-slate-400 ml-auto">
                    versendet: {new Date(job.sent_at).toLocaleString("de-DE")}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <span className="text-xs text-slate-400">Subject:</span>{" "}
                <span className="font-medium">{job.personalized_subject ?? "—"}</span>
              </div>
              {job.personalized_body && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-blue-600 hover:underline">Mail-Body anzeigen</summary>
                  <pre className="mt-2 whitespace-pre-wrap text-slate-700 bg-slate-50 p-3 rounded border border-slate-200 max-h-60 overflow-auto">
                    {job.personalized_body}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>

          {/* Reply */}
          <Card className="border-blue-300">
            <CardHeader className="pb-3 bg-blue-50/50">
              <CardTitle className="text-sm flex items-center gap-2 text-blue-900">
                <Mail className="h-4 w-4" />
                Reply
                {job.replied_at && (
                  <span className="text-xs font-normal opacity-70 ml-auto">
                    eingegangen: {new Date(job.replied_at).toLocaleString("de-DE")}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {job.reply_content ? (
                <pre className="whitespace-pre-wrap text-sm text-slate-800 leading-relaxed">
                  {job.reply_content}
                </pre>
              ) : (
                <p className="text-sm text-slate-400 italic">Kein Reply-Text gespeichert.</p>
              )}
            </CardContent>
          </Card>

          {/* Activity log */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-purple-600" />
                Aktivitäten ({activities.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Note input */}
              <div className="flex items-start gap-2 mb-4">
                <Textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Notiz hinzufügen…"
                  rows={2}
                  className="flex-1"
                />
                <Button onClick={handleAddNote} disabled={savingNote || !noteDraft.trim()} size="sm">
                  {savingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>

              {/* Quick activity buttons */}
              <div className="flex flex-wrap gap-2 mb-4 pb-3 border-b border-slate-100">
                <Button
                  variant="outline" size="sm"
                  onClick={() => logActivity("call_attempted", "Versucht anzurufen — nicht erreicht")}
                  disabled={logging === "call_attempted"}
                >
                  {logging === "call_attempted" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Phone className="h-3.5 w-3.5 mr-1.5" />}
                  Anruf nicht erreicht
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={() => logActivity("call_connected", "Telefoniert")}
                  disabled={logging === "call_connected"}
                >
                  {logging === "call_connected" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5 text-green-600" />}
                  Anruf erfolgreich
                </Button>
                <Button
                  variant="outline" size="sm"
                  onClick={() => logActivity("email_sent", "E-Mail an Kunden gesendet")}
                  disabled={logging === "email_sent"}
                >
                  {logging === "email_sent" ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Mail className="h-3.5 w-3.5 mr-1.5" />}
                  Mail gesendet
                </Button>
              </div>

              {/* Activities timeline */}
              {activities.length === 0 ? (
                <p className="text-sm text-slate-400 italic">Noch keine Aktivitäten.</p>
              ) : (
                <ul className="space-y-3">
                  {activities.map((a) => {
                    const k = ACTIVITY_KIND_LABELS[a.kind];
                    const author = data.userEmails[a.user_id] ?? a.user_id.slice(0, 8);
                    return (
                      <li key={a.id} className="flex gap-3">
                        <span className={`text-base shrink-0 ${k.color}`}>{k.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-slate-500">
                            <span className={`font-medium ${k.color}`}>{k.label}</span>
                            <span className="mx-1">·</span>
                            <span>{author}</span>
                            <span className="mx-1">·</span>
                            <span>{new Date(a.created_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</span>
                          </div>
                          {a.content && (
                            <p className="text-sm text-slate-700 mt-0.5">{a.content}</p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: action panel + lead context */}
        <div className="space-y-5">
          {/* Action panel */}
          <Card className="border-blue-300 ring-1 ring-blue-100">
            <CardHeader className="pb-3 bg-blue-50/30">
              <CardTitle className="text-sm">Bearbeitung</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Outcome quick-buttons */}
              <div>
                <Label className="text-xs">Outcome</Label>
                <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                  {OUTCOME_OPTIONS.filter((o) => o.value !== "new").map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => applyOutcomeQuick(opt.value)}
                      type="button"
                      className={`text-xs px-2 py-2 rounded border text-left transition-colors ${
                        outcome === opt.value
                          ? `${opt.color} border-current`
                          : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                      title={opt.description}
                    >
                      <span className="mr-1">{opt.emoji}</span>{opt.short}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reminder */}
              <div className="space-y-1.5">
                <Label htmlFor="next_action_at" className="text-xs flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Wiedervorlage
                </Label>
                <Input
                  id="next_action_at"
                  type="datetime-local"
                  value={nextActionAt}
                  onChange={(e) => setNextActionAt(e.target.value)}
                />
              </div>

              {/* Note for next action */}
              <div className="space-y-1.5">
                <Label htmlFor="next_action_note" className="text-xs">Geplant zu tun</Label>
                <Input
                  id="next_action_note"
                  value={nextActionNote}
                  onChange={(e) => setNextActionNote(e.target.value)}
                  placeholder="z.B. Hr. Meier 14h zurückrufen"
                />
              </div>

              {/* Deal value (only when closed_won) */}
              {outcome === "closed_won" && (
                <div className="space-y-1.5">
                  <Label htmlFor="closed_value" className="text-xs">Deal-Wert (€)</Label>
                  <Input
                    id="closed_value"
                    type="text"
                    inputMode="decimal"
                    value={closedValue}
                    onChange={(e) => setClosedValue(e.target.value)}
                    placeholder="25000"
                  />
                </div>
              )}

              <Button onClick={handleSaveForm} disabled={savingForm} className="w-full">
                {savingForm ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
                Speichern
              </Button>
            </CardContent>
          </Card>

          {/* Lead context */}
          {lead && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Lead-Kontext
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Score:</span>
                  <span className={`font-bold ${lead.total_score >= 70 ? "text-green-600" : lead.total_score >= 50 ? "text-amber-600" : "text-slate-500"}`}>
                    {lead.total_score}
                  </span>
                </div>
                {lead.max_array_area_m2 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Dachfläche:</span>
                    <span>{Math.round(lead.max_array_area_m2).toLocaleString("de-DE")} m²</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-slate-700">{lead.address}, {lead.city}</span>
                </div>
                {lead.phone && (
                  <a href={`tel:${lead.phone}`} className="flex items-center gap-2 text-blue-600 hover:underline">
                    <Phone className="h-3.5 w-3.5" />{lead.phone}
                  </a>
                )}
                {lead.email && (
                  <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-blue-600 hover:underline">
                    <Mail className="h-3.5 w-3.5" />{lead.email}
                  </a>
                )}
                {lead.website && (
                  <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-blue-600 hover:underline truncate">
                    <ExternalLink className="h-3.5 w-3.5" />{lead.website}
                  </a>
                )}
              </CardContent>
            </Card>
          )}

          {/* Primary contact */}
          {primaryContact && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  {primaryContact.is_primary && <Star className="h-4 w-4 text-yellow-500 fill-current" />}
                  Hauptkontakt
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="font-semibold">{primaryContact.name}</p>
                {primaryContact.title && <p className="text-xs text-slate-500">{primaryContact.title}</p>}
                {primaryContact.email && (
                  <a href={`mailto:${primaryContact.email}`} className="flex items-center gap-2 text-blue-600 hover:underline text-xs">
                    <Mail className="h-3 w-3" />{primaryContact.email}
                  </a>
                )}
                {primaryContact.phone && (
                  <a href={`tel:${primaryContact.phone}`} className="flex items-center gap-2 text-blue-600 hover:underline text-xs">
                    <Phone className="h-3 w-3" />{primaryContact.phone}
                  </a>
                )}
                {contacts.length > 1 && (
                  <p className="text-xs text-slate-400 mt-2">+ {contacts.length - 1} weitere Kontakt{contacts.length === 2 ? "" : "e"}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
