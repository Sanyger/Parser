import { AppLanguage, TranslationMap } from '../types/models';

type LocalizedTriplet = Record<AppLanguage, string>;
type PartialTranslationMap = Partial<Record<AppLanguage, string>> | null | undefined;

const LEGACY_PREFIXES = [/^English:\s+/i, /^Русский:\s+/i, /^עברית:\s+/i];
const HEBREW_CHAR_RE = /[\u0590-\u05ff]/;
const CYRILLIC_CHAR_RE = /[\u0400-\u04ff]/;
const LATIN_CHAR_RE = /[A-Za-z]/;
const SPLIT_TOKEN_RE = /(\s+|[()[\]{}.,!?;:/\\-]+)/g;
const ONLY_SEPARATOR_RE = /^(\s+|[()[\]{}.,!?;:/\\-]+)$/;

const phraseTriplets: LocalizedTriplet[] = [
  {
    ru: 'Здравствуйте, Марк будет отсутствовать на первом уроке завтра.',
    en: 'Hello, Mark will miss the first lesson tomorrow.',
    he: 'שלום, מארק ייעדר מהשיעור הראשון מחר.',
  },
  {
    ru: 'Спасибо за уведомление. Отметила в журнале.',
    en: 'Thank you for the update. Noted in the journal.',
    he: 'תודה על העדכון. סומן ביומן.',
  },
  {
    ru: 'Добро пожаловать в новый школьный сервис-прототип.',
    en: 'Welcome to the new school service prototype.',
    he: 'ברוכים הבאים לשירות הבית ספרי החדש.',
  },
  {
    ru: 'Хотелось бы больше проектов по робототехнике.',
    en: 'I would like more robotics projects.',
    he: 'הייתי רוצה יותר פרויקטים ברובוטיקה.',
  },
  {
    ru: 'Личное замечание директору.',
    en: 'Private note to the principal.',
    he: 'הערה אישית למנהל.',
  },
  {
    ru: 'В 201 кабинете качается парта.',
    en: 'A desk is wobbling in room 201.',
    he: 'באולם 201 שולחן מתנדנד.',
  },
  {
    ru: 'Прочитать страницу 12 и ответить на вопросы.',
    en: 'Read page 12 and answer the questions.',
    he: 'לקרוא עמוד 12 ולענות על השאלות.',
  },
  {
    ru: 'Общая линейка',
    en: 'Weekly Assembly',
    he: 'אספה שבועית',
  },
  {
    ru: 'Актовый зал',
    en: 'Main Hall',
    he: 'אולם ראשי',
  },
  {
    ru: 'Общая линейка (Актовый зал)',
    en: 'Weekly Assembly (Main Hall)',
    he: 'אספה שבועית (אולם ראשי)',
  },
  {
    ru: 'Классное мероприятие: подготовка к шаббату',
    en: 'Class Event: Shabbat Prep',
    he: 'אירוע כיתתי: הכנה לשבת',
  },
  {
    ru: 'Класс',
    en: 'Classroom',
    he: 'כיתה',
  },
  {
    ru: 'Классное мероприятие: подготовка к шаббату (Класс)',
    en: 'Class Event: Shabbat Prep (Classroom)',
    he: 'אירוע כיתתי: הכנה לשבת (כיתה)',
  },
  {
    ru: 'ИЗО',
    en: 'Art',
    he: 'אמנות',
  },
  {
    ru: 'Студия',
    en: 'Studio',
    he: 'סטודיו',
  },
  {
    ru: 'ИЗО (Студия)',
    en: 'Art (Studio)',
    he: 'אמנות (סטודיו)',
  },
  {
    ru: 'Завтра принести книгу',
    en: 'Bring a book tomorrow',
    he: 'מחר להביא ספר',
  },
  {
    ru: 'Завтра контрольная по математике',
    en: 'Tomorrow is a math test',
    he: 'מחר מבחן בחשבון',
  },
];

