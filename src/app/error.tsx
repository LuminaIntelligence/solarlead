"use client";

import { useEffect } from "react";

/**
 * Globale Error Boundary für die App.
 *
 * Zeigt im UI an WAS crashed (Error-Name, Message, Stack-Anfang),
 * statt der generischen "Application error: a client-side exception"
 * von Next.js. Damit kann der User die Fehlermeldung direkt
 * weitergeben statt erst die Browser-Console öffnen zu müssen.
 *
 * "Erneut versuchen" reset()-tet die Error-Boundary, was den
 * fehlgeschlagenen Render nochmal probiert (oft hilft das bei
 * Hydration- oder Race-Bugs).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Console-Log behalten — Hilfreich für die DevTools-Inspektion
    console.error("[App Error Boundary]", error);
  }, [error]);

  // Spezialfall: Server-Action-ID passt nicht mehr (typisch nach Deploy
  // mit alter offener Browser-Session). "reset()" hilft nicht — die Seite
  // muss komplett neu geladen werden damit neue Action-IDs im HTML sind.
  const isStaleAction =
    error.message?.includes("Server Action") &&
    error.message?.includes("was not found");

  if (isStaleAction) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-8">
        <div className="max-w-lg w-full bg-white rounded-lg shadow-sm border border-amber-200 p-6 text-center">
          <div className="h-12 w-12 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center text-2xl mx-auto mb-3">
            ↻
          </div>
          <h1 className="text-lg font-semibold text-slate-900 mb-2">
            Diese Seite ist veraltet
          </h1>
          <p className="text-sm text-slate-600 mb-5">
            Nach einem Update braucht dein Browser die aktuelle Version.
            Ein Klick auf „Neu laden" reicht — deine Eingaben sind nicht
            verloren, du kannst sie danach noch mal machen.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 bg-slate-900 text-white rounded-md text-sm font-medium hover:bg-slate-700 transition-colors"
          >
            Jetzt neu laden
          </button>
          <details className="mt-6 text-left">
            <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
              Technische Details
            </summary>
            <pre className="mt-2 text-[10px] text-slate-500 bg-slate-50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
              {error.message}
            </pre>
          </details>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-8">
      <div className="max-w-2xl w-full bg-white rounded-lg shadow-sm border border-red-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-lg font-bold">
            !
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              Etwas ist schiefgelaufen
            </h1>
            <p className="text-xs text-slate-500">
              Die Seite konnte nicht geladen werden.
            </p>
          </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded p-3 mb-4 text-xs font-mono overflow-x-auto">
          <div className="text-slate-500 mb-1">{error.name}</div>
          <div className="text-red-700 font-medium break-words whitespace-pre-wrap">
            {error.message || "Kein Detail verfügbar"}
          </div>
          {error.digest && (
            <div className="mt-2 text-slate-400">
              Digest: <span className="select-all">{error.digest}</span>
            </div>
          )}
          {error.stack && (
            <details className="mt-2">
              <summary className="cursor-pointer text-slate-500 hover:text-slate-700">
                Stack-Trace anzeigen
              </summary>
              <pre className="mt-1 text-[10px] text-slate-600 overflow-x-auto whitespace-pre-wrap">
                {error.stack}
              </pre>
            </details>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={reset}
            className="px-4 py-2 bg-slate-900 text-white rounded text-sm font-medium hover:bg-slate-700"
          >
            Erneut versuchen
          </button>
          <a
            href="/dashboard"
            className="px-4 py-2 border border-slate-300 rounded text-sm font-medium hover:bg-slate-50"
          >
            Zum Dashboard
          </a>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          Wenn der Fehler weiter auftritt: Text oben kopieren und an Support
          weitergeben.
        </p>
      </div>
    </div>
  );
}
