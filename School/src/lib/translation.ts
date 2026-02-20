import { AppLanguage, TranslationMap } from '../types/models';

function wrapTranslation(language: AppLanguage, text: string): string {
  if (!text.trim()) {
    return '';
  }
  if (language === 'he') {
    return `עברית: ${text}`;
  }
  if (language === 'ru') {
    return `Русский: ${text}`;
  }
  return `English: ${text}`;
}

export function buildTranslations(text: string, original: AppLanguage): TranslationMap {
  return {
    he: original === 'he' ? text : wrapTranslation('he', text),
    ru: original === 'ru' ? text : wrapTranslation('ru', text),
    en: original === 'en' ? text : wrapTranslation('en', text),
  };
}

export function getLocalizedText(
  textOriginal: string,
  translations: TranslationMap,
  userLanguage: AppLanguage,
  showOriginal: boolean,
): string {
  if (showOriginal) {
    return textOriginal;
  }
  return translations[userLanguage] || textOriginal;
}