const tokenTriplets: LocalizedTriplet[] = [
  { ru: 'завтра', en: 'tomorrow', he: 'מחר' },
  { ru: 'принести', en: 'bring', he: 'להביא' },
  { ru: 'книгу', en: 'book', he: 'ספר' },
  { ru: 'контрольная', en: 'test', he: 'מבחן' },
  { ru: 'математика', en: 'math', he: 'חשבון' },
  { ru: 'класс', en: 'classroom', he: 'כיתה' },
  { ru: 'мероприятие', en: 'event', he: 'אירוע' },
  { ru: 'подготовка', en: 'prep', he: 'הכנה' },
  { ru: 'шаббату', en: 'shabbat', he: 'שבת' },
  { ru: 'общая', en: 'weekly', he: 'שבועית' },
  { ru: 'линейка', en: 'assembly', he: 'אספה' },
  { ru: 'актовый', en: 'main', he: 'ראשי' },
  { ru: 'зал', en: 'hall', he: 'אולם' },
  { ru: 'студия', en: 'studio', he: 'סטודיו' },
  { ru: 'привет', en: 'hello', he: 'שלום' },
  { ru: 'спасибо', en: 'thanks', he: 'תודה' },
  { ru: 'добро пожаловать', en: 'welcome', he: 'ברוכים הבאים' },
];

const phraseIndex = createIndex(phraseTriplets);
const tokenIndex = createIndex(tokenTriplets);
const translationCache = new Map<string, string>();

function createIndex(entries: LocalizedTriplet[]): Record<AppLanguage, Map<string, LocalizedTriplet>> {
  const byLanguage: Record<AppLanguage, Map<string, LocalizedTriplet>> = {
    he: new Map(),
    ru: new Map(),
    en: new Map(),
  };

  entries.forEach((entry) => {
    (['he', 'ru', 'en'] as const).forEach((language) => {
      const key = normalizeText(entry[language]);
      if (key) {
        byLanguage[language].set(key, entry);
      }
    });
  });

  return byLanguage;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function stripLegacyPrefix(value: string): string {
  let result = value;
  for (const prefix of LEGACY_PREFIXES) {
    result = result.replace(prefix, '');
  }
  return result.trim();
}

function hasLegacyPrefix(value: string): boolean {
  return LEGACY_PREFIXES.some((prefix) => prefix.test(value));
}

function detectByScript(text: string): AppLanguage {
  let hebrewCount = 0;
  let cyrillicCount = 0;
  let latinCount = 0;

  for (const char of text) {
    if (HEBREW_CHAR_RE.test(char)) {
      hebrewCount += 1;
      continue;
    }
    if (CYRILLIC_CHAR_RE.test(char)) {
      cyrillicCount += 1;
      continue;
    }
    if (LATIN_CHAR_RE.test(char)) {
      latinCount += 1;
    }
  }

  if (hebrewCount > cyrillicCount && hebrewCount >= latinCount) {
    return 'he';
  }
  if (cyrillicCount >= latinCount) {
    return 'ru';
  }
  return 'en';
}

function applyTokenCase(source: string, translated: string): string {
  if (!translated) {
    return translated;
  }
  if (source === source.toUpperCase() && source.length > 1) {
    return translated.toUpperCase();
  }
  if (source.charAt(0) === source.charAt(0).toUpperCase()) {
    return translated.charAt(0).toUpperCase() + translated.slice(1);
  }
  return translated;
}

function findTripletByAnyLanguage(text: string, index: Record<AppLanguage, Map<string, LocalizedTriplet>>): LocalizedTriplet | null {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }
  return index.he.get(normalized) ?? index.ru.get(normalized) ?? index.en.get(normalized) ?? null;
}

