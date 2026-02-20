import { AppLanguage } from '../types/models';
import { localeByLanguage } from './i18n';

export const SCHOOL_TIMEZONE = 'Asia/Jerusalem';

export const WEEK_DAYS = [
  { key: 0, enabled: true },
  { key: 1, enabled: true },
  { key: 2, enabled: true },
  { key: 3, enabled: true },
  { key: 4, enabled: true },
  { key: 5, enabled: true },
  { key: 6, enabled: false },
] as const;

const timeFormatters = new Map<AppLanguage, Intl.DateTimeFormat>();
const dateFormatters = new Map<AppLanguage, Intl.DateTimeFormat>();

const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: SCHOOL_TIMEZONE,
  weekday: 'long',
});

function getTimeFormatter(language: AppLanguage): Intl.DateTimeFormat {
  const cached = timeFormatters.get(language);
  if (cached) {
    return cached;
  }

  const created = new Intl.DateTimeFormat(localeByLanguage(language), {
    timeZone: SCHOOL_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  timeFormatters.set(language, created);
  return created;
}

function getDateFormatter(language: AppLanguage): Intl.DateTimeFormat {
  const cached = dateFormatters.get(language);
  if (cached) {
    return cached;
  }

  const created = new Intl.DateTimeFormat(localeByLanguage(language), {
    timeZone: SCHOOL_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  dateFormatters.set(language, created);
  return created;
}

export function formatTime(isoDate: string, language: AppLanguage = 'en'): string {
  return getTimeFormatter(language).format(new Date(isoDate));
}

export function formatDate(isoDate: string, language: AppLanguage = 'en'): string {
  return getDateFormatter(language).format(new Date(isoDate));
}

export function getDayIndexInJerusalem(isoDate: string): number {
  const weekday = weekdayFormatter.format(new Date(isoDate));
  const map: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  return map[weekday] ?? 0;
}

export function nowInJerusalemLabel(language: AppLanguage = 'en'): string {
  const now = new Date();
  return `${getDateFormatter(language).format(now)} ${getTimeFormatter(language).format(now)}`;
}
