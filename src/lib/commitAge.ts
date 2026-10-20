import { resolveLanguage, translate } from "./i18n.ts";

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/** one formatter per language: a picker asks for every branch's age on each of its renders */
const formatters = new Map<string, Intl.RelativeTimeFormat>();

function formatterFor(locale: string): Intl.RelativeTimeFormat {
  let words = formatters.get(locale);
  if (words === undefined) {
    words = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
    formatters.set(locale, words);
  }
  return words;
}

/**
 * How long ago a commit was made, in the largest whole unit: "5 minutes ago", "3 hours ago",
 * "4 months ago", in the language of `locale` (a BCP 47 tag, as `useLocale()` gives). Under a
 * minute is "just now", and so is a time in the future (clock skew) or 0 (git had no date).
 * Numbers stay numbers ("2 days ago", never "the day before yesterday").
 */
export function commitAge(locale: string, timeSeconds: number, nowMs: number): string {
  const seconds = Math.floor(nowMs / 1000 - timeSeconds);
  if (timeSeconds <= 0 || !(seconds >= MINUTE)) return translate(resolveLanguage("system", [locale]), "just now");
  const words = formatterFor(locale);
  if (seconds < HOUR) return words.format(-Math.floor(seconds / MINUTE), "minute");
  if (seconds < DAY) return words.format(-Math.floor(seconds / HOUR), "hour");
  if (seconds < MONTH) return words.format(-Math.floor(seconds / DAY), "day");
  if (seconds < YEAR) return words.format(-Math.floor(seconds / MONTH), "month");
  return words.format(-Math.floor(seconds / YEAR), "year");
}
