import { Globe } from "lucide-react";

import { cn } from "../shared/utils";
import { LOCALES, useI18n, useT, type Locale } from ".";

const LABELS: Record<Locale, string> = {
  en: "EN",
  pt: "PT",
  es: "ES",
};

interface Props {
  className?: string;
}

/// Compact 3-button language picker. Sits in screen corners — no
/// dropdown so the current locale is always visible at a glance.
export function LanguageSwitcher({ className }: Props) {
  const locale = useI18n((s) => s.locale);
  const setLocale = useI18n((s) => s.setLocale);
  const t = useT();
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded border border-atlas-border bg-atlas-paper p-0.5 text-[11px]",
        className,
      )}
      role="group"
      aria-label={t("language.label")}
    >
      <Globe className="ml-1 h-3 w-3 text-atlas-muted" />
      {LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => setLocale(loc)}
          aria-pressed={locale === loc}
          title={t(`language.${loc}` as const)}
          className={cn(
            "rounded px-1.5 py-0.5 font-semibold transition-colors",
            locale === loc
              ? "bg-atlas-ink text-atlas-cream"
              : "text-atlas-muted hover:text-atlas-ink hover:bg-atlas-sand",
          )}
        >
          {LABELS[loc]}
        </button>
      ))}
    </div>
  );
}
