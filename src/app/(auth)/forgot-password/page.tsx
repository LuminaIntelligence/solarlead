"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sun, Loader2, Mail, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [currentSessionEmail, setCurrentSessionEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) {
        setCurrentSessionEmail(user.email);
        setEmail(user.email);
      }
    });
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.refresh();
    setCurrentSessionEmail(null);
    setSigningOut(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: "https://solarleadgen.lumina-intelligence.ai/auth/callback?next=/reset-password",
      });

      if (error) {
        const lower = error.message.toLowerCase();
        let description = error.message;
        if (lower.includes("rate") || lower.includes("limit") || lower.includes("too many")) {
          description =
            "Zu viele Reset-Versuche in kurzer Zeit. Bitte in 1 Stunde nochmal versuchen oder Admin um manuelles Zurücksetzen bitten.";
        } else if (lower.includes("smtp") || lower.includes("send") || lower.includes("email") && lower.includes("disabled")) {
          description =
            "Reset-Email konnte nicht versendet werden (SMTP nicht konfiguriert). Bitte Admin kontaktieren — er kann das Passwort direkt setzen.";
        }
        toast({
          variant: "destructive",
          title: "Fehler beim Reset-Versand",
          description,
        });
        return;
      }

      setSent(true);
    } catch {
      toast({
        variant: "destructive",
        title: "Ein Fehler ist aufgetreten",
        description: "Bitte später erneut versuchen oder Admin kontaktieren.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center space-y-2">
        <div className="flex justify-center mb-2">
          <div className="rounded-full bg-primary/10 p-3">
            <Sun className="h-8 w-8 text-primary" />
          </div>
        </div>
        <CardTitle className="text-2xl font-bold">
          Passwort zurücksetzen
        </CardTitle>
        <CardDescription>
          Geben Sie Ihre E-Mail-Adresse ein
        </CardDescription>
      </CardHeader>
      {currentSessionEmail && !sent && (
        <CardContent className="space-y-3 pt-0">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm space-y-2">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
              <div className="text-amber-900">
                <strong>Du bist aktuell eingeloggt</strong> als{" "}
                <code className="font-mono">{currentSessionEmail}</code>.
                Wenn du ein neues Passwort setzt bleibt diese Session aktiv,
                bis du dich ausloggst oder die Session abläuft (~1h).
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full"
            >
              {signingOut && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
              Jetzt abmelden
            </Button>
          </div>
        </CardContent>
      )}
      {sent ? (
        <CardContent className="space-y-4">
          <div className="flex flex-col items-center space-y-3 py-4">
            <div className="rounded-full bg-primary/10 p-3">
              <Mail className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Wir haben Ihnen eine E-Mail mit einem Link zum Zurücksetzen Ihres
              Passworts gesendet.
            </p>
            <p className="text-xs text-slate-500 text-center">
              Email nicht angekommen? Spam-Ordner prüfen oder Admin kontaktieren —
              er kann das Passwort auch direkt setzen.
            </p>
          </div>
        </CardContent>
      ) : (
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-Mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Wird gesendet...
                </>
              ) : (
                "Link senden"
              )}
            </Button>
          </CardFooter>
        </form>
      )}
      <CardFooter className="justify-center">
        <Link
          href="/login"
          className="text-sm text-primary hover:underline font-medium"
        >
          Zurück zur Anmeldung
        </Link>
      </CardFooter>
    </Card>
  );
}
