import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Send, Eye, Pause, Play } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { OutreachBatch, OutreachBatchStatus } from "@/types/database";

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

const statusLabels: Record<OutreachBatchStatus, string> = {
  draft: "Entwurf",
  active: "Aktiv",
  paused: "Pausiert",
  completed: "Abgeschlossen",
};

const statusColors: Record<OutreachBatchStatus, string> = {
  draft: "bg-slate-700 text-slate-200",
  active: "bg-green-700/30 text-green-300",
  paused: "bg-yellow-700/30 text-yellow-300",
  completed: "bg-blue-700/30 text-blue-300",
};

export default async function OutreachPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.user_metadata?.role !== "admin") {
    redirect("/admin");
  }

  // Fetch batches
  const { data: batches, error } = await supabase
    .from("outreach_batches")
    .select("*")
    .order("created_at", { ascending: false });

  const dbMissing =
    error?.code === "42P01" || error?.message?.includes("does not exist");

  const allBatches: OutreachBatch[] = batches ?? [];

  // Compute stats
  const totalBatches = allBatches.length;
  const totalJobs = allBatches.reduce((sum, b) => sum + (b.total_leads ?? 0), 0);
  const totalSent = allBatches.reduce((sum, b) => sum + (b.sent_count ?? 0), 0);
  const totalReplied = allBatches.reduce(
    (sum, b) => sum + (b.replied_count ?? 0),
    0
  );
  const avgReplyRate =
    totalSent > 0 ? Math.round((totalReplied / totalSent) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">
            Massenversand
          </h1>
          <p className="text-slate-400">
            E-Mail-Kampagnen und Outreach-Batches verwalten
          </p>
        </div>
        <Button asChild className="bg-red-600 hover:bg-red-700 text-white">
          <Link href="/admin/outreach/new">
            <Plus className="mr-2 h-4 w-4" />
            Neuen Batch erstellen
          </Link>
        </Button>
      </div>

      {/* DB missing warning */}
      {dbMissing && (
        <Card className="border-yellow-600/40 bg-yellow-900/20">
          <CardContent className="p-4">
            <p className="text-sm text-yellow-300">
              <strong>Hinweis:</strong> Die Datenbanktabellen{" "}
              <code className="font-mono">outreach_batches</code> und{" "}
              <code className="font-mono">outreach_jobs</code> wurden noch nicht
              angelegt. Bitte führe die Migrations-SQL in Supabase aus, bevor du
              Batches erstellen kannst.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-400">
              Batches gesamt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{totalBatches}</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-400">
              Jobs gesamt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{totalJobs}</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-400">
              Versendet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{totalSent}</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-400">
              Antworten
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{totalReplied}</div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-400">
              Ø Reply-Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">
              {avgReplyRate}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Batch list */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Alle Batches</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {allBatches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Send className="mb-4 h-10 w-10 text-slate-600" />
              <p className="text-sm font-medium text-slate-300">
                Noch keine Batches vorhanden
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Erstelle deinen ersten Massenversand-Batch.
              </p>
              <Button
                asChild
                className="mt-4 bg-red-600 hover:bg-red-700 text-white"
              >
                <Link href="/admin/outreach/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Batch erstellen
                </Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left">
                    <th className="px-4 py-3 font-medium text-slate-400">
                      Name
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-400">
                      Status
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-400 text-right">
                      Leads
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-400 text-right">
                      Gesendet
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-400 text-right">
                      Antworten
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-400 text-right">
                      Reply-Rate
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-400">
                      Erstellt am
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-400">
                      Aktionen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allBatches.map((batch) => {
                    const replyRate =
                      batch.sent_count > 0
                        ? Math.round(
                            (batch.replied_count / batch.sent_count) * 100
                          )
                        : 0;

                    return (
                      <tr
                        key={batch.id}
                        className="border-b border-slate-800 last:border-0 hover:bg-slate-800/50"
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium text-white">
                            {batch.name}
                          </span>
                          {batch.description && (
                            <p className="text-xs text-slate-500 truncate max-w-[200px]">
                              {batch.description}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant="secondary"
                            className={
                              statusColors[batch.status] ??
                              "bg-slate-700 text-slate-200"
                            }
                          >
                            {statusLabels[batch.status] ?? batch.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">
                          {batch.total_leads}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">
                          {batch.sent_count}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">
                          {batch.replied_count}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={
                              replyRate >= 10
                                ? "text-green-400"
                                : replyRate >= 5
                                ? "text-yellow-400"
                                : "text-slate-400"
                            }
                          >
                            {replyRate}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {formatDate(batch.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Button
                              asChild
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-slate-400 hover:text-white hover:bg-slate-700"
                            >
                              <Link
                                href={`/admin/outreach/${batch.id}`}
                              >
                                <Eye className="h-3.5 w-3.5 mr-1" />
                                Details
                              </Link>
                            </Button>
                            {batch.status === "active" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-yellow-400 hover:text-yellow-300 hover:bg-slate-700"
                              >
                                <Pause className="h-3.5 w-3.5 mr-1" />
                                Pause
                              </Button>
                            )}
                            {(batch.status === "draft" ||
                              batch.status === "paused") && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-green-400 hover:text-green-300 hover:bg-slate-700"
                              >
                                <Play className="h-3.5 w-3.5 mr-1" />
                                Aktivieren
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
