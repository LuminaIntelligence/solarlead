"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft, Plus, Trash2, Star, Loader2, Save, Linkedin,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";

interface Template {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  is_active: boolean;
  is_default: boolean;
}

export default function LinkedInTemplatesPage() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Template | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/outreach/linkedin/templates");
      if (res.ok) {
        const d = await res.json();
        setTemplates(d.templates ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startNew() {
    setEditing({
      id: "",
      name: "",
      subject: "",
      body: "Guten Tag {firstname},\n\n",
      is_active: true,
      is_default: false,
    });
  }

  async function handleSave() {
    if (!editing) return;
    if (!editing.name.trim() || !editing.body.trim()) {
      toast({ title: "Name und Body sind Pflicht", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const method = editing.id ? "PATCH" : "POST";
      const url = editing.id
        ? `/api/admin/outreach/linkedin/templates/${editing.id}`
        : "/api/admin/outreach/linkedin/templates";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editing.name,
          subject: editing.subject,
          body: editing.body,
          is_active: editing.is_active,
          is_default: editing.is_default,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        toast({ title: "Fehler", description: d.error, variant: "destructive" });
        return;
      }
      toast({ title: editing.id ? "Aktualisiert" : "Angelegt" });
      setEditing(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Template wirklich löschen?")) return;
    const res = await fetch(`/api/admin/outreach/linkedin/templates/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast({ title: "Gelöscht" });
      await load();
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/outreach/linkedin"
          className="text-slate-500 hover:text-slate-900"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Linkedin className="h-6 w-6 text-blue-700" /> LinkedIn-Templates
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Vorlagen für InMails. Default-Template wird beim Job-Öffnen automatisch
            vorausgewählt.
          </p>
        </div>
        <Button onClick={startNew}>
          <Plus className="h-4 w-4 mr-1.5" /> Neue Vorlage
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          ) : templates.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              Noch keine Templates.
            </div>
          ) : (
            <div className="divide-y">
              {templates.map((t) => (
                <div key={t.id} className="p-4 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">{t.name}</span>
                      {t.is_default && (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                          <Star className="h-2.5 w-2.5 mr-1 inline" /> Default
                        </Badge>
                      )}
                      {!t.is_active && (
                        <Badge variant="secondary" className="bg-slate-200 text-slate-600">
                          Inaktiv
                        </Badge>
                      )}
                    </div>
                    {t.subject && (
                      <div className="text-xs text-slate-600 mb-1">
                        Betreff: <span className="italic">{t.subject}</span>
                      </div>
                    )}
                    <p className="text-xs text-slate-600 whitespace-pre-wrap line-clamp-4 font-mono bg-slate-50 p-2 rounded">
                      {t.body}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={() => setEditing(t)}>
                      Bearbeiten
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(t.id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit-Dialog */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full p-5 space-y-3">
            <h3 className="font-semibold text-lg">
              {editing.id ? "Template bearbeiten" : "Neues Template"}
            </h3>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Name (intern)
              </label>
              <input
                type="text"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Betreff (max 200 Zeichen)
              </label>
              <input
                type="text"
                value={editing.subject ?? ""}
                onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                maxLength={200}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Body (max 2000 Zeichen) — Tokens:{" "}
                <code>{"{firstname}"}</code> <code>{"{lastname}"}</code>{" "}
                <code>{"{salutation_lastname}"}</code>{" "}
                <code>{"{company}"}</code> <code>{"{city}"}</code>{" "}
                <code>{"{title}"}</code> <code>{"{roof_m2_formatted}"}</code>{" "}
                <code>{"{lease}"}</code>
              </label>
              <textarea
                value={editing.body}
                onChange={(e) => setEditing({ ...editing, body: e.target.value })}
                maxLength={2000}
                rows={10}
                className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-mono"
              />
              <div className="text-xs text-slate-500 mt-1">
                {editing.body.length}/2000
              </div>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.is_active}
                  onChange={(e) =>
                    setEditing({ ...editing, is_active: e.target.checked })
                  }
                />
                Aktiv
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editing.is_default}
                  onChange={(e) =>
                    setEditing({ ...editing, is_default: e.target.checked })
                  }
                />
                Default
              </label>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => setEditing(null)}>
                Abbrechen
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                Speichern
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
