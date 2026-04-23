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
  draft: "bg-slate-100 text-slate-700",
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  completed: "bg-blue-100 text-blue-700",
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
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Massenversand
          </h1>
          <p className="text-slate-600">
            E-Mail-Kampagnen und Outreach-Batches verwalten
          </p>
        </div>
        <Button
          asChild
          className="text-[#1F3D2E] font-semibold"
          style={{ backgroundColor: "#B2D082" }}
        >
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
        <Card className="bg-white border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-500">
              Batches gesamt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{totalBatches}</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-500">
              Jobs gesamt
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{totalJobs}</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-500">
              Versendet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{totalSent}</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-500">
              Antworten
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">{totalReplied}</div>
          </CardContent>
        </Card>

        <Card className="bg-white border-slate-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-slate-500">
              Ø Reply-Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-slate-900">
              {avgReplyRate}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Batch list */}
      <Card className="bg-white border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-900">Alle Batches</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {allBatches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Send className="mb-4 h-10 w-10 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">
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
                  <tr className="border-b border-slate-200 text-left">
                    <th className="px-4 py-3 font-medium text-slate-500">
                      Name
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-500">
                      Status
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-500 text-right">
                      Leads
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-500 text-right">
                      Gesendet
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-500 text-right">
                      Antworten
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-500 text-right">
                      Reply-Rate
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-500">
                      Erstellt am
                    </th>
                    <th className="px-4 py-3 font-medium text-slate-500">
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
                        className="border-b border-slate-200 last:border-0 hover:bg-slate-50"
                      >
                        <td className="px-4 py-3">
                          <span className="font-medium text-slate-900">
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
                              "bg-slate-100 text-slate-700"
                            }
                          >
                            {statusLabels[batch.status] ?? batch.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">
                          {batch.total_leads}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">
                          {batch.sent_count}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-600">
                          {batch.replied_count}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span
                            className={
                              replyRate >= 10
                                ? "text-green-600"
                                : replyRate >= 5
                                ? "text-yellow-600"
                                : "text-slate-500"
                            }
                          >
                            {replyRate}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {formatDate(batch.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Button
                              asChild
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100"
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
                                className="h-7 px-2 text-yellow-600 hover:text-yellow-700 hover:bg-slate-100"
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
                                className="h-7 px-2 text-green-600 hover:text-green-700 hover:bg-slate-100"
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
