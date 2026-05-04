/**
 * Reply-Outcome catalog — labels, colors, and quick-action defaults.
 *
 * "Quick action defaults" describe what should happen automatically when
 * a specialist picks an outcome. E.g. "callback_requested" should also set
 * a next_action_at = tomorrow 10:00 by default (specialist can override).
 */
import type { ReplyOutcome, ActivityKind } from "@/types/database";

export const OUTCOME_OPTIONS: Array<{
  value: ReplyOutcome;
  label: string;
  short: string;
  color: string;          // Tailwind classes for badge
  emoji: string;
  description: string;
  /** Should picking this outcome auto-suggest a reminder X days from now? */
  defaultReminderDays?: number;
  /** Is this a terminal state (no further follow-up needed)? */
  terminal?: boolean;
}> = [
  {
    value: "new",
    label: "Neu / unbearbeitet",
    short: "Neu",
    color: "bg-blue-100 text-blue-800",
    emoji: "✨",
    description: "Reply ist eingegangen, niemand hat reingeschaut.",
  },
  {
    value: "in_progress",
    label: "In Bearbeitung",
    short: "In Arbeit",
    color: "bg-indigo-100 text-indigo-800",
    emoji: "🔧",
    description: "Specialist arbeitet aktiv dran.",
  },
  {
    value: "appointment_set",
    label: "Termin vereinbart",
    short: "Termin",
    color: "bg-purple-100 text-purple-800",
    emoji: "📅",
    description: "Konkreter Termin (Telefon, Vor-Ort, Video) steht.",
    defaultReminderDays: 7,
  },
  {
    value: "callback_requested",
    label: "Rückruf erbeten",
    short: "Rückruf",
    color: "bg-amber-100 text-amber-800",
    emoji: "📞",
    description: "Kunde will Rückruf zu einem späteren Zeitpunkt.",
    defaultReminderDays: 1,
  },
  {
    value: "not_reached",
    label: "Nicht erreicht",
    short: "Nicht da",
    color: "bg-orange-100 text-orange-800",
    emoji: "📵",
    description: "Mehrfach erfolglos versucht — nochmal in einigen Tagen probieren.",
    defaultReminderDays: 3,
  },
  {
    value: "on_hold",
    label: "Wartet (z.B. Urlaub)",
    short: "Pause",
    color: "bg-yellow-100 text-yellow-800",
    emoji: "⏸️",
    description: "Kunde will später, später nochmal hinterfragen.",
    defaultReminderDays: 14,
  },
  {
    value: "not_interested",
    label: "Kein Interesse",
    short: "Kein Interesse",
    color: "bg-slate-100 text-slate-700",
    emoji: "❌",
    description: "Höflich abgesagt — Lead deaktiviert.",
    terminal: true,
  },
  {
    value: "closed_won",
    label: "Gewonnen 🎉",
    short: "Won",
    color: "bg-green-100 text-green-800",
    emoji: "✅",
    description: "Auftrag im Sack — bitte Deal-Wert eintragen.",
    terminal: true,
  },
  {
    value: "closed_lost",
    label: "Verloren",
    short: "Lost",
    color: "bg-red-100 text-red-800",
    emoji: "🚫",
    description: "Wettbewerber, Budget, Timing — Lead nicht gewonnen.",
    terminal: true,
  },
];

export function outcomeMeta(value: ReplyOutcome) {
  return OUTCOME_OPTIONS.find((o) => o.value === value) ?? OUTCOME_OPTIONS[0];
}

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, { label: string; emoji: string; color: string }> = {
  call_attempted:   { label: "Anruf-Versuch",  emoji: "📞", color: "text-orange-600" },
  call_connected:   { label: "Anruf",          emoji: "📞", color: "text-green-600" },
  email_sent:       { label: "E-Mail gesendet", emoji: "✉️", color: "text-blue-600" },
  note:             { label: "Notiz",          emoji: "📝", color: "text-slate-700" },
  stage_changed:    { label: "Pipeline-Stage", emoji: "🎯", color: "text-purple-600" },
  outcome_changed:  { label: "Outcome",        emoji: "🔄", color: "text-indigo-600" },
  reminder_set:     { label: "Wiedervorlage",  emoji: "⏰", color: "text-amber-600" },
  reassigned:       { label: "Zugewiesen",     emoji: "👤", color: "text-blue-700" },
  claimed:          { label: "Übernommen",     emoji: "🙋", color: "text-blue-700" },
};

/** SLA thresholds — used by inbox queries and the admin overview. */
export const SLA = {
  ASSIGN_HOURS: 3,    // pool replies must be assigned within 3h
  RESPOND_HOURS: 24,  // assigned replies must have first activity within 24h
} as const;
