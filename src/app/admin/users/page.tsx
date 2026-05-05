"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { MoreHorizontal, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getAllUsers,
  updateUserRole,
  banUser,
  unbanUser,
  type AppRole,
} from "@/lib/actions/admin";

const ROLE_META: Record<AppRole, { label: string; emoji: string; color: string; description: string }> = {
  user:             { label: "Standard-Nutzer", emoji: "👤", color: "bg-blue-100 text-blue-800", description: "Sieht eigene Leads im Dashboard" },
  reply_specialist: { label: "Reply-Specialist", emoji: "📞", color: "bg-indigo-100 text-indigo-800", description: "Bearbeitet zugewiesene Replies + kann aus Pool ziehen" },
  team_lead:        { label: "Team-Lead",        emoji: "👑", color: "bg-purple-100 text-purple-800", description: "Sieht alle Replies, kann zuweisen, Reply-Management-Dashboard" },
  admin:            { label: "Admin",            emoji: "🛡️", color: "bg-red-100 text-red-800", description: "Vollzugriff auf alles" },
};

const ROLE_OPTIONS: AppRole[] = ["user", "reply_specialist", "team_lead", "admin"];

interface AdminUser {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  role: string;
  lead_count: number;
  is_banned: boolean;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Nie";
  return new Date(dateStr).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default function UsersPage() {
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<
    "role" | "ban" | "unban" | null
  >(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [pendingRole, setPendingRole] = useState<AppRole | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAllUsers();
      setUsers(data);
    } catch (err) {
      console.error("Fehler beim Laden der Nutzer:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  function openDialog(action: "ban" | "unban", user: AdminUser) {
    setSelectedUser(user);
    setDialogAction(action);
    setDialogOpen(true);
  }

  function openRoleDialog(user: AdminUser, role: AppRole) {
    if (user.role === role) return; // no-op
    setSelectedUser(user);
    setPendingRole(role);
    setDialogAction("role");
    setDialogOpen(true);
  }

  async function handleConfirm() {
    if (!selectedUser || !dialogAction) return;

    setActionLoading(true);
    try {
      // updateUserRole returns boolean (false on failure). The previous code
      // ignored the return value → silent failures (e.g. CHECK constraint
      // rejecting a role value the DB schema doesn't know yet). We now surface
      // the failure as a toast so the admin sees that nothing changed.
      let ok = true;
      if (dialogAction === "role" && pendingRole) {
        ok = await updateUserRole(selectedUser.id, pendingRole);
      } else if (dialogAction === "ban") {
        ok = await banUser(selectedUser.id);
      } else if (dialogAction === "unban") {
        ok = await unbanUser(selectedUser.id);
      }
      if (!ok) {
        toast({
          title: "Aktion fehlgeschlagen",
          description: dialogAction === "role"
            ? "Rolle konnte nicht gesetzt werden. Vermutlich fehlt eine DB-Migration oder ein CHECK-Constraint blockt den Wert. Server-Logs prüfen."
            : "Server hat die Aktion abgelehnt. Server-Logs prüfen.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Erledigt",
          description: dialogAction === "role" && pendingRole
            ? `${selectedUser.email} ist jetzt ${ROLE_META[pendingRole].label}.`
            : dialogAction === "ban"
              ? `${selectedUser.email} wurde gesperrt.`
              : `Sperre für ${selectedUser.email} aufgehoben.`,
        });
      }
      await loadUsers();
    } catch (err) {
      console.error("Aktion fehlgeschlagen:", err);
      toast({
        title: "Aktion fehlgeschlagen",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setActionLoading(false);
      setDialogOpen(false);
      setSelectedUser(null);
      setDialogAction(null);
      setPendingRole(null);
    }
  }

  function getDialogTexts() {
    if (!selectedUser || !dialogAction)
      return { title: "", description: "", confirm: "" };

    switch (dialogAction) {
      case "role": {
        if (!pendingRole) return { title: "", description: "", confirm: "" };
        const meta = ROLE_META[pendingRole];
        return {
          title: "Rolle ändern",
          description: `Soll "${selectedUser.email}" zur Rolle "${meta.emoji} ${meta.label}" gesetzt werden?\n\n${meta.description}`,
          confirm: `Zu ${meta.label} setzen`,
        };
      }
      case "ban":
        return {
          title: "Nutzer sperren",
          description: `Soll "${selectedUser.email}" gesperrt werden? Der Nutzer kann sich danach nicht mehr anmelden.`,
          confirm: "Sperren",
        };
      case "unban":
        return {
          title: "Nutzer entsperren",
          description: `Soll die Sperre von "${selectedUser.email}" aufgehoben werden?`,
          confirm: "Entsperren",
        };
    }
  }

  const dialogTexts = getDialogTexts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Nutzerverwaltung</h1>
        <p className="text-muted-foreground">
          {users.length} {users.length === 1 ? "Nutzer" : "Nutzer"} registriert
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                Lade Nutzer...
              </span>
            </div>
          ) : users.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">
                Keine Nutzer gefunden.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left">
                    <th className="px-4 py-3 font-medium">E-Mail</th>
                    <th className="px-4 py-3 font-medium">Rolle</th>
                    <th className="px-4 py-3 font-medium">Leads</th>
                    <th className="px-4 py-3 font-medium">Registriert am</th>
                    <th className="px-4 py-3 font-medium">Letzte Anmeldung</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/users/${u.id}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          {u.email}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const meta = ROLE_META[(u.role as AppRole)] ?? ROLE_META.user;
                          return (
                            <Badge variant="secondary" className={meta.color}>
                              <span className="flex items-center gap-1">
                                <span>{meta.emoji}</span>
                                {meta.label}
                              </span>
                            </Badge>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {u.lead_count}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(u.created_at)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(u.last_sign_in_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          variant="secondary"
                          className={
                            u.is_banned
                              ? "bg-red-100 text-red-800"
                              : "bg-green-100 text-green-800"
                          }
                        >
                          {u.is_banned ? "Gesperrt" : "Aktiv"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-[260px]">
                            <div className="px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-wide text-slate-400">
                              Rolle setzen
                            </div>
                            {ROLE_OPTIONS.map((role) => {
                              const meta = ROLE_META[role];
                              const isCurrent = u.role === role;
                              return (
                                <DropdownMenuItem
                                  key={role}
                                  disabled={isCurrent}
                                  onClick={() => openRoleDialog(u, role)}
                                  className={isCurrent ? "opacity-60" : ""}
                                >
                                  <span className="mr-2">{meta.emoji}</span>
                                  <span className="flex-1">{meta.label}</span>
                                  {isCurrent && <span className="text-xs text-slate-400 ml-2">aktuell</span>}
                                </DropdownMenuItem>
                              );
                            })}
                            <div className="my-1 border-t border-slate-100" />
                            {u.is_banned ? (
                              <DropdownMenuItem
                                onClick={() => openDialog("unban", u)}
                              >
                                Entsperren
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => openDialog("ban", u)}
                                className="text-red-600"
                              >
                                Sperren
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
              variant={dialogAction === "ban" ? "destructive" : "default"}
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
