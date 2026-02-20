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
  return snapshot.classes.find((entry) => entry.id === classId)?.name ?? classId;
}

export function classIdsForUser(user: User, snapshot: DatabaseSnapshot): string[] {
  if (user.role_id === 1) {
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
