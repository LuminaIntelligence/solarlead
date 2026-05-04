"use client";

/**
 * EditableField — a generic inline-edit input.
 *
 * Default state: shows the value. On hover a pencil icon appears.
 * Click value or pencil → switches to input mode. Enter / blur saves;
 * Escape cancels.
 *
 * Usage:
 *   <EditableField
 *     label="Telefon"
 *     value={lead.phone}
 *     onSave={async (v) => { await fetch("/api/leads/...", { method: "PATCH", body: JSON.stringify({ phone: v }) }); }}
 *     placeholder="+49 ..."
 *     type="tel"
 *   />
 *
 * The component is "uncontrolled by save" — it shows whatever you pass as
 * value, optimistically updates on save, and reverts on save failure.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Pencil, X, Loader2 } from "lucide-react";

type FieldType = "text" | "email" | "tel" | "url" | "textarea" | "number";

interface EditableFieldProps {
  label?: string;
  value: string | number | null | undefined;
  onSave: (newValue: string | null) => Promise<void> | void;
  placeholder?: string;
  type?: FieldType;
  multiline?: boolean;
  /** Render as a link if not editing (e.g. mailto:, tel:, https://) */
  linkPrefix?: "mailto:" | "tel:" | "url" | null;
  /** Optional icon to show next to the value */
  icon?: React.ReactNode;
  /** Disable editing (read-only) — e.g. for users without permission */
  readOnly?: boolean;
  /** Custom validator, return error message string or null if OK */
  validate?: (v: string) => string | null;
  /** Optional renderer for the display value (e.g. format date/number) */
  formatDisplay?: (v: string | number | null | undefined) => React.ReactNode;
  className?: string;
}

export function EditableField({
  label,
  value,
  onSave,
  placeholder = "—",
  type = "text",
  multiline = false,
  linkPrefix = null,
  icon,
  readOnly = false,
  validate,
  formatDisplay,
  className = "",
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  // Sync draft when prop value changes (e.g. after refetch)
  useEffect(() => {
    if (!editing) setDraft(value == null ? "" : String(value));
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if ("select" in inputRef.current) inputRef.current.select();
    }
  }, [editing]);

  function startEdit() {
    if (readOnly) return;
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft(value == null ? "" : String(value));
    setError(null);
  }

  async function save() {
    const trimmed = draft.trim();
    const original = value == null ? "" : String(value);
    if (trimmed === original) {
      setEditing(false);
      return;
    }
    if (validate) {
      const e = validate(trimmed);
      if (e) {
        setError(e);
        return;
      }
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed === "" ? null : trimmed);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Speichern fehlgeschlagen");
    } finally {
      setSaving(false);
    }
  }

  const displayValue = formatDisplay
    ? formatDisplay(value)
    : value == null || String(value).trim() === ""
    ? <span className="text-slate-400 italic">{placeholder}</span>
    : String(value);

  // — Read mode —
  if (!editing) {
    const linkHref =
      linkPrefix === "mailto:" && value
        ? `mailto:${value}`
        : linkPrefix === "tel:" && value
        ? `tel:${value}`
        : linkPrefix === "url" && value
        ? String(value).startsWith("http") ? String(value) : `https://${value}`
        : null;

    return (
      <div className={`group flex items-start gap-2 ${className}`}>
        {label && (
          <span className="text-xs text-slate-500 shrink-0 w-28 pt-0.5">{label}</span>
        )}
        <div className="flex-1 flex items-center gap-1.5 min-w-0">
          {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
          {linkHref ? (
            <a
              href={linkHref}
              target={linkPrefix === "url" ? "_blank" : undefined}
              rel={linkPrefix === "url" ? "noopener noreferrer" : undefined}
              className="text-blue-600 hover:underline truncate"
            >
              {displayValue}
            </a>
          ) : (
            <span className="text-slate-900 truncate">{displayValue}</span>
          )}
          {!readOnly && (
            <button
              onClick={startEdit}
              type="button"
              className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-700 shrink-0"
              title="Bearbeiten"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // — Edit mode —
  return (
    <div className={`flex items-start gap-2 ${className}`}>
      {label && (
        <span className="text-xs text-slate-500 shrink-0 w-28 pt-2">{label}</span>
      )}
      <div className="flex-1 flex items-center gap-1.5 min-w-0">
        {multiline || type === "textarea" ? (
          <textarea
            ref={(r) => { inputRef.current = r; }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
            }}
            rows={3}
            placeholder={placeholder}
            className="flex-1 min-w-0 px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        ) : (
          <input
            ref={(r) => { inputRef.current = r; }}
            type={type === "number" ? "number" : type}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); cancel(); }
              if (e.key === "Enter") { e.preventDefault(); void save(); }
            }}
            placeholder={placeholder}
            className="flex-1 min-w-0 px-2 py-1 text-sm border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
        )}
        <button
          onClick={() => void save()}
          disabled={saving}
          type="button"
          className="shrink-0 p-1 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
          title="Speichern (Enter)"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={cancel}
          disabled={saving}
          type="button"
          className="shrink-0 p-1 text-slate-500 hover:bg-slate-100 rounded disabled:opacity-50"
          title="Abbrechen (Escape)"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && (
        <span className="text-xs text-red-600 ml-2">{error}</span>
      )}
    </div>
  );
}
