import { AppLanguage, FeedbackStatus, LessonType, RoleId } from '../types/models';

type LocalizedText = Record<AppLanguage, string>;
type SubjectKey =
  | 'hebrew'
  | 'math'
  | 'science'
  | 'history'
  | 'robotics'
  | 'english'
  | 'art'
  | 'pe'
  | 'geography'
  | 'computer_science'
  | 'music'
  | 'weekly_assembly'
  | 'shabbat_prep'
  | 'substitute_seminar';
type RoomKey =
  | 'lab_1'
  | 'stem_room'
  | 'studio'
  | 'gym'
  | 'tech_2'
  | 'music_hall'
  | 'main_hall'
  | 'classroom'
  | 'conference_room';
type ReasonKey = 'teacher_sick_replaced' | 'director_schedule_update';

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

const subjectTranslations: Record<SubjectKey, LocalizedText> = {
  hebrew: { ru: 'Иврит', en: 'Hebrew', he: 'עברית' },
  math: { ru: 'Математика', en: 'Math', he: 'מתמטיקה' },
  science: { ru: 'Естествознание', en: 'Science', he: 'מדעים' },
  history: { ru: 'История', en: 'History', he: 'היסטוריה' },
  robotics: { ru: 'Робототехника', en: 'Robotics', he: 'רובוטיקה' },
  english: { ru: 'Английский язык', en: 'English', he: 'אנגלית' },
  art: { ru: 'ИЗО', en: 'Art', he: 'אמנות' },
  pe: { ru: 'Физкультура', en: 'PE', he: 'חינוך גופני' },
  geography: { ru: 'География', en: 'Geography', he: 'גאוגרפיה' },
  computer_science: { ru: 'Информатика', en: 'Computer Science', he: 'מדעי המחשב' },
  music: { ru: 'Музыка', en: 'Music', he: 'מוזיקה' },
  weekly_assembly: { ru: 'Общая линейка', en: 'Weekly Assembly', he: 'אספה שבועית' },
  shabbat_prep: {
    ru: 'Классное мероприятие: подготовка к шаббату',
    en: 'Class Event: Shabbat Prep',
    he: 'אירוע כיתתי: הכנה לשבת',
  },
  substitute_seminar: {
    ru: 'Заменяющий семинар',
    en: 'Substitute Seminar',
    he: 'סמינר חלופי',
  },
};

const roomTranslations: Record<RoomKey, LocalizedText> = {
  lab_1: { ru: 'Лаборатория 1', en: 'Lab 1', he: 'מעבדה 1' },
  stem_room: { ru: 'Технический кабинет', en: 'STEM Room', he: 'חדר STEM' },
  studio: { ru: 'Студия', en: 'Studio', he: 'סטודיו' },
  gym: { ru: 'Спортзал', en: 'Gym', he: 'אולם ספורט' },
  tech_2: { ru: 'Кабинет информатики 2', en: 'Tech 2', he: 'מעבדת מחשבים 2' },
  music_hall: { ru: 'Музыкальный зал', en: 'Music Hall', he: 'אולם מוזיקה' },
  main_hall: { ru: 'Актовый зал', en: 'Main Hall', he: 'אולם ראשי' },
  classroom: { ru: 'Класс', en: 'Classroom', he: 'כיתה' },
  conference_room: { ru: 'Конференц-зал', en: 'Conference Room', he: 'חדר ישיבות' },
};

const reasonTranslations: Record<ReasonKey, LocalizedText> = {
  teacher_sick_replaced: {
    ru: 'Учитель заболел. Урок заменён занятием по робототехнике.',
    en: 'Teacher sick. Replaced with robotics workshop.',
    he: 'המורה חולה. השיעור הוחלף בסדנת רובוטיקה.',
  },
  director_schedule_update: {
    ru: 'Обновление расписания от директора',
    en: 'Director-published schedule update',
    he: 'עדכון מערכת שפורסם על ידי המנהל',
  },
};

