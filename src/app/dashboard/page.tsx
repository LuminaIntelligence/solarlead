import Link from "next/link";
import { Users, Target, TrendingUp, CheckCircle, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getLeadStats, getLeads } from "@/lib/actions/leads";
import type { Lead, LeadStatus } from "@/types/database";

const statusColors: Record<LeadStatus, string> = {
  new: "bg-blue-100 text-blue-800",
  reviewed: "bg-yellow-100 text-yellow-800",
  contacted: "bg-purple-100 text-purple-800",
  qualified: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

const statusLabels: Record<LeadStatus, string> = {
  new: "Neu",
  reviewed: "Geprüft",
  contacted: "Kontaktiert",
  qualified: "Qualifiziert",
  rejected: "Abgelehnt",
};

const categoryLabels: Record<string, string> = {
  logistics: "Logistik",
  warehouse: "Lager",
  cold_storage: "Kühlhaus",
  supermarket: "Supermarkt",
  food_production: "Lebensmittelproduktion",
  manufacturing: "Fertigung",
  metalworking: "Metallverarbeitung",
  car_dealership: "Autohaus",
  hotel: "Hotel",
  furniture_store: "Möbelhaus",
  hardware_store: "Baumarkt",
  shopping_center: "Einkaufszentrum",
};

function formatStatus(status: LeadStatus): string {
  return statusLabels[status] ?? status;
}

function formatCategory(category: string): string {
  return categoryLabels[category] ?? category;
}

function getScoreColor(score: number): string {
  if (score >= 70) return "bg-green-100 text-green-800";
  if (score >= 40) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

export default async function DashboardPage() {
  const [stats, leads] = await Promise.all([
    getLeadStats(),
    getLeads({ sortBy: "created_at", sortOrder: "desc" }),
  ]);

  const recentLeads = leads.slice(0, 10);
  const qualifiedCount = stats.byStatus["qualified"] ?? 0;

  if (stats.total === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Übersicht Ihrer Solar-Lead-Pipeline
          </p>
        </div>
        <Card className="flex flex-col items-center justify-center py-16">
          <CardContent className="text-center space-y-4">
            <Search className="mx-auto h-12 w-12 text-muted-foreground" />
            <h2 className="text-xl font-semibold">Noch keine Leads vorhanden</h2>
            <p className="text-muted-foreground max-w-md">
              Starten Sie mit der Suche nach Unternehmen
            </p>
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
        <p className="text-muted-foreground">
          Übersicht Ihrer Solar-Lead-Pipeline
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Leads gesamt</CardTitle>
            <Users className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Durchschn. Score</CardTitle>
            <Target className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgScore}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Hohe Priorität</CardTitle>
            <TrendingUp className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.highScoreCount}</div>
            <p className="text-xs text-muted-foreground">Score &ge; 70</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Qualifiziert</CardTitle>
            <CheckCircle className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{qualifiedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Leads Table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Neueste Leads</CardTitle>
          </CardHeader>
          <CardContent>
            {recentLeads.length === 0 ? (
              <p className="text-sm text-muted-foreground">Keine Leads gefunden.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium">Unternehmen</th>
                      <th className="pb-2 font-medium">Kategorie</th>
                      <th className="pb-2 font-medium">Stadt</th>
                      <th className="pb-2 font-medium">Score</th>
                      <th className="pb-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentLeads.map((lead) => (
                      <tr key={lead.id} className="border-b last:border-0">
                        <td className="py-3">
                          <Link
                            href={`/dashboard/leads/${lead.id}`}
                            className="font-medium hover:underline"
                          >
                            {lead.company_name}
                          </Link>
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {formatCategory(lead.category)}
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {lead.city}
                        </td>
                        <td className="py-3">
                          <Badge
                            variant="secondary"
                            className={getScoreColor(lead.total_score)}
                          >
                            {lead.total_score}
                          </Badge>
                        </td>
                        <td className="py-3">
                          <Badge
                            variant="secondary"
                            className={statusColors[lead.status]}
                          >
                            {formatStatus(lead.status)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pipeline Breakdown */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status-Verteilung</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(stats.byStatus).length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch keine Daten.</p>
              ) : (
                <ul className="space-y-2">
                  {Object.entries(stats.byStatus).map(([status, count]) => (
                    <li
                      key={status}
                      className="flex items-center justify-between"
                    >
                      <Badge
                        variant="secondary"
                        className={
                          statusColors[status as LeadStatus] ?? "bg-gray-100"
                        }
                      >
                        {formatStatus(status as LeadStatus)}
                      </Badge>
                      <span className="text-sm font-medium">{count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Kategorie-Verteilung</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(stats.byCategory).length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch keine Daten.</p>
              ) : (
                <ul className="space-y-2">
                  {Object.entries(stats.byCategory).map(
                    ([category, count]) => (
                      <li
                        key={category}
                        className="flex items-center justify-between"
                      >
                        <span className="text-sm text-muted-foreground">
                          {formatCategory(category)}
                        </span>
                        <span className="text-sm font-medium">{count}</span>
                      </li>
                    )
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
