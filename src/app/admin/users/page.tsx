"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { MoreHorizontal, Shield, User, Loader2 } from "lucide-react";
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
} from "@/lib/actions/admin";

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
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogAction, setDialogAction] = useState<
    "role" | "ban" | "unban" | null
  >(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);

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

  function openDialog(action: "role" | "ban" | "unban", user: AdminUser) {
    setSelectedUser(user);
    setDialogAction(action);
    setDialogOpen(true);
  }

  async function handleConfirm() {
    if (!selectedUser || !dialogAction) return;

    setActionLoading(true);
    try {
      if (dialogAction === "role") {
        const newRole = selectedUser.role === "admin" ? "user" : "admin";
        await updateUserRole(selectedUser.id, newRole);
      } else if (dialogAction === "ban") {
        await banUser(selectedUser.id);
      } else if (dialogAction === "unban") {
        await unbanUser(selectedUser.id);
      }
      await loadUsers();
    } catch (err) {
      console.error("Aktion fehlgeschlagen:", err);
    } finally {
      setActionLoading(false);
      setDialogOpen(false);
      setSelectedUser(null);
      setDialogAction(null);
    }
  }

  function getDialogTexts() {
    if (!selectedUser || !dialogAction)
      return { title: "", description: "", confirm: "" };

    switch (dialogAction) {
      case "role": {
        const newRole = selectedUser.role === "admin" ? "User" : "Admin";
        return {
          title: "Rolle ändern",
          description: `Soll die Rolle von "${selectedUser.email}" auf "${newRole}" geändert werden?`,
          confirm: `Zu ${newRole} ändern`,
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
                        <Badge
                          variant="secondary"
                          className={
                            u.role === "admin"
                              ? "bg-red-100 text-red-800"
                              : "bg-blue-100 text-blue-800"
                          }
                        >
                          {u.role === "admin" ? (
                            <span className="flex items-center gap-1">
                              <Shield className="h-3 w-3" />
                              Admin
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              User
                            </span>
                          )}
                        </Badge>
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
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => openDialog("role", u)}
                            >
                              Rolle ändern
                            </DropdownMenuItem>
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
