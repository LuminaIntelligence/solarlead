"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, ExternalLink, Send, Loader2, Copy, CheckCircle2,
  MessageCircle, Building2, MapPin, User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { renderTemplate, contextFromJob } from "@/lib/linkedin/templates";

interface Template {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  is_default: boolean;
}

interface Job {
  id: string;
  status: string;
  contact_name: string | null;
  contact_title: string | null;
  company_name: string | null;
  company_city: string | null;
  company_category: string | null;
  roof_area_m2: number | null;
  linkedin_url: string | null;
  linkedin_sent_at: string | null;
  linkedin_message: string | null;
  replied_at: string | null;
  reply_content: string | null;
  outcome: string | null;
  outreach_batches: { name: string } | null;
}

export default function LinkedInJobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [job, setJob] = useState<Job | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTplId, setSelectedTplId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [replyDialog, setReplyDialog] = useState(false);
  const [replyContent, setReplyContent] = useState("");
  const [submittingReply, setSubmittingReply] = useState(false);
  const [copied, setCopied] = useState<"subject" | "body" | null>(null);

  const ctx = useMemo(() => (job ? contextFromJob(job) : null), [job]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/outreach/linkedin/${id}`);
      if (!res.ok) {
        toast({ title: "Job nicht gefunden", variant: "destructive" });
        router.push("/admin/outreach/linkedin");
        return;
      }
      const d = await res.json();
      setJob(d.job);
      setTemplates(d.templates ?? []);

      // Default-Template auswählen + render
      const tpl = (d.templates as Template[]).find((t) => t.is_default) ?? d.templates[0];
      if (tpl) {
        setSelectedTplId(tpl.id);
        const c = contextFromJob(d.job);
        setSubject(tpl.subject ? renderTemplate(tpl.subject, c) : "");
        setBody(renderTemplate(tpl.body, c));
      }

      // Wenn schon gesendet: ursprüngliche Nachricht laden
      if (d.job.linkedin_message) {
        setBody(d.job.linkedin_message);
      }
    } finally {
      setLoading(false);
    }
  }, [id, router, toast]);

  useEffect(() => {
    load();
  }, [load]);

  function applyTemplate(tplId: string) {
    setSelectedTplId(tplId);
    const tpl = templates.find((t) => t.id === tplId);
    if (!tpl || !ctx) return;
    setSubject(tpl.subject ? renderTemplate(tpl.subject, ctx) : "");
    setBody(renderTemplate(tpl.body, ctx));
  }

  async function copyText(kind: "subject" | "body") {
    const text = kind === "subject" ? subject : body;
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  }

  async function handleMarkSent() {
    if (!body.trim()) {
      toast({ title: "Nachricht ist leer", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`/api/admin/outreach/linkedin/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: body,
          template_id: selectedTplId || null,
          credits_used: 1,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast({ title: "Fehler", description: d.error, variant: "destructive" });
        return;
      }
      toast({ title: "Als gesendet markiert", description: `${job?.contact_name} · InMail` });
      await load();
    } finally {
      setSending(false);
    }
  }

  async function handleReplyReceived() {
    setSubmittingReply(true);
    try {
      const res = await fetch(`/api/admin/outreach/linkedin/${id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyContent }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast({ title: "Fehler", description: d.error, variant: "destructive" });
        return;
      }
      toast({
        title: "Antwort vermerkt",
        description: d.assigned_to ? "Auto-assigned an Reply-Specialist" : "Im Pool",
      });
      setReplyDialog(false);
      setReplyContent("");
      await load();
    } finally {
      setSubmittingReply(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (!job) return null;

  const isPending = job.status === "pending";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Link
          href="/admin/outreach/linkedin"
          className="text-slate-500 hover:text-slate-900 mt-1"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{job.company_name ?? "—"}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Batch: {job.outreach_batches?.name ?? "—"}
          </p>
        </div>
        {isPending && (
          <Badge variant="secondary" className="bg-amber-100 text-amber-800">
            InMail vorbereiten
          </Badge>
        )}
        {job.status === "sent" && (
          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
            <Send className="h-3 w-3 mr-1 inline" /> Gesendet
          </Badge>
        )}
        {job.status === "replied" && (
          <Badge variant="secondary" className="bg-green-100 text-green-800">
            <CheckCircle2 className="h-3 w-3 mr-1 inline" /> Beantwortet
          </Badge>
        )}
      </div>

      {/* Lead-Info-Card */}
      <Card>
        <CardContent className="py-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <Building2 className="h-3.5 w-3.5" /> Unternehmen
            </div>
            <div className="font-medium">{job.company_name ?? "—"}</div>
            <div className="text-xs text-slate-600">{job.company_category ?? ""}</div>
            {job.roof_area_m2 && (
              <div className="text-xs text-slate-500 mt-1">
                Dachfläche: ~{job.roof_area_m2.toLocaleString("de-DE")} m²
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <User className="h-3.5 w-3.5" /> Kontakt
            </div>
            <div className="font-medium">{job.contact_name ?? "—"}</div>
            <div className="text-xs text-slate-600">{job.contact_title ?? ""}</div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
              <MapPin className="h-3.5 w-3.5" /> Ort
            </div>
            <div className="font-medium">{job.company_city ?? "—"}</div>
            {job.linkedin_url && (
              <a
                href={job.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-700 hover:underline inline-flex items-center gap-1 mt-1"
              >
                LinkedIn-Profil <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Template-Auswahl + Editor (nur wenn pending) */}
      {isPending && (
        <>
          {templates.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Template wählen</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex gap-2 flex-wrap">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => applyTemplate(t.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        selectedTplId === t.id
                          ? "bg-blue-600 text-white border-blue-600"
                          : "bg-white text-slate-700 border-slate-200 hover:border-blue-400"
                      }`}
                    >
                      {t.name}
                      {t.is_default && (
                        <span className="ml-1.5 text-[10px] opacity-75">★</span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Tokens: <code>{"{firstname}"}</code> <code>{"{company}"}</code>{" "}
                  <code>{"{city}"}</code> <code>{"{title}"}</code>{" "}
                  <code>{"{roof_m2}"}</code> — werden automatisch ersetzt.
                </p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>InMail-Inhalt</span>
                <span className="text-xs font-normal text-slate-500">
                  {body.length}/2000 Zeichen
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700">
                    Betreff (InMail)
                  </label>
                  <button
                    onClick={() => copyText("subject")}
                    className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
                  >
                    {copied === "subject" ? (
                      <><CheckCircle2 className="h-3 w-3" /> kopiert</>
                    ) : (
                      <><Copy className="h-3 w-3" /> kopieren</>
                    )}
                  </button>
                </div>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={200}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-700">Nachricht</label>
                  <button
                    onClick={() => copyText("body")}
                    className="text-xs text-slate-500 hover:text-slate-900 inline-flex items-center gap-1"
                  >
                    {copied === "body" ? (
                      <><CheckCircle2 className="h-3 w-3" /> kopiert</>
                    ) : (
                      <><Copy className="h-3 w-3" /> kopieren</>
                    )}
                  </button>
                </div>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={2000}
                  rows={12}
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono"
                />
              </div>
            </CardContent>
          </Card>

          {/* Action-Buttons */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="py-4 space-y-3">
              <p className="text-sm text-slate-700">
                <strong>Workflow:</strong>
                <ol className="list-decimal list-inside mt-1 ml-2 space-y-0.5 text-xs">
                  <li>Nachricht oben prüfen + personalisieren</li>
                  <li>Auf <strong>„Profil öffnen"</strong> klicken → LinkedIn-Tab öffnet</li>
                  <li>InMail-Button auf LinkedIn → Subject + Body kopieren</li>
                  <li>Bei LinkedIn auf „Senden" klicken</li>
                  <li>Hier zurück → <strong>„Als gesendet markieren"</strong></li>
                </ol>
              </p>
              <div className="flex gap-2 flex-wrap">
                {job.linkedin_url && (
                  <a
                    href={job.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium px-4 py-2 rounded"
                  >
                    <ExternalLink className="h-4 w-4" /> Profil öffnen
                  </a>
                )}
                <Button onClick={handleMarkSent} disabled={sending || !body.trim()}>
                  {sending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Als gesendet markieren
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Gesendete InMail anzeigen */}
      {job.status === "sent" && job.linkedin_message && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Gesendete InMail</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-slate-50 rounded p-3 text-sm whitespace-pre-wrap text-slate-700">
                {job.linkedin_message}
              </div>
              {job.linkedin_sent_at && (
                <p className="text-xs text-slate-500 mt-2">
                  Gesendet am{" "}
                  {new Date(job.linkedin_sent_at).toLocaleString("de-DE")}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-green-50 border-green-200">
            <CardContent className="py-3 flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm text-slate-700">
                Antwort über LinkedIn erhalten?
              </span>
              <Button onClick={() => setReplyDialog(true)} variant="default" size="sm">
                <MessageCircle className="h-4 w-4 mr-1.5" /> Antwort vermerken
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      {/* Replied */}
      {job.status === "replied" && job.reply_content && (
        <Card className="bg-green-50 border-green-200">
          <CardHeader>
            <CardTitle className="text-base">Antwort</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-white rounded p-3 text-sm whitespace-pre-wrap text-slate-700 border border-slate-200">
              {job.reply_content}
            </div>
            {job.replied_at && (
              <p className="text-xs text-slate-500 mt-2">
                Eingegangen am {new Date(job.replied_at).toLocaleString("de-DE")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Reply-Dialog */}
      {replyDialog && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-lg w-full p-5 space-y-3">
            <h3 className="font-semibold text-lg">LinkedIn-Antwort vermerken</h3>
            <p className="text-xs text-slate-500">
              Inhalt der Antwort von LinkedIn hier einfügen — wird im Reply-Team-Inbox sichtbar.
            </p>
            <textarea
              value={replyContent}
              onChange={(e) => setReplyContent(e.target.value)}
              rows={6}
              placeholder="Antwort-Text..."
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setReplyDialog(false)}>
                Abbrechen
              </Button>
              <Button onClick={handleReplyReceived} disabled={submittingReply}>
                {submittingReply && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Antwort speichern + auto-zuweisen
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
