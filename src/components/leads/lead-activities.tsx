"use client";

import { useState } from "react";
import {
  Phone,
  Mail,
  Calendar,
  FileText,
  CheckSquare,
  Plus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { LeadActivity } from "@/types/database";

interface LeadActivitiesProps {
  leadId: string;
  initialActivities: LeadActivity[];
}

type ActivityType = LeadActivity["type"];

const TYPE_CONFIG: Record<
  ActivityType,
  { label: string; Icon: React.ComponentType<{ className?: string }>; color: string; bgColor: string }
> = {
  call: { label: "Anruf", Icon: Phone, color: "text-blue-600", bgColor: "bg-blue-100" },
  email: { label: "E-Mail", Icon: Mail, color: "text-green-600", bgColor: "bg-green-100" },
  meeting: { label: "Treffen", Icon: Calendar, color: "text-purple-600", bgColor: "bg-purple-100" },
  note: { label: "Notiz", Icon: FileText, color: "text-orange-600", bgColor: "bg-orange-100" },
  task: { label: "Aufgabe", Icon: CheckSquare, color: "text-slate-600", bgColor: "bg-slate-100" },
};

function formatDateDE(dateStr: string): string {
  return new Date(dateStr).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateOnlyDE(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function nowLocalDatetimeValue(): string {
  const now = new Date();
  // Format: YYYY-MM-DDTHH:mm (required for datetime-local input)
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function LeadActivities({
  leadId,
  initialActivities,
}: LeadActivitiesProps) {
  const [activities, setActivities] = useState<LeadActivity[]>(initialActivities);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    type: "call" as ActivityType,
    subject: "",
    description: "",
    activity_date: nowLocalDatetimeValue(),
    next_action: "",
    next_action_date: "",
  });

  function handleChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          type: form.type,
          subject: form.subject || null,
          description: form.description || null,
          activity_date: new Date(form.activity_date).toISOString(),
          next_action: form.next_action || null,
          next_action_date: form.next_action_date || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Fehler beim Speichern");
      }

      const created: LeadActivity = await res.json();
      setActivities((prev) => [created, ...prev]);
      setShowForm(false);
      setForm({
        type: "call",
        subject: "",
        description: "",
        activity_date: nowLocalDatetimeValue(),
        next_action: "",
        next_action_date: "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {activities.length === 0
            ? "Noch keine Aktivitäten vorhanden"
            : `${activities.length} Aktivität${activities.length !== 1 ? "en" : ""}`}
        </p>
        {!showForm && (
          <Button
            size="sm"
            onClick={() => setShowForm(true)}
            className="gap-1.5"
          >
            <Plus className="h-4 w-4" />
            Aktivität hinzufügen
          </Button>
        )}
      </div>

      {/* Inline-Formular */}
      {showForm && (
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Neue Aktivität</h4>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="type">Typ</Label>
                <select
                  id="type"
                  name="type"
                  value={form.type}
                  onChange={handleChange}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="call">Anruf</option>
                  <option value="email">E-Mail</option>
                  <option value="meeting">Treffen</option>
                  <option value="note">Notiz</option>
                  <option value="task">Aufgabe</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="activity_date">Datum & Uhrzeit</Label>
                <Input
                  id="activity_date"
                  name="activity_date"
                  type="datetime-local"
                  value={form.activity_date}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="subject">Betreff</Label>
              <Input
                id="subject"
                name="subject"
                value={form.subject}
                onChange={handleChange}
                placeholder="Kurze Zusammenfassung..."
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="description">Beschreibung</Label>
              <Textarea
                id="description"
                name="description"
                value={form.description}
                onChange={handleChange}
                placeholder="Details zur Aktivität..."
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="next_action">Nächste Aktion (optional)</Label>
                <Input
                  id="next_action"
                  name="next_action"
                  value={form.next_action}
                  onChange={handleChange}
                  placeholder="z.B. Angebot senden..."
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="next_action_date">Datum nächste Aktion (optional)</Label>
                <Input
                  id="next_action_date"
                  name="next_action_date"
                  type="date"
                  value={form.next_action_date}
                  onChange={handleChange}
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowForm(false)}
              >
                Abbrechen
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? "Speichern..." : "Speichern"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Timeline */}
      {activities.length === 0 && !showForm ? (
        <div className="py-10 text-center">
          <FileText className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground text-sm">
            Noch keine Aktivitäten. Klicken Sie auf „Aktivität hinzufügen", um zu beginnen.
          </p>
        </div>
      ) : activities.length > 0 ? (
        <div className="relative space-y-0">
          {activities.map((activity, index) => {
            const cfg = TYPE_CONFIG[activity.type];
            const { Icon } = cfg;
            const isLast = index === activities.length - 1;
            return (
              <div key={activity.id} className="flex gap-3">
                {/* Timeline line & icon */}
                <div className="flex flex-col items-center">
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cfg.bgColor}`}
                  >
                    <Icon className={`h-4 w-4 ${cfg.color}`} />
                  </div>
                  {!isLast && (
                    <div className="w-px flex-1 bg-border mt-1 mb-1 min-h-[16px]" />
                  )}
                </div>

                {/* Content */}
                <div className={`pb-4 min-w-0 flex-1 ${isLast ? "" : ""}`}>
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-xs font-medium text-muted-foreground">
                      {cfg.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateDE(activity.activity_date)}
                    </span>
                  </div>
                  {activity.subject && (
                    <p className="text-sm font-semibold mt-0.5">{activity.subject}</p>
                  )}
                  {activity.description && (
                    <p className="text-sm text-muted-foreground mt-0.5 whitespace-pre-wrap">
                      {activity.description}
                    </p>
                  )}
                  {activity.next_action && (
                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className="text-xs">
                        Nächste Aktion: {activity.next_action}
                        {activity.next_action_date
                          ? ` (${formatDateOnlyDE(activity.next_action_date)})`
                          : ""}
                      </Badge>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {activities.length > 0 && !showForm && (
        <div className="pt-1">
          <Separator />
          <div className="pt-3 flex justify-center">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowForm(true)}
              className="gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Aktivität hinzufügen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
