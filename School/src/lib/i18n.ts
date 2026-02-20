import { AppLanguage, FeedbackStatus, LessonType, RoleId } from '../types/models';

type LocalizedText = Record<AppLanguage, string>;

const languageNames: Record<AppLanguage, LocalizedText> = {
  he: {
    he: 'עברית',
    ru: 'Иврит',
    en: 'Hebrew',
  },
  ru: {
    he: 'רוסית',
    ru: 'Русский',
    en: 'Russian',
  },
  en: {
    he: 'אנגלית',
    ru: 'Английский',
    en: 'English',
  },
};

const roleNames: Record<RoleId, LocalizedText> = {
  1: {
    he: 'מנהל',
    ru: 'Директор',
    en: 'Director',
  },
  2: {
    he: 'מחנך כיתה',
    ru: 'Классный руководитель',
    en: 'Homeroom Teacher',
  },
  3: {
    he: 'מורה',
    ru: 'Учитель',
    en: 'Teacher',
  },
  4: {
    he: 'הורה',
    ru: 'Родитель',
    en: 'Parent',
  },
  5: {
    he: 'תלמיד',
    ru: 'Ученик',
    en: 'Student',
  },
  6: {
    he: 'סגל',
    ru: 'Сотрудник',
    en: 'Staff',
  },
};

const roleCompactNames: Record<RoleId, LocalizedText> = {
  1: {
    he: 'מנהל',
    ru: 'Директор',
    en: 'Director',
  },
  2: {
    he: 'מחנך',
    ru: 'Классный рук.',
    en: 'Homeroom',
  },
  3: {
    he: 'מורה',
    ru: 'Учитель',
    en: 'Teacher',
  },
  4: {
    he: 'הורה',
    ru: 'Родитель',
    en: 'Parent',
  },
  5: {
    he: 'תלמיד',
    ru: 'Ученик',
    en: 'Student',
  },
  6: {
    he: 'סגל',
    ru: 'Сотрудник',
    en: 'Staff',
  },
};

const lessonTypeNames: Record<LessonType, LocalizedText> = {
  lesson: {
    he: 'שיעור',
    ru: 'Урок',
    en: 'Lesson',
  },
  holiday: {
    he: 'חופשה',
    ru: 'Каникулы',
    en: 'Holiday',
  },
  event: {
    he: 'אירוע',
    ru: 'Событие',
    en: 'Event',
  },
  requirement: {
    he: 'דרישה',
    ru: 'Требование',
    en: 'Requirement',
  },
};

const feedbackStatusNames: Record<FeedbackStatus, LocalizedText> = {
  new: {
    he: 'חדש',
    ru: 'Новый',
    en: 'New',
  },
  reviewed: {
    he: 'נבדק',
    ru: 'Проверено',
    en: 'Reviewed',
  },
  planned: {
    he: 'מתוכנן',
    ru: 'Запланировано',
    en: 'Planned',
  },
  done: {
    he: 'בוצע',
    ru: 'Сделано',
    en: 'Done',
  },
};

const weekDayNames: Record<number, LocalizedText> = {
  0: {
    he: 'ראשון',
    ru: 'Воскресенье',
    en: 'Sunday',
  },
  1: {
    he: 'שני',
    ru: 'Понедельник',
    en: 'Monday',
  },
  2: {
    he: 'שלישי',
    ru: 'Вторник',
    en: 'Tuesday',
  },
  3: {
    he: 'רביעי',
    ru: 'Среда',
    en: 'Wednesday',
  },
  4: {
    he: 'חמישי',
    ru: 'Четверг',
    en: 'Thursday',
  },
  5: {
    he: 'שישי',
    ru: 'Пятница',
    en: 'Friday',
  },
  6: {
    he: 'שבת',
    ru: 'Суббота',
    en: 'Saturday',
  },
};

export function t(language: AppLanguage, text: LocalizedText): string {
  return text[language];
}

export function isRtlLanguage(language: AppLanguage): boolean {
  return language === 'he';
}

export function localeByLanguage(language: AppLanguage): string {
  if (language === 'he') {
    return 'he-IL';
  }
  if (language === 'ru') {
    return 'ru-RU';
  }
  return 'en-GB';
}

export function languageName(language: AppLanguage, uiLanguage: AppLanguage): string {
  return languageNames[language][uiLanguage];
}

export function roleNameById(roleId: RoleId, language: AppLanguage): string {
  return roleNames[roleId][language];
}

export function roleCompactNameById(roleId: RoleId, language: AppLanguage): string {
  return roleCompactNames[roleId][language];
}

export function lessonTypeName(type: LessonType, language: AppLanguage): string {
  return lessonTypeNames[type][language];
}

export function feedbackStatusName(status: FeedbackStatus, language: AppLanguage): string {
  return feedbackStatusNames[status][language];
}

export function weekDayName(dayIndex: number, language: AppLanguage): string {
  return weekDayNames[dayIndex][language];
}
