import { getDayIndexInJerusalem } from './time';
import { t } from './i18n';
import { AppLanguage, DatabaseSnapshot, Lesson, Thread, User } from '../types/models';

export function className(
  snapshot: DatabaseSnapshot,
  classId: string | null,
  language: AppLanguage = 'en',
): string {
  if (!classId) {
    return t(language, {
      ru: 'Все классы',
      en: 'All classes',
      he: 'כל הכיתות',
    });
  }
  const classModel = snapshot.classes.find((entry) => entry.id === classId);
  if (!classModel) {
    return classId;
  }
  return classModel.name_i18n?.[language] ?? classModel.name;
}

export function classIdsForUser(user: User, snapshot: DatabaseSnapshot): string[] {
  if (user.role_id === 1 || user.role_id === 7) {
    return snapshot.classes.map((entry) => entry.id);
  }

  if (user.role_id === 4) {
    const children = snapshot.users.filter((entry) => user.child_ids.includes(entry.id));
    return Array.from(new Set(children.flatMap((entry) => entry.class_ids)));
  }

  return user.class_ids;
}

export function lessonsForUser(user: User, snapshot: DatabaseSnapshot): Lesson[] {
  const classIds = classIdsForUser(user, snapshot);
  return snapshot.lessons.filter((lesson) => classIds.includes(lesson.class_id));
}

export function todayLessons(user: User, snapshot: DatabaseSnapshot): Lesson[] {
  const today = getDayIndexInJerusalem(new Date().toISOString());
  return lessonsForUser(user, snapshot)
    .filter((lesson) => getDayIndexInJerusalem(lesson.start_datetime) === today)
    .sort((left, right) => new Date(left.start_datetime).getTime() - new Date(right.start_datetime).getTime());
}

export function currentLesson(user: User, snapshot: DatabaseSnapshot): Lesson | null {
  const now = Date.now();
  return (
    lessonsForUser(user, snapshot).find((lesson) => {
      const start = new Date(lesson.start_datetime).getTime();
      const end = new Date(lesson.end_datetime).getTime();
      return now >= start && now <= end;
    }) ?? null
  );
}

export function threadsForUser(user: User, snapshot: DatabaseSnapshot): Thread[] {
  return snapshot.threads.filter((thread) => thread.participants.includes(user.id));
}

export function threadTitle(
  thread: Thread,
  snapshot: DatabaseSnapshot,
  language: AppLanguage = 'en',
): string {
  if (thread.type === 'announcement') {
    return t(language, {
      ru: 'Объявления директора',
      en: 'Director announcements',
      he: 'הודעות מנהל',
    });
  }
  if (thread.type === 'class') {
    if (language === 'ru') {
      return `Объявления класса ${className(snapshot, thread.class_id, language)}`;
    }
    if (language === 'he') {
      return `הודעות כיתה ${className(snapshot, thread.class_id, language)}`;
    }
    return `Class ${className(snapshot, thread.class_id, language)} announcements`;
  }

  const names = thread.participants
    .map((participantId) => snapshot.users.find((user) => user.id === participantId)?.name)
    .filter(Boolean)
    .join(' / ');
  return (
    names ||
    t(language, {
      ru: 'Чат родитель-учитель',
      en: 'Parent-Teacher thread',
      he: 'צ׳אט הורה-מורה',
    })
  );
}

export function announcementThreads(user: User, snapshot: DatabaseSnapshot): Thread[] {
  return snapshot.threads.filter(
    (thread) =>
      thread.participants.includes(user.id) && (thread.type === 'announcement' || thread.type === 'class'),
  );
}

export function childUsers(parent: User, snapshot: DatabaseSnapshot): User[] {
  return snapshot.users.filter((user) => parent.child_ids.includes(user.id));
}

export function latestIncomingCount(user: User, snapshot: DatabaseSnapshot): number {
  const threadIds = new Set(threadsForUser(user, snapshot).map((thread) => thread.id));
  return snapshot.messages.filter(
    (message) => threadIds.has(message.thread_id) && !message.read_by.includes(user.id),
  ).length;
}

