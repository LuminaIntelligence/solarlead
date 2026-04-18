import { Users, Database, Target, Search, UserPlus, BarChart3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSystemStats } from "@/lib/actions/admin";

const statusLabels: Record<string, string> = {
  new: "Neu",
  reviewed: "Geprüft",
  contacted: "Kontaktiert",
  qualified: "Qualifiziert",
  rejected: "Abgelehnt",
};

const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-800",
  reviewed: "bg-yellow-100 text-yellow-800",
  contacted: "bg-purple-100 text-purple-800",
  qualified: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
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

function formatStatus(status: string): string {
  return statusLabels[status] ?? status;
}

function formatCategory(category: string): string {
  return categoryLabels[category] ?? category;
}

export default async function AdminDashboardPage() {
  const stats = await getSystemStats();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin-Übersicht</h1>
        <p className="text-muted-foreground">
          Systemweite Statistiken und Aktivitäten
        </p>
      </div>

      {/* KPI Cards Row 1 */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Nutzer gesamt</CardTitle>
            <Users className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalUsers}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Leads gesamt</CardTitle>
            <Database className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalLeads}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Durchschn. Score
            </CardTitle>
            <Target className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avgScore}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Suchen (7 Tage)
            </CardTitle>
            <Search className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.searchRunsLast7Days}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* KPI Cards Row 2 */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Neue Nutzer (7 Tage)
            </CardTitle>
            <UserPlus className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.newUsersLast7Days}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Leads gesamt</CardTitle>
            <BarChart3 className="h-4 w-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalLeads}</div>
            <p className="text-xs text-muted-foreground">
              Über alle Nutzer hinweg
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Two-column layout: Status + Kategorie */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Status-Verteilung */}
        <Card>
          <CardHeader>
            <CardTitle>Status-Verteilung</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(stats.leadsByStatus).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Noch keine Daten vorhanden.
              </p>
            ) : (
              <ul className="space-y-3">
                {Object.entries(stats.leadsByStatus).map(([status, count]) => (
                  <li
                    key={status}
                    className="flex items-center justify-between"
                  >
                    <Badge
                      variant="secondary"
                      className={statusColors[status] ?? "bg-gray-100"}
                    >
                      {formatStatus(status)}
                    </Badge>
                    <span className="text-sm font-semibold">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Kategorie-Verteilung */}
        <Card>
          <CardHeader>
            <CardTitle>Kategorie-Verteilung</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(stats.leadsByCategory).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Noch keine Daten vorhanden.
              </p>
            ) : (
              <ul className="space-y-3">
                {Object.entries(stats.leadsByCategory).map(
                  ([category, count]) => (
                    <li
                      key={category}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm text-muted-foreground">
                        {formatCategory(category)}
                      </span>
                      <span className="text-sm font-semibold">{count}</span>
                    </li>
                  )
                )}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
