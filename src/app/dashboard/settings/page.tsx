"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Settings, Shield, ExternalLink, Mail, Loader2, CheckCircle2, KeyRound, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { getUserSettings, updateUserSettings } from "@/lib/actions/settings";
import { useToast } from "@/components/ui/use-toast";

export default function SettingsPage() {
  const { toast } = useToast();
  const [isAdmin, setIsAdmin] = useState(false);
  const [providerMode, setProviderMode] = useState<string>("mock");
  const [loading, setLoading] = useState(true);

  // E-Mail Signatur
  const [senderName, setSenderName] = useState("");
  const [senderTitle, setSenderTitle] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [savingSignature, setSavingSignature] = useState(false);
  const [signatureSaved, setSignatureSaved] = useState(false);

  // Passwort ändern
  const [userEmail, setUserEmail] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setIsAdmin(user?.user_metadata?.role === "admin");
      setUserEmail(user?.email ?? "");

      const settings = await getUserSettings();
      if (settings) {
        setProviderMode(settings.provider_mode);
        setSenderName(settings.email_sender_name ?? "");
        setSenderTitle(settings.email_sender_title ?? "");
        setSenderEmail(settings.email_sender_email ?? "");
        setSenderPhone(settings.email_sender_phone ?? "");
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleChangePassword() {
    // Validierung
    if (!currentPassword) {
      toast({
        title: "Aktuelles Passwort fehlt",
        description: "Bitte gib dein aktuelles Passwort ein.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword.length < 8) {
      toast({
        title: "Neues Passwort zu kurz",
        description: "Mindestens 8 Zeichen erforderlich.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({
        title: "Passwörter stimmen nicht überein",
        description: "Neues Passwort und Bestätigung müssen identisch sein.",
        variant: "destructive",
      });
      return;
    }
    if (newPassword === currentPassword) {
      toast({
        title: "Identisches Passwort",
        description: "Das neue Passwort muss sich vom aktuellen unterscheiden.",
        variant: "destructive",
      });
      return;
    }

    setChangingPassword(true);
    try {
      const supabase = createClient();

      // Schritt 1: aktuelles Passwort verifizieren via signIn-Versuch
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
      });
      if (signInErr) {
        toast({
          title: "Aktuelles Passwort falsch",
          description: "Das eingegebene aktuelle Passwort ist nicht korrekt.",
          variant: "destructive",
        });
        return;
      }

      // Schritt 2: Passwort updaten
      const { error: updateErr } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateErr) {
        toast({
          title: "Fehler beim Ändern",
          description: updateErr.message,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Passwort geändert",
        description: "Dein neues Passwort ist ab sofort aktiv.",
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setChangingPassword(false);
    }
  }

  async function handleSaveSignature() {
    setSavingSignature(true);
    setSignatureSaved(false);
    try {
      const result = await updateUserSettings({
        email_sender_name: senderName.trim() || null,
        email_sender_title: senderTitle.trim() || null,
        email_sender_email: senderEmail.trim() || null,
        email_sender_phone: senderPhone.trim() || null,
      });
      if (result) {
        setSignatureSaved(true);
        toast({ title: "Signatur gespeichert", description: "Wird ab sofort in Ihren E-Mails verwendet." });
        setTimeout(() => setSignatureSaved(false), 3000);
      } else {
        toast({ title: "Fehler", description: "Speichern fehlgeschlagen.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Fehler", description: "Speichern fehlgeschlagen.", variant: "destructive" });
    } finally {
      setSavingSignature(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Einstellungen</h1>
        <p className="text-muted-foreground">
          Kontoinformationen und Systemstatus
        </p>
      </div>

      {/* Aktueller Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Systemstatus
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between border-b pb-3">
            <span className="text-sm text-muted-foreground">Anbieter-Modus</span>
            <Badge variant="secondary" className={providerMode === "live" ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}>
              {providerMode === "live" ? "Live (Echte APIs)" : "Mock (Testdaten)"}
            </Badge>
          </div>
          <div className="flex items-center justify-between border-b pb-3">
            <span className="text-sm text-muted-foreground">Rolle</span>
            <Badge variant="secondary" className={isAdmin ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800"}>
              {isAdmin ? "Administrator" : "Benutzer"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Passwort ändern */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Passwort ändern
          </CardTitle>
          <CardDescription>
            Setze ein neues Passwort für dein Konto ({userEmail}).
            Mindestens 8 Zeichen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">Aktuelles Passwort</Label>
            <div className="relative">
              <Input
                id="currentPassword"
                type={showPasswords ? "text" : "password"}
                placeholder="Aktuelles Passwort"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPasswords((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                title={showPasswords ? "Verbergen" : "Anzeigen"}
              >
                {showPasswords ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">Neues Passwort</Label>
              <Input
                id="newPassword"
                type={showPasswords ? "text" : "password"}
                placeholder="Mindestens 8 Zeichen"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              {newPassword.length > 0 && newPassword.length < 8 && (
                <p className="text-xs text-amber-600">
                  Noch {8 - newPassword.length} Zeichen
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Bestätigen</Label>
              <Input
                id="confirmPassword"
                type={showPasswords ? "text" : "password"}
                placeholder="Neues Passwort wiederholen"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
              {confirmPassword.length > 0 && confirmPassword !== newPassword && (
                <p className="text-xs text-red-600">
                  Stimmt nicht mit neuem Passwort überein
                </p>
              )}
            </div>
          </div>
          <Button
            onClick={handleChangePassword}
            disabled={
              changingPassword ||
              !currentPassword ||
              newPassword.length < 8 ||
              newPassword !== confirmPassword
            }
          >
            {changingPassword ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <KeyRound className="h-4 w-4 mr-2" />
            )}
            Passwort ändern
          </Button>
        </CardContent>
      </Card>

      {/* E-Mail Signatur */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            E-Mail Signatur
          </CardTitle>
          <CardDescription>
            Diese Daten werden in ausgehenden Outreach-E-Mails als Absender verwendet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="senderName">Name</Label>
              <Input
                id="senderName"
                placeholder="z.B. Max Mustermann"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="senderTitle">Funktion / Titel</Label>
              <Input
                id="senderTitle"
                placeholder="z.B. Vertriebsberater"
                value={senderTitle}
                onChange={(e) => setSenderTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="senderEmail">E-Mail-Adresse</Label>
              <Input
                id="senderEmail"
                type="email"
                placeholder="z.B. max@beispiel.de"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="senderPhone">Telefonnummer</Label>
              <Input
                id="senderPhone"
                placeholder="z.B. +49 123 456789"
                value={senderPhone}
                onChange={(e) => setSenderPhone(e.target.value)}
              />
            </div>
          </div>

          {/* Vorschau */}
          {(senderName || senderTitle || senderEmail || senderPhone) && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="mb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">Vorschau Signatur</p>
              <div className="font-medium">{senderName || "–"}</div>
              {senderTitle && <div className="text-muted-foreground">{senderTitle}</div>}
              {senderEmail && <div className="text-muted-foreground">{senderEmail}</div>}
              {senderPhone && <div className="text-muted-foreground">{senderPhone}</div>}
            </div>
          )}

          <Button onClick={handleSaveSignature} disabled={savingSignature} className="gap-2">
            {savingSignature ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : signatureSaved ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : null}
            {signatureSaved ? "Gespeichert" : "Speichern"}
          </Button>
        </CardContent>
      </Card>

      {/* Admin-Verweis */}
      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-red-600" />
              Administration
            </CardTitle>
            <CardDescription>
              API-Konfiguration, Scoring-Gewichtung und Datenverwaltung sind im Admin-Bereich verfügbar.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/admin/settings">
              <Button className="gap-2">
                System-Einstellungen öffnen
                <ExternalLink className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Hinweis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              API-Konfiguration und Scoring-Gewichtung werden vom Administrator verwaltet.
              Bei Fragen wenden Sie sich an Ihren Administrator.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
