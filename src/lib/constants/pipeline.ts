export const PIPELINE_STAGES = [
  { value: "interested",        label: "Interessiert",      color: "bg-blue-100 text-blue-700" },
  { value: "meeting_scheduled", label: "Termin vereinbart", color: "bg-purple-100 text-purple-700" },
  { value: "offer_sent",        label: "Angebot gesendet",  color: "bg-yellow-100 text-yellow-700" },
  { value: "closed_won",        label: "Gewonnen 🎉",        color: "bg-green-100 text-green-700" },
  { value: "closed_lost",       label: "Verloren",          color: "bg-slate-100 text-slate-500" },
] as const;

export type PipelineStageValue = (typeof PIPELINE_STAGES)[number]["value"];
