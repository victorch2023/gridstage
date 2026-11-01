import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { en } from './en';
import { es } from './es';
import { zh } from './zh';

/**
 * Tiny typed i18n. `en.ts` defines the shape; every other dictionary is
 * declared `: Messages`, so a missing or mis-typed string is a compile
 * error — no runtime fallback logic needed. Adding a language = one new
 * file + one entry in DICTIONARIES + one <option> in Preferences.
 *
 * ponytail: no i18n library — a handful of locales and flat access
 * (`t.cast.title`) don't need one. Reach for a lib only if plurals/genders
 * get complicated.
 *
 * Default is Spanish: this copy of the app is used in Spanish. Chinese and
 * English stay available in Preferences. A browser set to Chinese still
 * starts in Chinese when nothing has been chosen yet.
 */

export type Messages = typeof en;
export type Locale = 'en' | 'es' | 'zh';

const DICTIONARIES: Record<Locale, Messages> = { en, es, zh };

export function isLocale(value: string): value is Locale {
  return value === 'en' || value === 'es' || value === 'zh';
}

function browserDefault(): Locale {
  // Read the saved choice synchronously. Persist rehydrates a tick later, and
  // the first document is named during that same startup.
  try {
    const raw = localStorage.getItem('gridstage-locale');
    if (raw !== null) {
      const saved = (JSON.parse(raw) as { state?: { locale?: string } }).state?.locale;
      if (saved !== undefined && isLocale(saved)) return saved;
    }
  } catch {
    // Private mode or a broken value: fall through to the default.
  }
  if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')) {
    return 'zh';
  }
  return 'es';
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>()(
  persist((set) => ({ locale: browserDefault(), setLocale: (locale) => set({ locale }) }), {
    name: 'gridstage-locale',
  }),
);

/** React components: current dictionary, re-renders on language change. */
export function useT(): Messages {
  return DICTIONARIES[useLocaleStore((s) => s.locale)];
}

/** Non-React code (exporters, one-off handlers): current dictionary. */
export function messages(): Messages {
  return DICTIONARIES[useLocaleStore.getState().locale];
}
