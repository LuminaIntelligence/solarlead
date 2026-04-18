"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Shield,
  User,
  Loader2,
  Trash2,
  Mail,
  Calendar,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getUserDetail,
  updateUserRole,
  banUser,
  unbanUser,
  deleteUserLeads,
} from "@/lib/actions/admin";
import type { Lead, UserSettings, SearchRun, LeadStatus } from "@/types/database";

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  role: string;
  lead_count: number;
  is_banned: boolean;
}

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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Nie";
  return new Date(dateStr).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCategory(category: string): string {
  return categoryLabels[category] ?? category;
}

function formatStatus(status: string): string {
  return statusLabels[status] ?? status;
}

function getScoreColor(score: number): string {
  if (score >= 70) return "bg-green-100 text-green-800";
  if (score >= 40) return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-800";
}

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;

  const [userData, setUserData] = useState<{
    user: AdminUser;
    leads: Lead[];
    settings: UserSettings | null;
    searchRuns: SearchRun[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<
    "role" | "ban" | "unban" | "deleteLeads" | null
  >(null);

  const loadUser = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getUserDetail(userId);
      setUserData(data);
    } catch (err) {
      console.error("Fehler beim Laden des Nutzers:", err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  function openDialog(action: "role" | "ban" | "unban" | "deleteLeads") {
    setDialogAction(action);
    setDialogOpen(true);
  }

  async function handleConfirm() {
    if (!userData || !dialogAction) return;

    setActionLoading(true);
    try {
      if (dialogAction === "role") {
        const newRole = userData.user.role === "admin" ? "user" : "admin";
        await updateUserRole(userData.user.id, newRole);
      } else if (dialogAction === "ban") {
        await banUser(userData.user.id);
      } else if (dialogAction === "unban") {
        await unbanUser(userData.user.id);
      } else if (dialogAction === "deleteLeads") {
        await deleteUserLeads(userData.user.id);
      }
      await loadUser();
    } catch (err) {
      console.error("Aktion fehlgeschlagen:", err);
    } finally {
      setActionLoading(false);
      setDialogOpen(false);
      setDialogAction(null);
    }
  }

  function getDialogTexts() {
    if (!userData || !dialogAction)
      return { title: "", description: "", confirm: "", destructive: false };

    switch (dialogAction) {
      case "role": {
        const newRole = userData.user.role === "admin" ? "User" : "Admin";
        return {
          title: "Rolle ändern",
          description: `Soll die Rolle von "${userData.user.email}" auf "${newRole}" geändert werden?`,
          confirm: `Zu ${newRole} ändern`,
          destructive: false,
        };
      }
      case "ban":
        return {
          title: "Nutzer sperren",
          description: `Soll "${userData.user.email}" gesperrt werden? Der Nutzer kann sich danach nicht mehr anmelden.`,
          confirm: "Sperren",
          destructive: true,
        };
      case "unban":
        return {
          title: "Nutzer entsperren",
          description: `Soll die Sperre von "${userData.user.email}" aufgehoben werden?`,
          confirm: "Entsperren",
          destructive: false,
        };
      case "deleteLeads":
        return {
          title: "Alle Leads löschen",
          description: `Sollen wirklich alle ${userData.leads.length} Leads von "${userData.user.email}" unwiderruflich gelöscht werden?`,
          confirm: "Alle Leads löschen",
          destructive: true,
        };
    }
  }

  const dialogTexts = getDialogTexts();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">
          Lade Nutzerdetails...
        </span>
      </div>
    );
  }

  if (!userData) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Zurück zur Nutzerverwaltung
        </Link>
        <Card className="py-16 text-center">
          <CardContent>
            <p className="text-muted-foreground">Nutzer nicht gefunden.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { user, leads, settings, searchRuns } = userData;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Zurück zur Nutzerverwaltung
      </Link>

      {/* User info card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              {user.role === "admin" ? (
                <Shield className="h-5 w-5 text-red-600" />
              ) : (
                <User className="h-5 w-5 text-blue-600" />
              )}
              {user.email}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => openDialog("role")}
              >
                Rolle ändern
              </Button>
              {user.is_banned ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openDialog("unban")}
                >
                  Entsperren
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => openDialog("ban")}
                >
                  Sperren
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">E-Mail</p>
                <p className="text-sm font-medium">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Rolle</p>
                <Badge
                  variant="secondary"
                  className={
                    user.role === "admin"
                      ? "bg-red-100 text-red-800"
                      : "bg-blue-100 text-blue-800"
                  }
                >
                  {user.role === "admin" ? "Admin" : "User"}
                </Badge>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Registriert am</p>
                <p className="text-sm font-medium">
                  {formatDate(user.created_at)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">
                  Letzte Anmeldung
                </p>
                <p className="text-sm font-medium">
                  {formatDate(user.last_sign_in_at)}
                </p>
              </div>
            </div>
          </div>
          <div className="mt-4">
            <Badge
              variant="secondary"
              className={
                user.is_banned
                  ? "bg-red-100 text-red-800"
                  : "bg-green-100 text-green-800"
              }
            >
              {user.is_banned ? "Gesperrt" : "Aktiv"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads">
            Leads ({leads.length})
          </TabsTrigger>
          <TabsTrigger value="settings">Einstellungen</TabsTrigger>
          <TabsTrigger value="activity">
            Aktivität ({searchRuns.length})
          </TabsTrigger>
        </TabsList>

        {/* Leads Tab */}
        <TabsContent value="leads">
          <Card>
            <CardContent className="p-0">
              {leads.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    Keine Leads vorhanden.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50 text-left">
                        <th className="px-4 py-3 font-medium">Unternehmen</th>
                        <th className="px-4 py-3 font-medium">Kategorie</th>
                        <th className="px-4 py-3 font-medium">Stadt</th>
                        <th className="px-4 py-3 font-medium">Score</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map((lead) => (
                        <tr
                          key={lead.id}
                          className="border-b last:border-0 hover:bg-slate-50"
                        >
                          <td className="px-4 py-3">
                            <Link
                              href={`/dashboard/leads/${lead.id}`}
                              className="font-medium text-blue-600 hover:underline"
                            >
                              {lead.company_name}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {formatCategory(lead.category)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {lead.city}
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant="secondary"
                              className={getScoreColor(lead.total_score)}
                            >
                              {lead.total_score}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <Badge
                              variant="secondary"
                              className={
                                statusColors[lead.status] ?? "bg-gray-100"
                              }
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
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>Nutzer-Einstellungen</CardTitle>
            </CardHeader>
            <CardContent>
              {!settings ? (
                <p className="text-sm text-muted-foreground">
                  Keine Einstellungen vorhanden.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b pb-3">
                    <span className="text-sm text-muted-foreground">
                      Provider-Modus
                    </span>
                    <Badge variant="secondary">
                      {settings.provider_mode === "live" ? "Live" : "Mock"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-2">
                      Scoring-Gewichtung
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <span className="text-xs text-muted-foreground">
                          Business
                        </span>
                        <span className="text-sm font-medium">
                          {settings.scoring_weights?.business ?? "-"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <span className="text-xs text-muted-foreground">
                          Strom
                        </span>
                        <span className="text-sm font-medium">
                          {settings.scoring_weights?.electricity ?? "-"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <span className="text-xs text-muted-foreground">
                          Solar
                        </span>
                        <span className="text-sm font-medium">
                          {settings.scoring_weights?.solar ?? "-"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between rounded-md border px-3 py-2">
                        <span className="text-xs text-muted-foreground">
                          Outreach
                        </span>
                        <span className="text-sm font-medium">
                          {settings.scoring_weights?.outreach ?? "-"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t pt-3">
                    <span className="text-sm text-muted-foreground">
                      Google Places API-Key
                    </span>
                    <span className="text-sm font-medium">
                      {settings.google_places_api_key ? "Hinterlegt" : "Nicht gesetzt"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t pt-3">
                    <span className="text-sm text-muted-foreground">
                      Google Solar API-Key
                    </span>
                    <span className="text-sm font-medium">
                      {settings.google_solar_api_key ? "Hinterlegt" : "Nicht gesetzt"}
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Letzte Suchvorgänge</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {searchRuns.length === 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm text-muted-foreground">
                    Keine Suchvorgänge vorhanden.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-slate-50 text-left">
                        <th className="px-4 py-3 font-medium">Suchanfrage</th>
                        <th className="px-4 py-3 font-medium">Datum</th>
                        <th className="px-4 py-3 font-medium">Ergebnisse</th>
                      </tr>
                    </thead>
                    <tbody>
                      {searchRuns.map((run) => (
                        <tr
                          key={run.id}
                          className="border-b last:border-0 hover:bg-slate-50"
                        >
                          <td className="px-4 py-3 font-medium">
                            {run.query}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {formatDate(run.created_at)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {run.results_count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Danger Zone */}
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-600">Gefahrenzone</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Alle Leads löschen</p>
              <p className="text-xs text-muted-foreground">
                Alle {leads.length} Leads dieses Nutzers unwiderruflich
                entfernen.
              </p>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => openDialog("deleteLeads")}
              disabled={leads.length === 0}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Alle Leads löschen
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogTexts.title}</DialogTitle>
            <DialogDescription>{dialogTexts.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={actionLoading}
            >
              Abbrechen
            </Button>
            <Button
              variant={dialogTexts.destructive ? "destructive" : "default"}
              onClick={handleConfirm}
              disabled={actionLoading}
            >
              {actionLoading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {dialogTexts.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
