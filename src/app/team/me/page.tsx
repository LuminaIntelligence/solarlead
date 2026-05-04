"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Trophy, Calendar, Phone, AlertCircle, TrendingUp, Inbox } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MyStats {
  user_id: string;
  open: number;
  overdue: number;
  total_assigned_ever: number;
  this_month: {
    appointments: number;
    won: number;
    lost: number;
    not_interested: number;
    closed: number;
    won_value_eur: number;
    win_rate: number;
  };
  recent_wins: Array<{ company: string; value_eur: number; at: string }>;
}

export default function TeamMePage() {
  const [stats, setStats] = useState<MyStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/team/me/stats")
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || !stats) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  const winRatePct = Math.round(stats.this_month.win_rate * 100);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Meine Stats</h1>
          <p className="text-sm text-slate-500">Performance-Übersicht für den aktuellen Monat</p>
        </div>
        <Link href="/team/inbox" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
          <Inbox className="h-4 w-4" /> Zur Inbox
        </Link>
      </div>

      {/* Top counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Offene Replies" value={stats.open} color="bg-blue-50 border-blue-200 text-blue-900" icon={<Inbox className="h-4 w-4" />} />
        <StatCard label="Überfällig" value={stats.overdue} color={stats.overdue > 0 ? "bg-red-50 border-red-200 text-red-900" : "bg-slate-50 border-slate-200 text-slate-700"} icon={<AlertCircle className="h-4 w-4" />} />
        <StatCard label="Termine d. Monats" value={stats.this_month.appointments} color="bg-purple-50 border-purple-200 text-purple-900" icon={<Calendar className="h-4 w-4" />} />
        <StatCard label="Wins d. Monats" value={stats.this_month.won} color="bg-green-50 border-green-200 text-green-900" icon={<Trophy className="h-4 w-4" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* This month performance */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600" /> Performance diesen Monat
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-slate-700 font-medium">Win-Rate</span>
                <span className={`text-2xl font-bold ${winRatePct >= 30 ? "text-green-600" : winRatePct >= 15 ? "text-amber-600" : "text-slate-500"}`}>
                  {winRatePct}%
                </span>
              </div>
              <div className="text-xs text-slate-500">
                {stats.this_month.won} Wins von {stats.this_month.closed} abgeschlossenen
              </div>
              <div className="h-2 rounded-full bg-slate-100 mt-2 overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${Math.min(100, winRatePct)}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center pt-3 border-t border-slate-100">
              <div>
                <div className="text-2xl font-bold text-green-600">{stats.this_month.won}</div>
                <div className="text-xs text-slate-500">Won 🎉</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">{stats.this_month.lost}</div>
                <div className="text-xs text-slate-500">Lost</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-500">{stats.this_month.not_interested}</div>
                <div className="text-xs text-slate-500">Kein Interesse</div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100">
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-slate-700 font-medium">Volumen (Won)</span>
                <span className="text-2xl font-bold text-green-700">
                  €{stats.this_month.won_value_eur.toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recent wins */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Trophy className="h-4 w-4 text-yellow-500" /> Letzte Wins
            </CardTitle>
          </CardHeader>
          <CardContent>
            {stats.recent_wins.length === 0 ? (
              <p className="text-sm text-slate-400 italic text-center py-6">
                Noch keine Wins diesen Monat — du schaffst das!
              </p>
            ) : (
              <ul className="space-y-2">
                {stats.recent_wins.map((w, i) => (
                  <li key={i} className="flex items-center justify-between border-b border-slate-100 last:border-0 pb-2 last:pb-0">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">{w.company}</p>
                      <p className="text-xs text-slate-500">
                        {new Date(w.at).toLocaleDateString("de-DE", { day: "2-digit", month: "long" })}
                      </p>
                    </div>
                    <span className="text-green-700 font-semibold tabular-nums">
                      €{w.value_eur.toLocaleString("de-DE", { maximumFractionDigits: 0 })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lifetime */}
      <Card className="bg-slate-50 border-slate-200">
        <CardContent className="py-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-700">Insgesamt zugewiesen (alle Zeit)</p>
            <p className="text-xs text-slate-400">Anzahl Replies seit Beginn</p>
          </div>
          <span className="text-3xl font-bold text-slate-700">{stats.total_assigned_ever}</span>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ReactNode }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${color}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide opacity-70">
        {icon}{label}
      </div>
      <div className="text-2xl font-bold mt-0.5">{value}</div>
    </div>
  );
}
