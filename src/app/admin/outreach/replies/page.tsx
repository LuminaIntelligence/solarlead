import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Phone, ArrowLeft, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function RepliesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || user.user_metadata?.role !== "admin") redirect("/dashboard");

  const { data: replies } = await supabase
    .from("outreach_jobs")
    .select("*, outreach_batches(name)")
    .eq("status", "replied")
    .order("replied_at", { ascending: false });

  const jobs = replies ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/outreach" className="text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-green-400" />
            Antworten — Closing Queue
          </h1>
          <p className="text-slate-600 text-sm mt-0.5">
            {jobs.length} Unternehmen haben geantwortet — jetzt anrufen und closen
          </p>
        </div>
      </div>

      {jobs.length === 0 ? (
        <Card className="bg-white border-slate-200">
          <CardContent className="py-16 text-center">
            <MessageSquare className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500">Noch keine Antworten eingegangen.</p>
            <p className="text-slate-400 text-sm mt-1">Antworten erscheinen hier sobald jemand auf eine Outreach-E-Mail antwortet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => {
            const batchName = (job.outreach_batches as { name: string } | null)?.name;
            const repliedAt = job.replied_at
              ? new Date(job.replied_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
              : "—";

            return (
              <Card key={job.id} className="bg-white border-green-300 border">
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 space-y-3">
                      {/* Header */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-lg font-bold text-slate-900">{job.company_name}</span>
                        <span className="text-slate-500 text-sm">{job.company_city}</span>
                        {batchName && (
                          <Badge className="bg-slate-100 text-slate-700 text-xs">{batchName}</Badge>
                        )}
                        <span className="text-xs text-slate-500">Geantwortet: {repliedAt}</span>
                      </div>

                      {/* Kontakt */}
                      <div className="flex items-center gap-6 text-sm">
                        <div>
                          <span className="text-slate-500">Ansprechpartner: </span>
                          <span className="text-slate-900 font-medium">{job.contact_name ?? "Unbekannt"}</span>
                          {job.contact_title && (
                            <span className="text-slate-500"> · {job.contact_title}</span>
                          )}
                        </div>
                        {job.contact_email && (
                          <a href={`mailto:${job.contact_email}`} className="text-blue-600 hover:underline flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />
                            {job.contact_email}
                          </a>
                        )}
                      </div>

                      {/* Antwort-Text */}
                      {job.reply_content && (
                        <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                          <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">Ihre Antwort:</p>
                          <p className="text-slate-700 text-sm whitespace-pre-wrap leading-relaxed">
                            {job.reply_content.slice(0, 500)}
                            {job.reply_content.length > 500 && <span className="text-slate-400">...</span>}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Action */}
                    <div className="shrink-0">
                      <a
                        href={`/dashboard/leads/${job.lead_id}`}
                        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                      >
                        <Phone className="h-4 w-4" />
                        Lead öffnen
                      </a>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