function parseDateInput(value?: string | null): Date | null {
  const raw = (value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  const [yearRaw, monthRaw, dayRaw] = raw.split('-');
  const year = Number.parseInt(yearRaw, 10);
  const month = Number.parseInt(monthRaw, 10);
  const day = Number.parseInt(dayRaw, 10);
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return probe;
}

function monthDayFromDob(dob?: string | null): string | null {
  const date = parseDateInput(dob);
  if (!date) {
    return null;
  }
  return date.toISOString().slice(5, 10);
}

function hasCommonClass(left: User, right: User): boolean {
  return left.class_ids.some((classId) => right.class_ids.includes(classId));
}

function teachersForStudent(student: User, snapshot: DatabaseSnapshot): User[] {
  return snapshot.users.filter(
    (entry) => entry.role_id === 3 && entry.class_ids.some((classId) => student.class_ids.includes(classId)),
  );
}

export function birthdayAudienceForUser(user: User, snapshot: DatabaseSnapshot): User[] {
  const byId = new Map(snapshot.users.map((entry) => [entry.id, entry]));
  const visibleIds = new Set<string>([user.id]);

  if (user.role_id === 1 || user.role_id === 7) {
    return snapshot.users.filter((entry) => entry.is_active);
  }

  if (user.role_id === 5) {
    snapshot.users.forEach((entry) => {
      if (!entry.is_active) {
        return;
      }
      if (entry.id === user.id) {
        visibleIds.add(entry.id);
        return;
      }
      if (entry.role_id === 5 && hasCommonClass(user, entry)) {
        visibleIds.add(entry.id);
        return;
      }
      if (entry.role_id === 3 && hasCommonClass(user, entry)) {
        visibleIds.add(entry.id);
        return;
      }
      if (entry.role_id === 1 || entry.role_id === 6) {
        visibleIds.add(entry.id);
      }
    });
  } else if (user.role_id === 3) {
    snapshot.users.forEach((entry) => {
      if (!entry.is_active) {
        return;
      }
      if (entry.id === user.id) {
        visibleIds.add(entry.id);
        return;
      }
      if (entry.role_id === 5 && hasCommonClass(user, entry)) {
        visibleIds.add(entry.id);
        return;
      }
      if (entry.role_id === 3 || entry.role_id === 1 || entry.role_id === 6) {
        visibleIds.add(entry.id);
      }
    });
  } else if (user.role_id === 6) {
    snapshot.users.forEach((entry) => {
      if (!entry.is_active) {
        return;
      }
      if (entry.id === user.id) {
        visibleIds.add(entry.id);
        return;
      }
      if (entry.role_id === 3 || entry.role_id === 1 || entry.role_id === 5) {
        visibleIds.add(entry.id);
      }
    });
  } else if (user.role_id === 4) {
    snapshot.users.forEach((entry) => {
      if (!entry.is_active) {
        return;
      }
      if (entry.id === user.id || user.child_ids.includes(entry.id)) {
        visibleIds.add(entry.id);
      }
    });
    const children = snapshot.users.filter((entry) => user.child_ids.includes(entry.id));
    for (const child of children) {
      for (const teacher of teachersForStudent(child, snapshot)) {
        visibleIds.add(teacher.id);
      }
    }
    snapshot.users.forEach((entry) => {
      if (entry.role_id === 1 || entry.role_id === 6) {
        visibleIds.add(entry.id);
      }
    });
  }

  return [...visibleIds]
    .map((id) => byId.get(id))
    .filter((entry): entry is User => Boolean(entry));
}

export function birthdaysForDateForUser(
  user: User,
  snapshot: DatabaseSnapshot,
  dateInput: string,
): User[] {
  const monthDay = dateInput.slice(5, 10);
  return birthdayAudienceForUser(user, snapshot)
    .filter((entry) => {
      const birthdayMonthDay = monthDayFromDob(entry.dob);
      if (!birthdayMonthDay) {
        return false;
      }
      if (entry.id !== user.id && entry.show_birthday_in_calendar === false) {
        return false;
      }
      return birthdayMonthDay === monthDay;
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function birthdayDateKeysForUser(
  user: User,
  snapshot: DatabaseSnapshot,
  startDateInput: string,
  endDateInput: string,
): Set<string> {
  const result = new Set<string>();
  const start = parseDateInput(startDateInput);
  const end = parseDateInput(endDateInput);
  if (!start || !end) {
    return result;
  }

  const birthdays = birthdayAudienceForUser(user, snapshot)
    .filter((entry) => entry.id === user.id || entry.show_birthday_in_calendar !== false)
    .map((entry) => ({
      entry,
      monthDay: monthDayFromDob(entry.dob),
    }))
    .filter((item): item is { entry: User; monthDay: string } => Boolean(item.monthDay));

  const probe = new Date(start.getTime());
  while (probe.getTime() <= end.getTime()) {
    const key = probe.toISOString().slice(0, 10);
    const monthDay = probe.toISOString().slice(5, 10);
    if (birthdays.some((item) => item.monthDay === monthDay)) {
      result.add(key);
    }
    probe.setUTCDate(probe.getUTCDate() + 1);
  }
  return result;
}
