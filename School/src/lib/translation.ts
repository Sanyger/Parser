import { AppLanguage, TranslationMap } from '../types/models';

type LocalizedTriplet = Record<AppLanguage, string>;
type PartialTranslationMap = Partial<Record<AppLanguage, string>> | null | undefined;

const LEGACY_PREFIXES = [/^English:\s+/i, /^Русский:\s+/i, /^עברית:\s+/i];
const HEBREW_CHAR_RE = /[\u0590-\u05ff]/;
const CYRILLIC_CHAR_RE = /[\u0400-\u04ff]/;
const LATIN_CHAR_RE = /[A-Za-z]/;
const SPLIT_TOKEN_RE = /(\s+|[()[\]{}.,!?;:/\\-]+)/g;
const ONLY_SEPARATOR_RE = /^(\s+|[()[\]{}.,!?;:/\\-]+)$/;
const HEBREW_DIACRITICS_RE = /[\u0591-\u05C7]/g;
const TEXT_NOISE_RE = /[()[\]{}.,!?;:'"`]/g;

const LATIN_TO_RU_MULTI: Record<string, string> = {
  shch: 'щ',
  yo: 'ё',
  zh: 'ж',
  kh: 'х',
  ts: 'ц',
  ch: 'ч',
  sh: 'ш',
  yu: 'ю',
  ya: 'я',
  ph: 'ф',
  th: 'т',
};

const LATIN_TO_RU_CHAR: Record<string, string> = {
  a: 'а',
  b: 'б',
  c: 'к',
  d: 'д',
  e: 'е',
  f: 'ф',
  g: 'г',
  h: 'х',
  i: 'и',
  j: 'й',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  q: 'к',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  v: 'в',
  w: 'в',
  x: 'кс',
  y: 'й',
  z: 'з',
};

const HEBREW_TO_RU_CHAR: Record<string, string> = {
  א: 'а',
  ב: 'б',
  ג: 'г',
  ד: 'д',
  ה: 'х',
  ו: 'в',
  ז: 'з',
  ח: 'х',
  ט: 'т',
  י: 'й',
  כ: 'к',
  ך: 'к',
  ל: 'л',
  מ: 'м',
  ם: 'м',
  נ: 'н',
  ן: 'н',
  ס: 'с',
  ע: 'а',
  פ: 'п',
  ף: 'п',
  צ: 'ц',
  ץ: 'ц',
  ק: 'к',
  ר: 'р',
  ש: 'ш',
  ת: 'т',
};

const CYRILLIC_TO_EN_MULTI: Record<string, string> = {
  щ: 'shch',
  ж: 'zh',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  ю: 'yu',
  я: 'ya',
};

const CYRILLIC_TO_EN_CHAR: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
};

const HEBREW_TO_EN_CHAR: Record<string, string> = {
  א: 'a',
  ב: 'b',
  ג: 'g',
  ד: 'd',
  ה: 'h',
  ו: 'v',
  ז: 'z',
  ח: 'kh',
  ט: 't',
  י: 'y',
  כ: 'k',
  ך: 'k',
  ל: 'l',
  מ: 'm',
  ם: 'm',
  נ: 'n',
  ן: 'n',
  ס: 's',
  ע: 'a',
  פ: 'p',
  ף: 'p',
  צ: 'ts',
  ץ: 'ts',
  ק: 'k',
  ר: 'r',
  ש: 'sh',
  ת: 't',
};

const LATIN_TO_HE_MULTI: Record<string, string> = {
  sh: 'ש',
  ch: 'צ',
  kh: 'ח',
  zh: 'ז',
  ya: 'יא',
  yo: 'יו',
  yu: 'יו',
  ts: 'צ',
  ph: 'פ',
};

const LATIN_TO_HE_CHAR: Record<string, string> = {
  a: 'א',
  b: 'ב',
  c: 'ק',
  d: 'ד',
  e: 'א',
  f: 'פ',
  g: 'ג',
  h: 'ה',
  i: 'י',
  j: 'ג',
  k: 'ק',
  l: 'ל',
  m: 'מ',
  n: 'נ',
  o: 'ו',
  p: 'פ',
  q: 'ק',
  r: 'ר',
  s: 'ס',
  t: 'ט',
  u: 'ו',
  v: 'ו',
  w: 'ו',
  x: 'קס',
  y: 'י',
  z: 'ז',
};

const CYRILLIC_TO_HE_MULTI: Record<string, string> = {
  ж: 'ז׳',
  х: 'ח',
  ц: 'צ',
  ч: 'צ׳',
  ш: 'ש',
  щ: 'שצ׳',
  ю: 'יו',
  я: 'יא',
  ё: 'יו',
};

