import Link from "next/link";
import { Users, Target, TrendingUp, CheckCircle, Search, CalendarClock, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getLeadStats, getLeads } from "@/lib/actions/leads";
import type { Lead, LeadStatus } from "@/types/database";
import { getCategoryLabel } from "@/lib/constants/categories";

const STATUS_ORDER: LeadStatus[] = ["new", "reviewed", "contacted", "qualified", "rejected"];

const statusColors: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-800",
  reviewed: "bg-yellow-100 text-yellow-800",
  contacted: "bg-purple-100 text-purple-800",
  qualified: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  existing_solar: "bg-orange-100 text-orange-800",
};

const statusBarColors: Record<LeadStatus, string> = {
  new: "bg-blue-500",
  reviewed: "bg-yellow-500",
  contacted: "bg-purple-500",
  qualified: "bg-green-500",
  rejected: "bg-red-400",
  existing_solar: "bg-orange-400",
};

const statusLabels: Record<LeadStatus, string> = {
  new: "Neu",
  reviewed: "Geprüft",
  contacted: "Kontaktiert",
  qualified: "Qualifiziert",
  rejected: "Abgelehnt",
  existing_solar: "☀️ Bereits Solar",
};

function formatCategory(category: string): string {
  return getCategoryLabel(category);
}

function getScoreColor(score: number): string {
  if (score >= 70) return "bg-green-100 text-green-800";
  if (score >= 40) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

export default async function DashboardPage() {
  const [stats, leads] = await Promise.all([
    getLeadStats(),
    getLeads({ sortBy: "total_score", sortOrder: "desc" }),
  ]);

  const recentLeads = leads.slice(0, 8);
  const qualifiedCount = stats.byStatus["qualified"] ?? 0;
  const activeLeads = stats.total - (stats.byStatus["rejected"] ?? 0);

  if (stats.total === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">Übersicht Ihrer Solar-Lead-Pipeline</p>
        </div>
        <Card className="flex flex-col items-center justify-center py-16">
          <CardContent className="text-center space-y-4">
            <Search className="mx-auto h-12 w-12 text-muted-foreground" />
            <h2 className="text-xl font-semibold">Noch keine Leads vorhanden</h2>
            <p className="text-muted-foreground max-w-md">Starten Sie mit der Suche nach Unternehmen</p>
            <Link
              href="/dashboard/search"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Zur Lead-Suche
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Übersicht Ihrer Solar-Lead-Pipeline</p>
      </div>

      {/* KPI Row 1 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Leads gesamt</CardTitle>
            <Users className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">{activeLeads} aktiv</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Ø Score</CardTitle>
            <Target className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgScore}</div>
            <p className="text-xs text-muted-foreground">von 100 Punkten</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Hohe Priorität</CardTitle>
            <TrendingUp className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.highScoreCount}</div>
            <p className="text-xs text-muted-foreground">Score ≥ 70</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Qualifiziert</CardTitle>
            <CheckCircle className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{qualifiedCount}</div>
            <p className="text-xs text-muted-foreground">
              {stats.total > 0 ? Math.round((qualifiedCount / stats.total) * 100) : 0}% Conversion
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Neu diese Woche</CardTitle>
            <Sparkles className="h-4 w-4 text-violet-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.newThisWeek}</div>
            <p className="text-xs text-muted-foreground">letzte 7 Tage</p>
          </CardContent>
        </Card>

        <Card className={stats.overdueFollowups > 0 ? "border-orange-300 bg-orange-50" : ""}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Wiedervorlage</CardTitle>
            <CalendarClock className={`h-4 w-4 ${stats.overdueFollowups > 0 ? "text-orange-600" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.overdueFollowups > 0 ? "text-orange-700" : ""}`}>
              {stats.overdueFollowups}
            </div>
            <Link href="/dashboard/followup" className="text-xs text-muted-foreground hover:underline">
              fällig / überfällig →
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Funnel + Top Leads */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Top Leads */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Top Leads nach Score</CardTitle>
            <Link href="/dashboard/leads" className="text-sm text-muted-foreground hover:underline">
              Alle anzeigen →
            </Link>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Unternehmen</th>
                    <th className="pb-2 font-medium">Kategorie</th>
                    <th className="pb-2 font-medium">Stadt</th>
                    <th className="pb-2 font-medium">Score</th>
                    <th className="pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentLeads.map((lead) => (
                    <tr key={lead.id} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="py-2.5">
                        <Link href={`/dashboard/leads/${lead.id}`} className="font-medium hover:underline">
                          {lead.company_name}
                        </Link>
                      </td>
                      <td className="py-2.5 text-muted-foreground">{formatCategory(lead.category)}</td>
                      <td className="py-2.5 text-muted-foreground">{lead.city}</td>
                      <td className="py-2.5">
                        <Badge variant="secondary" className={getScoreColor(lead.total_score)}>
                          {lead.total_score}
                        </Badge>
                      </td>
                      <td className="py-2.5">
                        <Badge variant="secondary" className={statusColors[lead.status]}>
                          {statusLabels[lead.status] ?? lead.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Pipeline Funnel */}
        <Card>
          <CardHeader>
            <CardTitle>Pipeline-Funnel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {STATUS_ORDER.map((status) => {
              const count = stats.byStatus[status] ?? 0;
              const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
              return (
                <div key={status}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium">{statusLabels[status]}</span>
                    <span className="text-sm text-muted-foreground">{count} ({pct}%)</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100">
                    <div
                      className={`h-2 rounded-full transition-all ${statusBarColors[status]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <div className="pt-3 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Conversion Rate</span>
                <span className="font-semibold text-green-700">
                  {stats.total > 0 ? Math.round((qualifiedCount / stats.total) * 100) : 0}%
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Category Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Kategorie-Verteilung</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {Object.entries(stats.byCategory)
              .sort(([, a], [, b]) => b - a)
              .map(([category, count]) => (
                <div key={category} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="text-sm">{formatCategory(category)}</span>
                  <Badge variant="secondary">{count}</Badge>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
