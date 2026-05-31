import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, RefreshCw, X } from "lucide-react";

import { useT } from "./i18n";
import { cn } from "./shared/utils";

type Phase = "available" | "downloading" | "installing" | "restarting" | "error";

/// Floating bottom-right toast that surfaces a pending app update.
///
/// On mount it asks the Tauri updater whether a newer signed release is
/// published (against the GitHub `latest.json` endpoint configured in
/// tauri.conf.json). When one exists it shows version + release notes and
/// a one-click "Update now" that downloads, installs, and relaunches.
/// Silently does nothing outside the Tauri shell or when up to date.
export function UpdateBanner() {
  const t = useT();
  const [update, setUpdate] = useState<Update | null>(null);
  const [phase, setPhase] = useState<Phase>("available");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await check();
        if (!cancelled && found?.available) {
          setUpdate(found);
        }
      } catch {
        // No Tauri runtime (browser preview) or network/endpoint error —
        // updates are best-effort, never block the app.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update || dismissed) return null;

  async function install() {
    if (!update) return;
    setError(null);
    setPhase("downloading");
    try {
      let total = 0;
      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (total > 0) setProgress(Math.round((downloaded / total) * 100));
            break;
          case "Finished":
            setPhase("installing");
            break;
        }
      });
      setPhase("restarting");
      await relaunch();
    } catch (e) {
      setError(String(e));
      setPhase("error");
    }
  }

  const busy = phase === "downloading" || phase === "installing" || phase === "restarting";

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border border-atlas-border bg-atlas-paper shadow-lg ring-1 ring-atlas-ink/5">
      <div className="flex items-start gap-3 p-3">
        <div className="rounded-md bg-emerald-700/10 p-2 text-emerald-700 shrink-0">
          <Download className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-atlas-ink">{t("update.available")}</div>
          <p className="text-[11px] text-atlas-muted leading-snug mt-0.5">
            {t("update.newVersion", {
              version: update.version,
              current: update.currentVersion,
            })}
          </p>
          {update.body && (
            <p className="text-[11px] text-atlas-ink-soft leading-snug mt-1 max-h-20 overflow-y-auto whitespace-pre-line">
              {update.body}
            </p>
          )}

          {phase === "error" && error && (
            <p className="text-[11px] text-rose-700 mt-1 break-all">
              {t("update.error")}: {error}
            </p>
          )}

          {phase === "downloading" && (
            <div className="mt-2 h-1.5 w-full rounded-full bg-atlas-sand overflow-hidden">
              <div
                className="h-full bg-emerald-700 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void install()}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-3 py-1 text-xs font-semibold transition-colors",
                "bg-atlas-ink text-atlas-cream hover:bg-atlas-ink-soft",
                "disabled:bg-atlas-sand disabled:text-atlas-muted disabled:cursor-not-allowed",
              )}
            >
              {busy && <RefreshCw className="h-3 w-3 animate-spin" />}
              {phase === "downloading"
                ? `${t("update.downloading")} ${progress}%`
                : phase === "installing"
                  ? t("update.installing")
                  : phase === "restarting"
                    ? t("update.restarting")
                    : t("update.install")}
            </button>
            {!busy && (
              <button
                type="button"
                onClick={() => setDismissed(true)}
                className="text-xs text-atlas-muted hover:text-atlas-ink"
              >
                {t("update.later")}
              </button>
            )}
          </div>
        </div>
        {!busy && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 p-0.5 rounded text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
