import { create } from "zustand";

import { en, type MessageKey } from "./messages/en";
import { pt } from "./messages/pt";
import { es } from "./messages/es";

export type Locale = "en" | "pt" | "es";
export const LOCALES: Locale[] = ["en", "pt", "es"];

const CATALOGS: Record<Locale, Record<MessageKey, string>> = { en, pt, es };
const STORAGE_KEY = "atlas-editor.locale";

/// Guess the initial locale: localStorage first, then `navigator.language`,
/// defaulting to English. Anything outside the supported set falls back.
function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = window.localStorage?.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "pt" || stored === "es") return stored;
  const nav = window.navigator?.language?.toLowerCase() ?? "";
  if (nav.startsWith("pt")) return "pt";
  if (nav.startsWith("es")) return "es";
  return "en";
}

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18n = create<I18nState>((set) => ({
  locale: detectInitialLocale(),
  setLocale: (locale) => {
    try {
      window.localStorage?.setItem(STORAGE_KEY, locale);
    } catch {
      // Storage can be unavailable in private mode or in the Tauri WebView
      // sandbox; silently fall through.
    }
    set({ locale });
  },
}));

/// Replace `{name}` placeholders with values from `params`. Unknown
/// placeholders are left intact so missing values surface during dev
/// instead of failing silently.
function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = params[key];
    return value === undefined ? match : String(value);
  });
}

/// React hook returning a `t(key, params?)` translator bound to the
/// current locale. Re-renders the component when the user switches
/// language.
export function useT(): (key: MessageKey, params?: Record<string, string | number>) => string {
  const locale = useI18n((s) => s.locale);
  const catalog = CATALOGS[locale];
  return (key, params) => format(catalog[key] ?? en[key] ?? key, params);
}

export type { MessageKey };
