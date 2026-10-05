"use client";

import { useState, useEffect } from "react";
import { CalendarClock, X } from "lucide-react";

interface FollowUpDateDialogProps {
  open: boolean;
  defaultDate?: string | null;
  companyName?: string;
  onConfirm: (date: string) => void;
  onCancel: () => void;
}

/**
 * Mini-Modal zum Setzen eines Wiedervorlage-Datums.
 * Default: heute + 7 Tage. Darunter Shortcut-Buttons für +1 Woche,
 * +2 Wochen, +1 Monat. ESC schließt.
 */
export function FollowUpDateDialog({
  open,
  defaultDate,
  companyName,
  onConfirm,
  onCancel,
}: FollowUpDateDialogProps) {
  const [date, setDate] = useState<string>(() => {
    if (defaultDate) return defaultDate.slice(0, 10);
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm(date);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, date, onConfirm, onCancel]);

  if (!open) return null;

  const today = new Date().toISOString().slice(0, 10);

  function addDays(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center">
              <CalendarClock className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Wiedervorlage</h2>
              <p className="text-xs text-slate-500">
                Wann möchtest du dich erinnern lassen?
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Schließen"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {companyName && (
          <div className="mb-4 text-sm text-slate-600 bg-slate-50 rounded-md px-3 py-2">
            {companyName}
          </div>
        )}

        <label className="block text-xs font-medium text-slate-600 mb-1">
          Datum der Wiedervorlage
        </label>
        <input
          type="date"
          value={date}
          min={today}
          onChange={(e) => setDate(e.target.value)}
          className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          autoFocus
        />

        <div className="flex gap-1.5 mt-3">
          <button
            type="button"
            onClick={() => addDays(7)}
            className="flex-1 text-xs px-2 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-600"
          >
            +1 Woche
          </button>
          <button
            type="button"
            onClick={() => addDays(14)}
            className="flex-1 text-xs px-2 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-600"
          >
            +2 Wochen
          </button>
          <button
            type="button"
            onClick={() => addDays(30)}
            className="flex-1 text-xs px-2 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-600"
          >
            +1 Monat
          </button>
        </div>

        <div className="flex gap-2 mt-6">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-slate-300 rounded-md text-sm font-medium hover:bg-slate-50"
          >
            Abbrechen
          </button>
          <button
            onClick={() => onConfirm(date)}
            className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-md text-sm font-medium hover:bg-orange-600"
          >
            Erinnern
          </button>
        </div>
      </div>
    </div>
  );
}
