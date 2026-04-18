"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Settings, Shield, ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { getUserSettings } from "@/lib/actions/settings";

export default function SettingsPage() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [providerMode, setProviderMode] = useState<string>("mock");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setIsAdmin(user?.user_metadata?.role === "admin");

      const settings = await getUserSettings();
      if (settings) {
        setProviderMode(settings.provider_mode);
      }
      setLoading(false);
    }
    load();
  }, []);

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