const subjectVariants: Record<string, SubjectKey> = {
  hebrew: 'hebrew',
  'иврит': 'hebrew',
  'עברית': 'hebrew',
  math: 'math',
  'математика': 'math',
  'מתמטיקה': 'math',
  science: 'science',
  'естествознание': 'science',
  'מדעים': 'science',
  history: 'history',
  'история': 'history',
  'היסטוריה': 'history',
  robotics: 'robotics',
  'робототехника': 'robotics',
  'רובוטיקה': 'robotics',
  english: 'english',
  'английский язык': 'english',
  'אנגלית': 'english',
  art: 'art',
  'изо': 'art',
  'אמנות': 'art',
  pe: 'pe',
  'физкультура': 'pe',
  'חינוך גופני': 'pe',
  geography: 'geography',
  'география': 'geography',
  'גאוגרפיה': 'geography',
  'computer science': 'computer_science',
  'информатика': 'computer_science',
  'מדעי המחשב': 'computer_science',
  music: 'music',
  'музыка': 'music',
  'מוזיקה': 'music',
  'weekly assembly': 'weekly_assembly',
  'общая линейка': 'weekly_assembly',
  'אספה שבועית': 'weekly_assembly',
  'class event: shabbat prep': 'shabbat_prep',
  'классное мероприятие: подготовка к шаббату': 'shabbat_prep',
  'אירוע כיתתי: הכנה לשבת': 'shabbat_prep',
  'substitute seminar': 'substitute_seminar',
  'заменяющий семинар': 'substitute_seminar',
  'סמינר חלופי': 'substitute_seminar',
};

const roomVariants: Record<string, RoomKey> = {
  'lab 1': 'lab_1',
  'лаборатория 1': 'lab_1',
  'מעבדה 1': 'lab_1',
  'stem room': 'stem_room',
  'технический кабинет': 'stem_room',
  'חדר stem': 'stem_room',
  studio: 'studio',
  'студия': 'studio',
  'סטודיו': 'studio',
  gym: 'gym',
  'спортзал': 'gym',
  'אולם ספורט': 'gym',
  'tech 2': 'tech_2',
  'кабинет информатики 2': 'tech_2',
  'מעבדת מחשבים 2': 'tech_2',
  'music hall': 'music_hall',
  'музыкальный зал': 'music_hall',
  'אולם מוזיקה': 'music_hall',
  'main hall': 'main_hall',
  'актовый зал': 'main_hall',
  'אולם ראשי': 'main_hall',
  classroom: 'classroom',
  'класс': 'classroom',
  'כיתה': 'classroom',
  'conference room': 'conference_room',
  'конференц-зал': 'conference_room',
  'חדר ישיבות': 'conference_room',
};

const reasonVariants: Record<string, ReasonKey> = {
  'teacher sick. replaced with robotics workshop.': 'teacher_sick_replaced',
  'учитель заболел. урок заменён занятием по робототехнике.': 'teacher_sick_replaced',
  'המורה חולה. השיעור הוחלף בסדנת רובוטיקה.': 'teacher_sick_replaced',
  'director-published schedule update': 'director_schedule_update',
  'обновление расписания от директора': 'director_schedule_update',
  'עדכון מערכת שפורסם על ידי המנהל': 'director_schedule_update',
};

function normalizeLookupValue(value: string): string {
  return value.trim().toLocaleLowerCase();
}

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

export function localizeLessonSubject(subject: string, language: AppLanguage): string {
  const key = subjectVariants[normalizeLookupValue(subject)];
  if (!key) {
    return subject;
  }
  return subjectTranslations[key][language];
}

export function localizeLessonRoom(room: string, language: AppLanguage): string {
  const key = roomVariants[normalizeLookupValue(room)];
  if (!key) {
    return room;
  }
  return roomTranslations[key][language];
}

export function localizeLessonReason(reason: string | null, language: AppLanguage): string {
  if (!reason) {
    return '';
  }
  const key = reasonVariants[normalizeLookupValue(reason)];
  if (!key) {
    return reason;
  }
  return reasonTranslations[key][language];
}