const CYRILLIC_TO_HE_CHAR: Record<string, string> = {
  а: 'א',
  б: 'ב',
  в: 'ו',
  г: 'ג',
  д: 'ד',
  е: 'א',
  з: 'ז',
  и: 'י',
  й: 'י',
  к: 'ק',
  л: 'ל',
  м: 'מ',
  н: 'נ',
  о: 'ו',
  п: 'פ',
  р: 'ר',
  с: 'ס',
  т: 'ט',
  у: 'ו',
  ф: 'פ',
  ы: 'י',
  э: 'א',
  ъ: '',
  ь: '',
};

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
  { ru: 'здравствуйте', en: 'hello', he: 'שלום' },
  { ru: 'спасибо', en: 'thanks', he: 'תודה' },
  { ru: 'добро пожаловать', en: 'welcome', he: 'ברוכים הבאים' },
  { ru: 'марк', en: 'mark', he: 'מארק' },
  { ru: 'отсутствовать', en: 'absent', he: 'ייעדר' },
  { ru: 'первого', en: 'first', he: 'הראשון' },
  { ru: 'урок', en: 'lesson', he: 'שיעור' },
  { ru: 'урока', en: 'lesson', he: 'מהשיעור' },
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
  return value
    .normalize('NFKD')
    .replace(HEBREW_DIACRITICS_RE, '')
    .replace(TEXT_NOISE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
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

function maxMultiKeyLength(multiMap?: Record<string, string>): number {
  if (!multiMap) {
    return 0;
  }
  return Object.keys(multiMap).reduce((max, key) => Math.max(max, key.length), 0);
}

function transliterateWithMap(
  text: string,
  charMap: Record<string, string>,
  multiMap?: Record<string, string>,
): string {
  const maxLength = maxMultiKeyLength(multiMap);
  let index = 0;
  let result = '';

  while (index < text.length) {
    if (multiMap && maxLength > 1) {
      let matched = false;
      for (let size = maxLength; size > 1; size -= 1) {
        const chunk = text.slice(index, index + size);
        if (chunk.length !== size) {
          continue;
        }
        const replacement = multiMap[chunk.toLocaleLowerCase()];
        if (!replacement) {
          continue;
        }
        result += applyTokenCase(chunk, replacement);
        index += size;
        matched = true;
        break;
      }
      if (matched) {
        continue;
      }
    }

    const sourceChar = text[index];
    const replacement = charMap[sourceChar.toLocaleLowerCase()];
    result += typeof replacement === 'undefined' ? sourceChar : applyTokenCase(sourceChar, replacement);
    index += 1;
  }

  return result;
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

function scriptScore(text: string): Record<AppLanguage, number> {
  let he = 0;
  let ru = 0;
  let en = 0;
  for (const char of text) {
    if (HEBREW_CHAR_RE.test(char)) {
      he += 1;
      continue;
    }
    if (CYRILLIC_CHAR_RE.test(char)) {
      ru += 1;
      continue;
    }
    if (LATIN_CHAR_RE.test(char)) {
      en += 1;
    }
  }
  return { he, ru, en };
}

function isScriptDominantForLanguage(text: string, language: AppLanguage): boolean {
  const score = scriptScore(text);
  const total = score.he + score.ru + score.en;
  if (total === 0) {
    return false;
  }
  if (language === 'ru') {
    return score.ru > 0 && score.ru >= score.he && score.ru >= score.en;
  }
  if (language === 'he') {
    return score.he > 0 && score.he >= score.ru && score.he >= score.en;
  }
  return score.en > 0 && score.en >= score.he && score.en >= score.ru;
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

function translateByPatterns(text: string, sourceLanguage: AppLanguage, targetLanguage: AppLanguage): string | null {
  if (sourceLanguage !== 'he') {
    return null;
  }

  const absencePattern = /^שלום[, ]+(.+?)\s+ייעדר(?:\/ת)?\s+מהשיעור\s+הראשון\s+מחר[.!?]?$/u;
  const simpleAbsencePattern = /^(.+?)\s+לא\s+יגיע(?:\/ת)?\s+מחר[.!?]?$/u;

  const absenceMatch = text.trim().match(absencePattern);
  if (absenceMatch?.[1]) {
    const nameRu = localizePersonName(absenceMatch[1].trim(), 'ru');
    const nameEn = localizePersonName(absenceMatch[1].trim(), 'en');
    if (targetLanguage === 'ru') {
      return `Здравствуйте, ${nameRu} будет отсутствовать на первом уроке завтра.`;
    }
    if (targetLanguage === 'en') {
      return `Hello, ${nameEn} will miss the first lesson tomorrow.`;
    }
  }

  const simpleMatch = text.trim().match(simpleAbsencePattern);
  if (simpleMatch?.[1]) {
    const nameRu = localizePersonName(simpleMatch[1].trim(), 'ru');
    const nameEn = localizePersonName(simpleMatch[1].trim(), 'en');
    if (targetLanguage === 'ru') {
      return `${nameRu} не придет завтра.`;
    }
    if (targetLanguage === 'en') {
      return `${nameEn} will not come tomorrow.`;
    }
  }

  return null;
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

  const patternTranslation = translateByPatterns(cleanText, originalLanguage, targetLanguage);
  if (patternTranslation !== null) {
    translationCache.set(cacheKey, patternTranslation);
    return patternTranslation;
  }

  const tokenized = translateByTokens(cleanText, originalLanguage, targetLanguage);
  if (tokenized !== cleanText) {
    translationCache.set(cacheKey, tokenized);
    return tokenized;
  }

  const transliteratedFallback = localizePersonName(cleanText, targetLanguage);
  translationCache.set(cacheKey, transliteratedFallback);
  return transliteratedFallback;
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
  const detectedByText = detectLanguage(textOriginal);
  const resolvedOriginal = detectedByText || originalLanguage || 'en';
  const fallback = buildTranslations(textOriginal, resolvedOriginal);

  const he = translations?.he?.trim() ?? '';
  const ru = translations?.ru?.trim() ?? '';
  const en = translations?.en?.trim() ?? '';

  const textNormalized = normalizeText(textOriginal);
  const isValid = (candidate: string, targetLanguage: AppLanguage): boolean => {
    if (!candidate || hasLegacyPrefix(candidate)) {
      return false;
    }
    const normalized = normalizeText(candidate);
    if (!normalized) {
      return false;
    }
    if (targetLanguage !== resolvedOriginal && normalized === textNormalized) {
      return false;
    }
    if (targetLanguage === 'ru' && HEBREW_CHAR_RE.test(candidate)) {
      return false;
    }
    if (targetLanguage === 'en' && (HEBREW_CHAR_RE.test(candidate) || CYRILLIC_CHAR_RE.test(candidate))) {
      return false;
    }
    if (targetLanguage === 'he' && (LATIN_CHAR_RE.test(candidate) || CYRILLIC_CHAR_RE.test(candidate))) {
      return false;
    }
    if (targetLanguage !== resolvedOriginal && !isScriptDominantForLanguage(candidate, targetLanguage)) {
      return false;
    }
    return true;
  };

  return {
    he: isValid(he, 'he') ? he : fallback.he,
    ru: isValid(ru, 'ru') ? ru : fallback.ru,
    en: isValid(en, 'en') ? en : fallback.en,
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
  const originalLanguage = detectLanguage(cleanOriginal);
  if (originalLanguage === userLanguage) {
    return cleanOriginal;
  }

  const candidate = (translations[userLanguage] ?? '').trim();
  if (!candidate) {
    return translateText(cleanOriginal, userLanguage, originalLanguage);
  }
  if (hasLegacyPrefix(candidate)) {
    return translateText(cleanOriginal, userLanguage, originalLanguage);
  }

  const normalizedOriginal = normalizeText(cleanOriginal);
  const normalizedCandidate = normalizeText(candidate);
  if (normalizedCandidate === normalizedOriginal) {
    return translateText(cleanOriginal, userLanguage, originalLanguage);
  }

  if (!isScriptDominantForLanguage(candidate, userLanguage)) {
    return translateText(cleanOriginal, userLanguage, originalLanguage);
  }

  return candidate;
}

export function localizePersonName(name: string, language: AppLanguage): string {
  const cleanName = name.trim();
  if (!cleanName) {
    return '';
  }

  if (language === 'ru') {
    let result = cleanName;
    if (HEBREW_CHAR_RE.test(result)) {
      result = transliterateWithMap(result, HEBREW_TO_RU_CHAR);
    }
    if (LATIN_CHAR_RE.test(result)) {
      result = transliterateWithMap(result, LATIN_TO_RU_CHAR, LATIN_TO_RU_MULTI);
    }
    return result;
  }

  if (language === 'en') {
    let result = cleanName;
    if (HEBREW_CHAR_RE.test(result)) {
      result = transliterateWithMap(result, HEBREW_TO_EN_CHAR);
    }
    if (CYRILLIC_CHAR_RE.test(result)) {
      result = transliterateWithMap(result, CYRILLIC_TO_EN_CHAR, CYRILLIC_TO_EN_MULTI);
    }
    return result;
  }

  let result = cleanName;
  if (CYRILLIC_CHAR_RE.test(result)) {
    result = transliterateWithMap(result, CYRILLIC_TO_HE_CHAR, CYRILLIC_TO_HE_MULTI);
  }
  if (LATIN_CHAR_RE.test(result)) {
    result = transliterateWithMap(result, LATIN_TO_HE_CHAR, LATIN_TO_HE_MULTI);
  }
  return result;
}
