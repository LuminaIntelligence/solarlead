import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Radar, Plus, CheckCircle2, Clock, XCircle, PauseCircle, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { DiscoveryCampaign } from "@/types/database";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pending:   { label: "Ausstehend",    className: "bg-slate-700 text-slate-300" },
    running:   { label: "Läuft…",        className: "bg-blue-700/40 text-blue-300 animate-pulse" },
    completed: { label: "Abgeschlossen", className: "bg-green-700/40 text-green-300" },
    failed:    { label: "Fehler",        className: "bg-red-700/40 text-red-300" },
    paused:    { label: "Pausiert",      className: "bg-yellow-700/40 text-yellow-300" },
  };
  const { label, className } = map[status] ?? { label: status, className: "bg-slate-700 text-slate-300" };
  return <Badge className={`${className} border-0 text-xs`}>{label}</Badge>;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-green-400" />;
  if (status === "running")   return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />;
  if (status === "failed")    return <XCircle className="h-4 w-4 text-red-400" />;
  if (status === "paused")    return <PauseCircle className="h-4 w-4 text-yellow-400" />;
  return <Clock className="h-4 w-4 text-slate-400" />;
}

export default async function DiscoveryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.user_metadata?.role !== "admin") redirect("/dashboard");

  const { data: campaigns } = await supabase
    .from("discovery_campaigns")
    .select("*")
    .order("created_at", { ascending: false });

  const list: DiscoveryCampaign[] = campaigns ?? [];

  const totalDiscovered = list.reduce((s, c) => s + c.total_discovered, 0);
  const totalReady      = list.reduce((s, c) => s + c.total_ready, 0);
  const totalApproved   = list.reduce((s, c) => s + c.total_approved, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Radar className="h-6 w-6 text-[#B2D082]" />
            Lead-Entdeckung
          </h1>
          <p className="text-slate-600 text-sm mt-0.5">
            Automatische Suche nach geeigneten Dachflächen via Google Places + Apollo
          </p>
        </div>
        <Link
          href="/admin/discovery/new"
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-[#1F3D2E]"
          style={{ backgroundColor: "#B2D082" }}
        >
          <Plus className="h-4 w-4" />
          Neue Kampagne
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Kampagnen", value: list.length },
          { label: "Entdeckt", value: totalDiscovered },
          { label: "Bereit zur Prüfung", value: totalReady },
          { label: "Genehmigt", value: totalApproved },
        ].map((s) => (
          <Card key={s.label} className="bg-white border-slate-200">
            <CardContent className="pt-5">
              <div className="text-2xl font-bold text-slate-900">{s.value}</div>
              <div className="text-xs text-slate-500 mt-1">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Campaign list */}
      {list.length === 0 ? (
        <Card className="bg-white border-slate-200">
          <CardContent className="py-16 text-center">
            <Radar className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500">Noch keine Kampagnen angelegt.</p>
            <p className="text-slate-400 text-sm mt-1">
              Erstelle eine Kampagne um automatisch Leads zu entdecken und anzureichern.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-white border-slate-200">
          <CardHeader>
            <CardTitle className="text-slate-900 text-base">Alle Kampagnen</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  {["Status", "Name", "Gebiete", "Branchen", "Entdeckt", "Bereit", "Genehmigt", "Erstellt", ""].map((h) => (
                    <th key={h} className="px-4 py-3 font-medium text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const areas = (c.areas as { value: string }[]) ?? [];
                  const cats  = (c.categories as string[]) ?? [];
                  return (
                    <tr key={c.id} className="border-b border-slate-200 last:border-0 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusIcon status={c.status} />
                          <StatusBadge status={c.status} />
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">{c.name}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {areas.slice(0, 2).map((a) => a.value).join(", ")}
                        {areas.length > 2 && ` +${areas.length - 2}`}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {cats.length} Branche{cats.length !== 1 ? "n" : ""}
                      </td>
                      <td className="px-4 py-3 text-slate-900 font-medium">{c.total_discovered}</td>
                      <td className="px-4 py-3 text-slate-900">{c.total_ready}</td>
                      <td className="px-4 py-3">
                        <span className="text-[#B2D082] font-medium">{c.total_approved}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {new Date(c.created_at).toLocaleDateString("de-DE")}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/discovery/${c.id}`}
                          className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
                        >
                          Öffnen →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