function translateByTokens(text: string, sourceLanguage: AppLanguage, targetLanguage: AppLanguage): string {
  const parts = text.split(SPLIT_TOKEN_RE);
  let changed = false;

  const translated = parts
    .map((part) => {
      if (!part || ONLY_SEPARATOR_RE.test(part)) {
        return part;
      }
      const normalized = normalizeText(part);
      if (!normalized) {
        return part;
      }

      const triplet =
        tokenIndex[sourceLanguage].get(normalized) ??
        tokenIndex.he.get(normalized) ??
        tokenIndex.ru.get(normalized) ??
        tokenIndex.en.get(normalized);
      if (!triplet) {
        return part;
      }
      changed = true;
      return applyTokenCase(part, triplet[targetLanguage]);
    })
    .join('');

  return changed ? translated : text;
}

function translateExact(text: string, sourceLanguage: AppLanguage, targetLanguage: AppLanguage): string | null {
  const normalized = normalizeText(text);
  if (!normalized) {
    return '';
  }

  const direct = phraseIndex[sourceLanguage].get(normalized);
  if (direct) {
    return direct[targetLanguage];
  }

  const fromAny = findTripletByAnyLanguage(text, phraseIndex);
  if (fromAny) {
    return fromAny[targetLanguage];
  }

  return null;
}

export function detectLanguage(text: string): AppLanguage {
  const value = stripLegacyPrefix(text);
  if (!value) {
    return 'en';
  }
  return detectByScript(value);
}

export function translateText(
  text: string,
  targetLanguage: AppLanguage,
  sourceLanguage?: AppLanguage,
): string {
  const cleanText = stripLegacyPrefix(text);
  if (!cleanText) {
    return '';
  }

  const originalLanguage = sourceLanguage ?? detectLanguage(cleanText);
  if (originalLanguage === targetLanguage) {
    return cleanText;
  }

  const cacheKey = `${originalLanguage}:${targetLanguage}:${cleanText}`;
  const cached = translationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const exact = translateExact(cleanText, originalLanguage, targetLanguage);
  if (exact !== null) {
    translationCache.set(cacheKey, exact);
    return exact;
  }

  const tokenized = translateByTokens(cleanText, originalLanguage, targetLanguage);
  translationCache.set(cacheKey, tokenized);
  return tokenized;
}

export function buildTranslations(text: string, original?: AppLanguage): TranslationMap {
  const cleanText = stripLegacyPrefix(text);
  if (!cleanText) {
    return {
      he: '',
      ru: '',
      en: '',
    };
  }

  const detectedOriginal = original ?? detectLanguage(cleanText);

  return {
    he: detectedOriginal === 'he' ? cleanText : translateText(cleanText, 'he', detectedOriginal),
    ru: detectedOriginal === 'ru' ? cleanText : translateText(cleanText, 'ru', detectedOriginal),
    en: detectedOriginal === 'en' ? cleanText : translateText(cleanText, 'en', detectedOriginal),
  };
}

export function ensureTranslationMap(
  textOriginal: string,
  originalLanguage?: AppLanguage | null,
  translations?: PartialTranslationMap,
): TranslationMap {
  const detectedOriginal = originalLanguage ?? detectLanguage(textOriginal);
  const fallback = buildTranslations(textOriginal, detectedOriginal);

  const he = translations?.he?.trim();
  const ru = translations?.ru?.trim();
  const en = translations?.en?.trim();

  return {
    he: he && !hasLegacyPrefix(he) ? he : fallback.he,
    ru: ru && !hasLegacyPrefix(ru) ? ru : fallback.ru,
    en: en && !hasLegacyPrefix(en) ? en : fallback.en,
  };
}

export function getLocalizedText(
  textOriginal: string,
  translations: TranslationMap,
  userLanguage: AppLanguage,
  showOriginal: boolean,
): string {
  const cleanOriginal = stripLegacyPrefix(textOriginal);
  if (showOriginal) {
    return cleanOriginal;
  }
  return translations[userLanguage] || cleanOriginal;
}
