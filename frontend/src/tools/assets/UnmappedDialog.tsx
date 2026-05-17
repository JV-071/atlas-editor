import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";

import { useWorkspace } from "./store";
import type { UnmappedReport } from "./types";
import { useT } from "../../i18n";

interface Props {
  onClose: () => void;
}

export function UnmappedDialog({ onClose }: Props) {
  const t = useT();
  const getUnmappedReport = useWorkspace((s) => s.getUnmappedReport);
  const setCategory = useWorkspace((s) => s.setCategory);
  const setSelected = useWorkspace((s) => s.setSelected);

  const [report, setReport] = useState<UnmappedReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await getUnmappedReport();
        setReport(r);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function goToAppearance(id: number) {
    setCategory("object");
    void setSelected(id);
    onClose();
  }

  const hasIssues =
    report &&
    (report.appearanceOrphanIds.length > 0 ||
      report.otbOrphanServerIds.length > 0 ||
      report.collisionIds.length > 0);

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-atlas-ink/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-lg border border-atlas-border bg-atlas-paper shadow-xl">
        <header className="flex items-center justify-between p-3 border-b border-atlas-border">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-atlas-muted">
            {t("unmapped.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-atlas-muted hover:text-atlas-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-[200px]">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-atlas-muted">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          )}

          {error && (
            <div className="px-3 py-2 rounded bg-rose-100 border border-rose-300 text-sm text-rose-900">
              {error}
            </div>
          )}

          {report && !loading && !hasIssues && (
            <div className="flex items-center justify-center py-8 text-sm text-atlas-muted">
              {t("unmapped.clean")}
            </div>
          )}

          {report && report.appearanceOrphanIds.length > 0 && (
            <Section
              title={t("unmapped.appearanceOrphans")}
              count={report.appearanceOrphanIds.length}
              hint={t("unmapped.appearanceOrphansHint")}
            >
              <div className="flex flex-wrap gap-1">
                {report.appearanceOrphanIds.slice(0, 200).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => goToAppearance(id)}
                    className="px-2 py-0.5 rounded text-xs font-mono bg-atlas-paper border border-atlas-border hover:border-atlas-ink hover:bg-atlas-sand"
                  >
                    #{id}
                  </button>
                ))}
                {report.appearanceOrphanIds.length > 200 && (
                  <span className="self-center text-[11px] text-atlas-muted">
                    +{report.appearanceOrphanIds.length - 200}
                  </span>
                )}
              </div>
            </Section>
          )}

          {report && report.otbOrphanServerIds.length > 0 && (
            <Section
              title={t("unmapped.otbOrphans")}
              count={report.otbOrphanServerIds.length}
              hint={t("unmapped.otbOrphansHint")}
            >
              <div className="flex flex-wrap gap-1">
                {report.otbOrphanServerIds.slice(0, 200).map((sid) => (
                  <span
                    key={sid}
                    className="px-2 py-0.5 rounded text-xs font-mono bg-amber-50 border border-amber-200 text-amber-900"
                  >
                    srv:{sid}
                  </span>
                ))}
                {report.otbOrphanServerIds.length > 200 && (
                  <span className="self-center text-[11px] text-atlas-muted">
                    +{report.otbOrphanServerIds.length - 200}
                  </span>
                )}
              </div>
            </Section>
          )}

          {report && report.collisionIds.length > 0 && (
            <Section
              title={t("unmapped.collisions")}
              count={report.collisionIds.length}
              hint={t("unmapped.collisionsHint")}
            >
              <div className="flex flex-wrap gap-1">
                {report.collisionIds.slice(0, 200).map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => goToAppearance(id)}
                    className="px-2 py-0.5 rounded text-xs font-mono bg-rose-50 border border-rose-200 text-rose-900 hover:border-rose-400 hover:bg-rose-100"
                  >
                    #{id}
                  </button>
                ))}
                {report.collisionIds.length > 200 && (
                  <span className="self-center text-[11px] text-atlas-muted">
                    +{report.collisionIds.length - 200}
                  </span>
                )}
              </div>
            </Section>
          )}
        </div>

        <footer className="flex items-center justify-end p-3 border-t border-atlas-border bg-atlas-cream/40">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded text-sm text-atlas-ink hover:bg-atlas-sand"
          >
            {t("common.cancel")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count: number;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-atlas-border bg-atlas-cream/40 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
        <span className="text-sm font-semibold text-atlas-ink">{title}</span>
        <span className="text-xs text-atlas-muted tabular-nums">({count})</span>
      </div>
      <p className="text-xs text-atlas-muted">{hint}</p>
      {children}
    </div>
  );
}
