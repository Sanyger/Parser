import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  PressableStateCallbackType,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { buildInfoLine } from '../lib/buildInfo';
import {
  isRtlLanguage,
  localeByLanguage,
  localizeLessonReason,
  localizeLessonRoom,
  localizeLessonSubject,
  roleNameById,
  t,
} from '../lib/i18n';
import {
  announcementThreads,
  birthdayDateKeysForUser,
  birthdaysForDateForUser,
  lessonsForUser,
  threadTitle,
} from '../lib/selectors';
import { ensureTranslationMap, getLocalizedText } from '../lib/translation';
import {
  formatTime,
  fromJerusalemDateTime,
  getDayIndexInJerusalem,
  toJerusalemDateInput,
} from '../lib/time';
import { AppLanguage, DatabaseSnapshot, Feedback, FeedbackCategory, Homework, Lesson, User } from '../types/models';
import { BirthdaySettingsCard } from '../components/BirthdaySettingsCard';

type MainTab = 'home' | 'events' | 'ideas' | 'profile';
type HapticTone = 'selection' | 'light' | 'medium' | 'success';

type DailyLessonCard = {
  id: string;
  number: number;
  subject: string;
  room: string;
  teacher: string;
  start: string;
  end: string;
  oldStart?: string;
  oldEnd?: string;
  reason: string;
  changed: boolean;
};

type EventCard = {
  id: string;
  title: string;
  body: string;
  date: string;
  sortKey: number;
  icon: keyof typeof Ionicons.glyphMap;
};

const MAIN_TABS: Array<{ key: MainTab; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'home', icon: 'home-outline' },
  { key: 'events', icon: 'flash-outline' },
  { key: 'ideas', icon: 'bulb-outline' },
  { key: 'profile', icon: 'person-outline' },
];

const CLOCK_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});
const BIRTHDAY_GREETING_PATTERN = /(дн[её]м\s+рожд|день\s+рожд|happy\s*birthday|יום\s+הולדת|🎂)/i;

function isPromise(value: unknown): value is Promise<void> {
  return typeof value === 'object' && value !== null && typeof (value as Promise<void>).then === 'function';
}

function isBirthdayGreetingText(text: string): boolean {
  return BIRTHDAY_GREETING_PATTERN.test(text.trim());
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fromDateKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split('-').map((entry) => Number.parseInt(entry, 10));
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function addDays(dateKey: string, days: number): string {
  const date = fromDateKey(dateKey);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKey(date);
}

function jerusalemNoonIso(dateKey: string): string {
  return fromJerusalemDateTime(dateKey, '12:00') ?? `${dateKey}T12:00:00.000Z`;
}

function startOfWeek(dateKey: string): string {
  const dayIndex = getDayIndexInJerusalem(jerusalemNoonIso(dateKey));
  return addDays(dateKey, -dayIndex);
}

function weekDays(dateKey: string): string[] {
  const first = startOfWeek(dateKey);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index));
}

function rangeLabel(dateKey: string, language: User['preferred_language']): string {
  const first = startOfWeek(dateKey);
  const last = addDays(first, 6);

  const formatter = new Intl.DateTimeFormat(localeByLanguage(language), {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'short',
  });

  const firstLabel = formatter.format(new Date(jerusalemNoonIso(first))).replace('.', '');
  const lastLabel = formatter.format(new Date(jerusalemNoonIso(last))).replace('.', '');

  return t(language, {
    ru: `Выбрано: ${firstLabel} — ${lastLabel}`,
    en: `Selected: ${firstLabel} — ${lastLabel}`,
    he: `נבחר: ${firstLabel} — ${lastLabel}`,
  });
}

function shortWeekLabel(dateKey: string, language: User['preferred_language']): string {
  const formatter = new Intl.DateTimeFormat(localeByLanguage(language), {
    timeZone: 'Asia/Jerusalem',
    weekday: 'short',
  });
  return formatter.format(new Date(jerusalemNoonIso(dateKey))).replace('.', '').toUpperCase();
}

function dayMonthLabel(dateKey: string, language: User['preferred_language']): string {
  const formatter = new Intl.DateTimeFormat(localeByLanguage(language), {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit',
    month: '2-digit',
  });
  return formatter.format(new Date(jerusalemNoonIso(dateKey)));
}

function dateInputLabel(dateInput: string): string {
  const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return dateInput;
  }
  return `${match[3]}.${match[2]}`;
}

function homeworkBody(text: string): string {
  return text
    .replace(/Дано:\s*\d{2}\.\d{2}\s*/gi, '')
    .replace(/(?:Срок сдачи|Сдать до):\s*\d{2}\.\d{2}\s*/gi, '')
    .trim();
}

const IMAGE_ATTACHMENT_PATTERN = /\.(png|jpe?g|gif|webp|bmp|heic|heif)(?:\?.*)?$/i;
const AUDIO_ATTACHMENT_PATTERN = /\.(mp3|wav|ogg|aac|m4a|webm|amr)(?:\?.*)?$/i;

function appLanguageLabel(languageCode: AppLanguage, language: User['preferred_language']): string {
  if (languageCode === 'ru') {
    return t(language, { ru: 'Русский', en: 'Russian', he: 'רוסית' });
  }
  if (languageCode === 'he') {
    return t(language, { ru: 'Иврит', en: 'Hebrew', he: 'עברית' });
  }
  return t(language, { ru: 'Английский', en: 'English', he: 'אנגלית' });
}

function attachmentFileName(uri: string): string {
  const raw = uri.split('?')[0] ?? uri;
  const segments = raw.split('/');
  const candidate = segments[segments.length - 1] ?? uri;
  return candidate.length > 44 ? `${candidate.slice(0, 41)}...` : candidate;
}

function attachmentKind(uri: string): 'image' | 'audio' | 'file' {
  if (uri.startsWith('data:image/') || IMAGE_ATTACHMENT_PATTERN.test(uri)) {
    return 'image';
  }
  if (uri.startsWith('data:audio/') || AUDIO_ATTACHMENT_PATTERN.test(uri)) {
    return 'audio';
  }
  return 'file';
}

function studentClassLabel(user: User, snapshot: DatabaseSnapshot): string {
  const classModel = snapshot.classes.find((entry) => user.class_ids.includes(entry.id));
  if (!classModel) {
    return t(user.preferred_language, { ru: 'Класс', en: 'Class', he: 'כיתה' });
  }
  return classModel.name_i18n?.[user.preferred_language] ?? classModel.name;
}

function birthdayRoleLabel(entry: User, snapshot: DatabaseSnapshot, language: User['preferred_language']): string {
  if (entry.role_id === 5) {
    const classModel = snapshot.classes.find((classEntry) => entry.class_ids.includes(classEntry.id));
    return classModel?.name ?? roleNameById(5, language);
  }
  return roleNameById(entry.role_id, language);
}

function studentTabLabel(tab: MainTab, language: User['preferred_language']): string {
  if (tab === 'home') {
    return t(language, { ru: 'Главная', en: 'Home', he: 'בית' });
  }
  if (tab === 'events') {
    return t(language, { ru: 'События', en: 'Events', he: 'אירועים' });
  }
  if (tab === 'ideas') {
    return t(language, { ru: 'Идеи', en: 'Ideas', he: 'רעיונות' });
  }
  return t(language, { ru: 'Профиль', en: 'Profile', he: 'פרופיל' });
}

function categoryLabel(category: FeedbackCategory, language: User['preferred_language']): string {
  if (category === 'furniture') {
    return t(language, { ru: 'Мебель', en: 'Furniture', he: 'ריהוט' });
  }
  if (category === 'gym') {
    return t(language, { ru: 'Спортзал', en: 'Gym', he: 'אולם ספורט' });
  }
  if (category === 'canteen') {
    return t(language, { ru: 'Столовая', en: 'Canteen', he: 'קפטריה' });
  }
  return t(language, { ru: 'Техника', en: 'Equipment', he: 'ציוד' });
}

function ideaStatusView(status: Feedback['status'], language: User['preferred_language']): {
  label: string;
  color: string;
  bg: string;
} {
  if (status === 'planned') {
    return {
      label: t(language, {
        ru: 'Принято в работу',
        en: 'Accepted',
        he: 'התקבל לביצוע',
      }),
      color: '#4ADE80',
      bg: 'rgba(74, 222, 128, 0.15)',
    };
  }

  if (status === 'done') {
    return {
      label: t(language, {
        ru: 'Сделано',
        en: 'Done',
        he: 'בוצע',
      }),
      color: '#60A5FA',
      bg: 'rgba(96, 165, 250, 0.16)',
    };
  }

  return {
    label: t(language, {
      ru: 'Админ чекает',
      en: 'Admin checking',
      he: 'מנהל בודק',
    }),
    color: '#F472B6',
    bg: 'rgba(244, 114, 182, 0.16)',
  };
}

function buildLessonCards(
  dayLessons: Lesson[],
  usersById: Map<string, User>,
  language: User['preferred_language'],
): DailyLessonCard[] {
  const sorted = dayLessons
    .slice()
    .sort((left, right) => new Date(left.start_datetime).getTime() - new Date(right.start_datetime).getTime());

  const consumed = new Set<string>();
  const cards: DailyLessonCard[] = [];
  let number = 1;

  for (const lesson of sorted) {
    if (consumed.has(lesson.id)) {
      continue;
    }

    if (lesson.status === 'changed' && lesson.original_reference_id) {
      continue;
    }

    const teacher = usersById.get(lesson.teacher_id)?.name ?? t(language, {
      ru: 'Учитель',
      en: 'Teacher',
      he: 'מורה',
    });

    if (lesson.status === 'canceled') {
      const replacement = sorted.find(
        (candidate) => candidate.status === 'changed' && candidate.original_reference_id === lesson.id,
      );

      if (replacement) {
        consumed.add(replacement.id);
        cards.push({
          id: `${lesson.id}_${replacement.id}`,
          number,
          subject: localizeLessonSubject(replacement.subject, language),
          room: localizeLessonRoom(replacement.room, language),
          teacher: usersById.get(replacement.teacher_id)?.name ?? teacher,
          start: formatTime(replacement.start_datetime, language),
          end: formatTime(replacement.end_datetime, language),
          oldStart: formatTime(lesson.start_datetime, language),
          oldEnd: formatTime(lesson.end_datetime, language),
          reason: localizeLessonReason(replacement.change_reason, language),
          changed: true,
        });
        number += 1;
        continue;
      }
    }

    if (lesson.status === 'canceled') {
      continue;
    }

    cards.push({
      id: lesson.id,
      number,
      subject: localizeLessonSubject(lesson.subject, language),
      room: localizeLessonRoom(lesson.room, language),
      teacher,
      start: formatTime(lesson.start_datetime, language),
      end: formatTime(lesson.end_datetime, language),
      reason: localizeLessonReason(lesson.change_reason, language),
      changed: false,
    });
    number += 1;
  }

  return cards;
}

export function StudentScreen({
  user,
  snapshot,
  showOriginal,
  onToggleOriginal,
  onRefresh,
  onLogout,
  onMarkRead,
  onCreateFeedback,
  onUpdateProfilePhoto,
  onSetHomeworkDone,
  onUpdateBirthdaySettings,
  onSendDirectMessage,
}: {
  user: User;
  snapshot: DatabaseSnapshot;
  showOriginal: boolean;
  onToggleOriginal: () => void;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
  onMarkRead: (threadId: string) => Promise<void>;
  onCreateFeedback: (params: { text: string; category: FeedbackCategory }) => Promise<void>;
  onUpdateProfilePhoto: (photoUri: string | null) => Promise<void>;
  onSetHomeworkDone: (params: { homeworkId: string; done: boolean }) => Promise<void>;
  onUpdateBirthdaySettings: (params: { dob: string; showInCalendar: boolean }) => Promise<void>;
  onSendDirectMessage: (params: { targetUserId: string; text: string; attachments: string[] }) => Promise<void>;
}) {
  const [mainTab, setMainTab] = useState<MainTab>('home');
  const [selectedDateKey, setSelectedDateKey] = useState(() => toJerusalemDateInput(new Date().toISOString()));
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [ideaModalVisible, setIdeaModalVisible] = useState(false);
  const [avatarModalVisible, setAvatarModalVisible] = useState(false);
  const [ideaText, setIdeaText] = useState('');
  const [submittingIdea, setSubmittingIdea] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [updatingHomeworkId, setUpdatingHomeworkId] = useState<string | null>(null);
  const [homeworkCelebrationVisible, setHomeworkCelebrationVisible] = useState(false);
  const [birthdaySendingId, setBirthdaySendingId] = useState<string | null>(null);
  const [birthdayGreetingVisible, setBirthdayGreetingVisible] = useState(false);
  const [birthdayGreetingTarget, setBirthdayGreetingTarget] = useState<User | null>(null);
  const [birthdayGreetingDraft, setBirthdayGreetingDraft] = useState('');
  const [birthdayGreetingByUserId, setBirthdayGreetingByUserId] = useState<Record<string, string>>({});
  const [birthdayCongratulatedIds, setBirthdayCongratulatedIds] = useState<string[]>([]);

  const language = user.preferred_language;
  const rtl = isRtlLanguage(language);

  const contentOpacity = useRef(new Animated.Value(1)).current;
  const contentTranslateY = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const previousHomeworkProgressRef = useRef(0);

  const buildInfo = buildInfoLine(language);
  const classLabel = studentClassLabel(user, snapshot);

  const usersById = useMemo(() => new Map(snapshot.users.map((entry) => [entry.id, entry])), [snapshot.users]);
  const directThreadsById = useMemo(
    () =>
      new Map(
        snapshot.threads
          .filter((thread) => thread.type === 'direct')
          .map((thread) => [thread.id, thread]),
      ),
    [snapshot.threads],
  );
  const lessons = useMemo(() => lessonsForUser(user, snapshot), [user, snapshot]);

  const currentWeekDays = useMemo(() => weekDays(selectedDateKey), [selectedDateKey]);

  const fullCalendarWeeks = useMemo(() => {
    const anchor = startOfWeek(selectedDateKey);
    return Array.from({ length: 10 }, (_, index) => {
      const start = addDays(anchor, (index - 2) * 7);
      return Array.from({ length: 7 }, (_, dayIndex) => addDays(start, dayIndex));
    });
  }, [selectedDateKey]);

  const calendarStartDate = fullCalendarWeeks[0]?.[0] ?? selectedDateKey;
  const calendarEndDate = fullCalendarWeeks[fullCalendarWeeks.length - 1]?.[6] ?? selectedDateKey;

  const birthdayDateMarkers = useMemo(
    () => birthdayDateKeysForUser(user, snapshot, calendarStartDate, calendarEndDate),
    [calendarEndDate, calendarStartDate, snapshot, user],
  );

  const birthdayUsersForSelectedDay = useMemo(
    () => birthdaysForDateForUser(user, snapshot, selectedDateKey),
    [selectedDateKey, snapshot, user],
  );

  const dailyCards = useMemo(() => {
    const selectedDayLessons = lessons.filter((lesson) => toJerusalemDateInput(lesson.start_datetime) === selectedDateKey);
    return buildLessonCards(selectedDayLessons, usersById, language);
  }, [lessons, selectedDateKey, usersById, language]);

  const announcementOnly = useMemo(() => announcementThreads(user, snapshot), [user, snapshot]);
  const birthdayMessageEvents = useMemo<EventCard[]>(() => {
    return snapshot.messages
      .map((message) => {
        const thread = directThreadsById.get(message.thread_id);
        if (!thread || !thread.participants.includes(user.id) || !isBirthdayGreetingText(message.text_original)) {
          return null;
        }
        const senderName =
          usersById.get(message.sender_id)?.name ??
          t(language, { ru: 'Пользователь', en: 'User', he: 'משתמש' });
        const peerId = thread.participants.find((participant) => participant !== user.id) ?? message.sender_id;
        const peerName =
          usersById.get(peerId)?.name ??
          t(language, { ru: 'Пользователь', en: 'User', he: 'משתמש' });
        const outgoing = message.sender_id === user.id;
        return {
          id: `birthday_${message.id}`,
          title: t(language, {
            ru: 'Поздравления',
            en: 'Greetings',
            he: 'ברכות',
          }),
          body: outgoing
            ? t(language, {
                ru: `Вы поздравили ${peerName}.`,
                en: `You congratulated ${peerName}.`,
                he: `בירכת את ${peerName}.`,
              })
            : t(language, {
                ru: `Вас поздравили с днем рождения! 🎂 (${senderName})`,
                en: `You were congratulated on your birthday! 🎂 (${senderName})`,
                he: `בירכו אותך ליום ההולדת! 🎂 (${senderName})`,
              }),
          date: `${toJerusalemDateInput(message.created_at)} ${formatTime(message.created_at, language)}`,
          sortKey: new Date(message.created_at).getTime(),
          icon: 'chatbubble-ellipses-outline',
        };
      })
      .filter((entry): entry is EventCard => Boolean(entry));
  }, [directThreadsById, language, snapshot.messages, user.id, usersById]);

  const eventCards = useMemo(() => {
    const announcementIds = new Set(announcementOnly.map((thread) => thread.id));

    const announcementEvents: EventCard[] = snapshot.messages
      .filter((message) => announcementIds.has(message.thread_id))
      .map((message) => ({
        id: message.id,
        title: usersById.get(message.sender_id)?.name ?? t(language, { ru: 'Сообщение', en: 'Message', he: 'הודעה' }),
        body: getLocalizedText(message.text_original, message.translations, language, showOriginal),
        date: `${toJerusalemDateInput(message.created_at)} ${formatTime(message.created_at, language)}`,
        sortKey: new Date(message.created_at).getTime(),
        icon: 'megaphone-outline',
      }));

    const scheduleEvents: EventCard[] = lessons
      .filter((lesson) => lesson.status === 'changed')
      .map((lesson) => ({
        id: `schedule_${lesson.id}`,
        title: t(language, {
          ru: 'Изменение урока',
          en: 'Lesson changed',
          he: 'שינוי בשיעור',
        }),
        body: `${localizeLessonSubject(lesson.subject, language)} · ${localizeLessonReason(lesson.change_reason, language)}`,
        date: `${toJerusalemDateInput(lesson.start_datetime)} ${formatTime(lesson.start_datetime, language)}`,
        sortKey: new Date(lesson.start_datetime).getTime(),
        icon: 'swap-horizontal-outline',
      }));

    return [...birthdayMessageEvents, ...announcementEvents, ...scheduleEvents]
      .sort((left, right) => right.sortKey - left.sortKey)
      .slice(0, 30);
  }, [announcementOnly, birthdayMessageEvents, snapshot.messages, usersById, language, showOriginal, lessons]);

  const ideaFeed = useMemo(() => [...snapshot.feedback].reverse(), [snapshot.feedback]);

  const parentIds = useMemo(
    () =>
      snapshot.users
        .filter((entry) => entry.role_id === 4 && entry.child_ids.includes(user.id))
        .map((entry) => entry.id),
    [snapshot.users, user.id],
  );

  const myHomework = useMemo(
    () =>
      snapshot.homework
        .filter((entry) => user.class_ids.includes(entry.class_id))
        .sort(
          (left, right) =>
            left.due_date.localeCompare(right.due_date) ||
            new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
        ),
    [snapshot.homework, user.class_ids],
  );
  const lessonsById = useMemo(() => new Map(snapshot.lessons.map((entry) => [entry.id, entry])), [snapshot.lessons]);
  const completedHomeworkCount = useMemo(
    () => myHomework.filter((entry) => entry.student_confirmed_ids.includes(user.id)).length,
    [myHomework, user.id],
  );
  const homeworkProgressPercent =
    myHomework.length === 0 ? 0 : Math.round((completedHomeworkCount / myHomework.length) * 100);
  const knownLanguages = useMemo(
    () => (user.known_languages && user.known_languages.length > 0 ? user.known_languages : [user.preferred_language]),
    [user.known_languages, user.preferred_language],
  );

  const pressWithHaptic = useCallback(
    (action: () => void | Promise<void>, tone: HapticTone = 'selection') => {
      return () => {
        void (async () => {
          try {
            if (tone === 'success') {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } else if (tone === 'medium') {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            } else if (tone === 'light') {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            } else {
              await Haptics.selectionAsync();
            }
          } catch {
            // haptics not supported on this runtime/device
          }
        })();

        const result = action();
        if (isPromise(result)) {
          void result;
        }
      };
    },
    [],
  );

  const pickPhoto = useCallback(async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          t(language, {
            ru: 'Доступ к фото не выдан',
            en: 'Photo access denied',
            he: 'אין גישה לתמונות',
          }),
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.85,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      setUploadingPhoto(true);
      await onUpdateProfilePhoto(result.assets[0].uri);
      Alert.alert(
        t(language, {
          ru: 'Фото обновлено',
          en: 'Photo updated',
          he: 'התמונה עודכנה',
        }),
      );
    } catch (error) {
      Alert.alert(
        t(language, {
          ru: 'Не удалось обновить фото',
          en: 'Failed to update photo',
          he: 'לא ניתן לעדכן תמונה',
        }),
        (error as Error).message,
      );
    } finally {
      setUploadingPhoto(false);
    }
  }, [language, onUpdateProfilePhoto]);

  const submitIdea = useCallback(async () => {
    if (!ideaText.trim()) {
      Alert.alert(
        t(language, {
          ru: 'Напишите идею',
          en: 'Write your idea',
          he: 'כתוב רעיון',
        }),
      );
      return;
    }

    setSubmittingIdea(true);
    try {
      await onCreateFeedback({
        text: ideaText.trim(),
        category: 'equipment',
      });
      setIdeaText('');
      setIdeaModalVisible(false);
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        // no-op
      }
    } catch (error) {
      Alert.alert(
        t(language, {
          ru: 'Не удалось отправить идею',
          en: 'Failed to send idea',
          he: 'לא ניתן לשלוח רעיון',
        }),
        (error as Error).message,
      );
    } finally {
      setSubmittingIdea(false);
    }
  }, [ideaText, language, onCreateFeedback]);

  const toggleHomeworkDone = useCallback(
    async (item: Homework) => {
      const done = item.student_confirmed_ids.includes(user.id);
      setUpdatingHomeworkId(item.id);
      try {
        await onSetHomeworkDone({
          homeworkId: item.id,
          done: !done,
        });
      } catch (error) {
        Alert.alert(
          t(language, {
            ru: 'Не удалось обновить задание',
            en: 'Failed to update homework',
            he: 'לא ניתן לעדכן שיעורי בית',
          }),
          (error as Error).message,
        );
      } finally {
        setUpdatingHomeworkId(null);
      }
    },
    [language, onSetHomeworkDone, user.id],
  );

  const birthdaySuggestedGreeting = useCallback(
    (entry: User) =>
      t(language, {
        ru: `С днём рождения, ${entry.name}! 🎉`,
        en: `Happy birthday, ${entry.name}! 🎉`,
        he: `יום הולדת שמח, ${entry.name}! 🎉`,
      }),
    [language],
  );

  const closeBirthdayGreetingModal = useCallback(() => {
    setBirthdayGreetingVisible(false);
    setBirthdayGreetingTarget(null);
    setBirthdayGreetingDraft('');
  }, []);

  const openBirthdayGreetingModal = useCallback(
    (entry: User) => {
      if (entry.id === user.id) {
        return;
      }
      const existing = birthdayGreetingByUserId[entry.id]?.trim();
      setBirthdayGreetingTarget(entry);
      setBirthdayGreetingDraft(existing || birthdaySuggestedGreeting(entry));
      setBirthdayGreetingVisible(true);
    },
    [birthdayGreetingByUserId, birthdaySuggestedGreeting, user.id],
  );

  const submitBirthdayGreeting = useCallback(async () => {
    if (!birthdayGreetingTarget || birthdayGreetingTarget.id === user.id) {
      return;
    }
    const text = birthdayGreetingDraft.trim();
    if (!text) {
      Alert.alert(
        t(language, {
          ru: 'Пустое сообщение',
          en: 'Empty message',
          he: 'הודעה ריקה',
        }),
        t(language, {
          ru: 'Введите текст поздравления',
          en: 'Enter a greeting text',
          he: 'הזן טקסט ברכה',
        }),
      );
      return;
    }
    setBirthdaySendingId(birthdayGreetingTarget.id);
    try {
      await onSendDirectMessage({
        targetUserId: birthdayGreetingTarget.id,
        text,
        attachments: [],
      });
      setBirthdayGreetingByUserId((current) => ({
        ...current,
        [birthdayGreetingTarget.id]: text,
      }));
      setBirthdayCongratulatedIds((current) =>
        current.includes(birthdayGreetingTarget.id) ? current : [...current, birthdayGreetingTarget.id],
      );
      closeBirthdayGreetingModal();
      Alert.alert(
        t(language, {
          ru: 'Поздравление отправлено',
          en: 'Greeting sent',
          he: 'הברכה נשלחה',
        }),
      );
    } catch (error) {
      Alert.alert(
        t(language, {
          ru: 'Не удалось отправить поздравление',
          en: 'Failed to send greeting',
          he: 'לא ניתן לשלוח ברכה',
        }),
        (error as Error).message,
      );
    } finally {
      setBirthdaySendingId(null);
    }
  }, [birthdayGreetingDraft, birthdayGreetingTarget, closeBirthdayGreetingModal, language, onSendDirectMessage, user.id]);

  useEffect(() => {
    contentOpacity.setValue(0);
    contentTranslateY.setValue(14);
    Animated.parallel([
      Animated.timing(contentOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(contentTranslateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [contentOpacity, contentTranslateY, mainTab]);

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.06,
          duration: 620,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 620,
          useNativeDriver: true,
        }),
      ]),
    );
    pulseLoop.start();

    return () => {
      pulseLoop.stop();
    };
  }, [pulseAnim]);

  useEffect(() => {
    const previous = previousHomeworkProgressRef.current;
    if (myHomework.length > 0 && homeworkProgressPercent === 100 && previous < 100) {
      setHomeworkCelebrationVisible(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }
    previousHomeworkProgressRef.current = homeworkProgressPercent;
  }, [homeworkProgressPercent, myHomework.length]);

  useEffect(() => {
    if (!homeworkCelebrationVisible) {
      return;
    }
    const timer = setTimeout(() => {
      setHomeworkCelebrationVisible(false);
    }, 1800);
    return () => {
      clearTimeout(timer);
    };
  }, [homeworkCelebrationVisible]);

  const initials = useMemo(() => {
    return user.name
      .split(' ')
      .filter(Boolean)
      .map((entry) => entry[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }, [user.name]);

  const renderHome = () => {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <GlassPanel style={styles.rangePanel}>
          <View style={[styles.rangeHeaderRow, rtl && styles.rowReverse]}>
            <Text style={[styles.rangeText, rtl && styles.textRtl]}>{rangeLabel(selectedDateKey, language)}</Text>
            <Pressable
              style={({ pressed }: PressableStateCallbackType) => [styles.calendarIconButton, pressed && styles.pressedState]}
              onPress={pressWithHaptic(() => setCalendarVisible(true), 'light')}
            >
              <Ionicons name="calendar-outline" size={18} color="#F8FAFC" />
            </Pressable>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daysRibbon}>
            {currentWeekDays.map((dayKey) => {
              const active = dayKey === selectedDateKey;
              const hasBirthday = birthdayDateMarkers.has(dayKey);
              return (
                <Pressable
                  key={dayKey}
                  style={({ pressed }: PressableStateCallbackType) => [
                    styles.dayChip,
                    active && styles.dayChipActive,
                    pressed && styles.pressedState,
                  ]}
                  onPress={pressWithHaptic(() => setSelectedDateKey(dayKey))}
                >
                  <Text style={[styles.dayChipWeekText, active && styles.dayChipWeekTextActive]}>
                    {shortWeekLabel(dayKey, language)}
                  </Text>
                  <Text style={[styles.dayChipDateText, active && styles.dayChipDateTextActive]}>
                    {dayMonthLabel(dayKey, language)}
                  </Text>
                  {hasBirthday ? (
                    <View style={[styles.birthdayMarkerDot, active && styles.birthdayMarkerDotActive]} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </GlassPanel>

        <View style={[styles.sectionHeaderRow, rtl && styles.rowReverse]}>
          <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Уроки на сегодня',
              en: 'Today lessons',
              he: 'שיעורים להיום',
            })}
          </Text>
        </View>

        {birthdayUsersForSelectedDay.length > 0 ? (
          <GlassPanel style={styles.birthdaySection}>
            <Text style={[styles.birthdaySectionTitle, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Сегодня праздник!',
                en: 'Today is a celebration!',
                he: 'היום חגיגה!',
              })}
            </Text>

            {birthdayUsersForSelectedDay.map((entry) => (
              <View key={`birthday_${entry.id}`} style={[styles.birthdayCard, rtl && styles.rowReverse]}>
                <View style={[styles.birthdayIdentityRow, rtl && styles.rowReverse]}>
                  {entry.photo_uri ? (
                    <Image source={{ uri: entry.photo_uri }} style={styles.birthdayAvatar} />
                  ) : (
                    <View style={[styles.birthdayAvatar, styles.birthdayAvatarFallback]}>
                      <Ionicons name="person-outline" size={14} color="#EC4899" />
                    </View>
                  )}
                  <View>
                    <Text style={[styles.birthdayName, rtl && styles.textRtl]}>{entry.name}</Text>
                    <Text style={[styles.birthdayRole, rtl && styles.textRtl]}>
                      {birthdayRoleLabel(entry, snapshot, language)}
                    </Text>
                    {birthdayCongratulatedIds.includes(entry.id) && birthdayGreetingByUserId[entry.id] ? (
                      <Text style={[styles.birthdaySentPreview, rtl && styles.textRtl]} numberOfLines={1}>
                        {birthdayGreetingByUserId[entry.id]}
                      </Text>
                    ) : null}
                  </View>
                </View>

                <Pressable
                  style={({ pressed }: PressableStateCallbackType) => [
                    styles.birthdayGreetButton,
                    birthdayCongratulatedIds.includes(entry.id) && styles.birthdayGreetButtonDone,
                    entry.id === user.id && styles.birthdayGreetButtonDisabled,
                    pressed && styles.pressedState,
                  ]}
                  disabled={entry.id === user.id || birthdaySendingId === entry.id}
                  onPress={pressWithHaptic(() => openBirthdayGreetingModal(entry), 'light')}
                >
                  <Text style={styles.birthdayGreetText}>
                    {birthdaySendingId === entry.id
                      ? t(language, { ru: 'Отправка...', en: 'Sending...', he: 'שולח...' })
                      : birthdayCongratulatedIds.includes(entry.id)
                        ? t(language, { ru: 'Вы поздравили', en: 'Sent', he: 'שלחת' })
                      : t(language, { ru: 'Поздравить', en: 'Congratulate', he: 'ברך' })}
                  </Text>
                </Pressable>
              </View>
            ))}
          </GlassPanel>
        ) : null}

        {dailyCards.length === 0 ? (
          <GlassPanel>
            <Text style={[styles.emptyText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'На выбранную дату событий нет',
                en: 'No lessons for selected date',
                he: 'אין שיעורים לתאריך שנבחר',
              })}
            </Text>
          </GlassPanel>
        ) : (
          dailyCards.map((card) => (
            <Pressable
              key={card.id}
              style={({ pressed }: PressableStateCallbackType) => [styles.lessonCardWrap, pressed && styles.pressedState]}
              onPress={pressWithHaptic(
                () =>
                  Alert.alert(
                    card.subject,
                    `${card.room} · ${card.teacher}\n${card.start}-${card.end}${card.reason ? `\n${card.reason}` : ''}`,
                  ),
                'light',
              )}
            >
              <GlassPanel style={styles.lessonCard}>
                <LinearGradient
                  colors={card.changed ? ['#FB7185', '#EF4444'] : ['#EC4899', '#8B5CF6']}
                  style={styles.lessonNumberWrap}
                >
                  <Text style={styles.lessonNumberText}>{card.number}</Text>
                </LinearGradient>

                <View style={styles.lessonBody}>
                  <Text style={[styles.lessonSubject, rtl && styles.textRtl]}>{card.subject}</Text>
                  <Text style={[styles.lessonMeta, rtl && styles.textRtl]}>
                    {card.room} · {card.teacher}
                  </Text>
                  {card.changed && card.oldStart && card.oldEnd ? (
                    <View style={styles.oldTimeRow}>
                      <Text style={[styles.oldTimeText, rtl && styles.textRtl]}>
                        {card.oldStart}-{card.oldEnd}
                      </Text>
                      <View style={styles.oldTimeStrike} />
                    </View>
                  ) : null}
                  {card.reason ? <Text style={[styles.lessonReason, rtl && styles.textRtl]}>{card.reason}</Text> : null}
                </View>

                <Text style={styles.lessonDigitalTime}>
                  {card.start}
                  {'\n'}
                  {card.end}
                </Text>
              </GlassPanel>
            </Pressable>
          ))
        )}

        <View style={[styles.sectionHeaderRow, styles.homeworkHeaderRow, rtl && styles.rowReverse]}>
          <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Мои задания',
              en: 'My homework',
              he: 'שיעורי הבית שלי',
            })}
          </Text>
          <View style={styles.homeworkProgressWidget}>
            <Text style={styles.homeworkProgressValue}>{homeworkProgressPercent}%</Text>
            <View style={styles.homeworkProgressTrack}>
              <View style={[styles.homeworkProgressFill, { width: `${homeworkProgressPercent}%` }]} />
            </View>
          </View>
        </View>

        {myHomework.length === 0 ? (
          <GlassPanel>
            <Text style={[styles.emptyText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Пока нет заданий',
                en: 'No homework yet',
                he: 'עדיין אין שיעורי בית',
              })}
            </Text>
          </GlassPanel>
        ) : (
          myHomework.map((item) => {
            const studentDone = item.student_confirmed_ids.includes(user.id);
            const parentChecked = parentIds.some((parentId) => item.parent_confirmed_ids.includes(parentId));
            const updating = updatingHomeworkId === item.id;
            const lesson = lessonsById.get(item.lesson_id);
            const textOriginal = item.text_original ?? item.text;
            const localizedHomeworkText = getLocalizedText(
              textOriginal,
              ensureTranslationMap(textOriginal, item.lang_original, item.translations),
              language,
              showOriginal,
            );
            const attachments = item.attachments.map((uri) => ({
              uri,
              kind: attachmentKind(uri),
              label: attachmentFileName(uri),
            }));
            return (
              <GlassPanel key={`homework_${item.id}`} style={[styles.homeworkCard, studentDone && styles.homeworkCardDone]}>
                <View style={[styles.homeworkTitleRow, rtl && styles.rowReverse]}>
                  <Text style={[styles.homeworkTitle, rtl && styles.textRtl]}>
                    {homeworkBody(localizedHomeworkText) || localizedHomeworkText}
                  </Text>
                  {studentDone ? <Text style={styles.homeworkDoneEmoji}>✅</Text> : null}
                </View>
                <Text style={[styles.homeworkMetaText, rtl && styles.textRtl]}>
                  {lesson
                    ? localizeLessonSubject(lesson.subject, language)
                    : t(language, { ru: 'Предмет не найден', en: 'Subject not found', he: 'המקצוע לא נמצא' })}
                </Text>
                <Text style={[styles.homeworkMetaText, rtl && styles.textRtl]}>
                  {item.source === 'manual'
                    ? t(language, { ru: 'Источник: От учителя', en: 'Source: Teacher', he: 'מקור: מהמורה' })
                    : t(language, {
                        ru: 'Источник: По фото',
                        en: 'Source: Photo OCR',
                        he: 'מקור: זיהוי מתמונה',
                      })}
                </Text>
                <Text style={[styles.homeworkDates, rtl && styles.textRtl]}>
                  {t(language, {
                    ru: 'Дано',
                    en: 'Given',
                    he: 'ניתן',
                  })}
                  : {dateInputLabel(item.assigned_date)} |{' '}
                  {t(language, {
                    ru: 'Сдать до',
                    en: 'Due',
                    he: 'להגיש עד',
                  })}
                  : {dateInputLabel(item.due_date)}
                </Text>

                {attachments.length > 0 ? (
                  <View style={styles.homeworkAttachmentList}>
                    {attachments.map((attachment) =>
                      attachment.kind === 'image' ? (
                        <Image key={`${item.id}_${attachment.uri}`} source={{ uri: attachment.uri }} style={styles.homeworkAttachmentImage} />
                      ) : (
                        <View key={`${item.id}_${attachment.uri}`} style={styles.homeworkAttachmentRow}>
                          <Ionicons
                            name={attachment.kind === 'audio' ? 'mic-outline' : 'document-text-outline'}
                            size={15}
                            color="#C4B5FD"
                          />
                          <Text style={styles.homeworkAttachmentText}>{attachment.label}</Text>
                        </View>
                      ),
                    )}
                  </View>
                ) : null}

                <Pressable
                  style={({ pressed }: PressableStateCallbackType) => [
                    styles.homeworkCheckRow,
                    pressed && styles.pressedState,
                  ]}
                  disabled={updating}
                  onPress={pressWithHaptic(() => toggleHomeworkDone(item), 'light')}
                >
                  <View
                    style={[
                      styles.homeworkCheckBox,
                      studentDone ? styles.homeworkCheckBoxStudent : styles.homeworkCheckBoxIdle,
                    ]}
                  >
                    <Text style={styles.homeworkCheckMark}>{studentDone ? '✓' : ''}</Text>
                  </View>
                  <Text style={[styles.homeworkCheckText, rtl && styles.textRtl]}>
                    {updating
                      ? t(language, {
                          ru: 'Обновление...',
                          en: 'Updating...',
                          he: 'מעדכן...',
                        })
                      : t(language, {
                          ru: 'Я выполнил',
                          en: 'I did it',
                          he: 'ביצעתי',
                        })}
                  </Text>
                </Pressable>

                <View style={styles.homeworkCheckRow}>
                  <View
                    style={[
                      styles.homeworkCheckBox,
                      parentChecked ? styles.homeworkCheckBoxParent : styles.homeworkCheckBoxIdle,
                    ]}
                  >
                    <Text style={styles.homeworkCheckMark}>{parentChecked ? '✓' : ''}</Text>
                  </View>
                  <Text style={[styles.homeworkCheckText, rtl && styles.textRtl]}>
                    {t(language, {
                      ru: 'Родитель проверил',
                      en: 'Parent checked',
                      he: 'הורה בדק',
                    })}
                  </Text>
                </View>
              </GlassPanel>
            );
          })
        )}
      </ScrollView>
    );
  };

  const renderEvents = () => {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Событийный поток',
              en: 'Event flow',
              he: 'זרם אירועים',
            })}
          </Text>
        </View>

        {eventCards.length === 0 ? (
          <GlassPanel>
            <Text style={[styles.emptyText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Пока нет событий',
                en: 'No events yet',
                he: 'אין אירועים עדיין',
              })}
            </Text>
          </GlassPanel>
        ) : (
          eventCards.map((event) => (
            <GlassPanel key={event.id} style={styles.eventCard}>
              <View style={[styles.eventTopRow, rtl && styles.rowReverse]}>
                <View style={styles.eventIconWrap}>
                  <Ionicons name={event.icon} size={16} color="#F8FAFC" />
                </View>
                <Text style={[styles.eventTitle, rtl && styles.textRtl]}>{event.title}</Text>
              </View>
              <Text style={[styles.eventBody, rtl && styles.textRtl]}>{event.body}</Text>
              <Text style={[styles.eventDate, rtl && styles.textRtl]}>{event.date}</Text>
            </GlassPanel>
          ))
        )}
      </ScrollView>
    );
  };

  const renderIdeas = () => {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.sectionHeaderRow, rtl && styles.rowReverse]}>
          <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Идеи класса',
              en: 'Class ideas',
              he: 'רעיונות הכיתה',
            })}
          </Text>

          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <Pressable
              style={({ pressed }: PressableStateCallbackType) => [styles.newIdeaButton, pressed && styles.pressedState]}
              onPress={pressWithHaptic(() => setIdeaModalVisible(true), 'medium')}
            >
              <Text style={styles.newIdeaButtonText}>+ Новое</Text>
            </Pressable>
          </Animated.View>
        </View>

        {ideaFeed.length === 0 ? (
          <GlassPanel>
            <Text style={[styles.emptyText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Пока нет идей в ленте',
                en: 'No ideas yet',
                he: 'עדיין אין רעיונות',
              })}
            </Text>
          </GlassPanel>
        ) : (
          ideaFeed.map((idea, index) => {
            const status = ideaStatusView(idea.status, language);
            const author = usersById.get(idea.author_id);
            return (
              <GlassPanel key={idea.id} style={[styles.ideaCard, index > 0 && styles.ideaCardSpacing]}>
                <View style={[styles.ideaTopRow, rtl && styles.rowReverse]}>
                  <View style={styles.ideaAuthorBlock}>
                    <Text style={[styles.ideaCategoryText, rtl && styles.textRtl]}>
                      {author?.name ??
                        t(language, {
                          ru: 'Пользователь',
                          en: 'User',
                          he: 'משתמש',
                        })}
                    </Text>
                    <Text style={[styles.ideaAuthorMeta, rtl && styles.textRtl]}>
                      {author
                        ? roleNameById(author.role_id, language)
                        : t(language, {
                            ru: 'Автор',
                            en: 'Author',
                            he: 'מחבר',
                          })}
                      {idea.category ? ` · ${categoryLabel(idea.category, language)}` : ''}
                    </Text>
                  </View>
                  <View style={[styles.ideaStatusBadge, { backgroundColor: status.bg }]}>
                    <Text style={[styles.ideaStatusText, { color: status.color }]}>{status.label}</Text>
                  </View>
                </View>
                <Text style={[styles.ideaBodyText, rtl && styles.textRtl]}>
                  {getLocalizedText(
                    idea.text_original,
                    ensureTranslationMap(idea.text_original, idea.lang_original, idea.translations),
                    language,
                    showOriginal,
                  )}
                </Text>
              </GlassPanel>
            );
          })
        )}
      </ScrollView>
    );
  };

  const renderProfile = () => {
    return (
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <GlassPanel style={styles.profilePanel}>
          <Text style={[styles.profileTitle, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Контакты ученика',
              en: 'Student contacts',
              he: 'פרטי תלמיד',
            })}
          </Text>
          <Text style={[styles.profileMeta, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Телефон',
              en: 'Phone',
              he: 'טלפון',
            })}
            : {user.phone || t(language, { ru: 'Не указан', en: 'Not set', he: 'לא צוין' })}
          </Text>
          <Text style={[styles.profileMeta, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Языки',
              en: 'Languages',
              he: 'שפות',
            })}
            : {knownLanguages.map((entry) => appLanguageLabel(entry, language)).join(', ')}
          </Text>
          <Text style={[styles.profileMeta, rtl && styles.textRtl]}>{buildInfo}</Text>
          <Text style={[styles.profileMeta, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Часовой пояс',
              en: 'Time zone',
              he: 'אזור זמן',
            })}
            : {snapshot.school.timezone}
          </Text>
        </GlassPanel>

        <BirthdaySettingsCard user={user} onSave={onUpdateBirthdaySettings} />

        <View style={styles.profileActionsStack}>
          <Pressable
            style={({ pressed }: PressableStateCallbackType) => [styles.profileActionButton, pressed && styles.pressedState]}
            onPress={pressWithHaptic(onToggleOriginal, 'light')}
          >
            <Text style={[styles.profileActionText, rtl && styles.textRtl]}>
              {showOriginal
                ? t(language, {
                    ru: 'Оригинал: включен',
                    en: 'Original: ON',
                    he: 'מקור: מופעל',
                  })
                : t(language, {
                    ru: 'Оригинал: выключен',
                    en: 'Original: OFF',
                    he: 'מקור: כבוי',
                  })}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }: PressableStateCallbackType) => [styles.profileActionButton, pressed && styles.pressedState]}
            onPress={pressWithHaptic(onRefresh, 'light')}
          >
            <Text style={[styles.profileActionText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Обновить',
                en: 'Refresh',
                he: 'רענון',
              })}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }: PressableStateCallbackType) => [styles.profileActionButton, pressed && styles.pressedState]}
            onPress={pressWithHaptic(pickPhoto, 'light')}
          >
            <Text style={[styles.profileActionText, rtl && styles.textRtl]}>
              {uploadingPhoto
                ? t(language, {
                    ru: 'Загрузка фото...',
                    en: 'Uploading photo...',
                    he: 'מעלה תמונה...',
                  })
                : t(language, {
                    ru: 'Сменить фото',
                    en: 'Change photo',
                    he: 'שנה תמונה',
                  })}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }: PressableStateCallbackType) => [
              styles.profileActionButton,
              styles.profileLogoutButton,
              pressed && styles.pressedState,
            ]}
            onPress={pressWithHaptic(onLogout, 'medium')}
          >
            <Text style={[styles.profileLogoutText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Выйти',
                en: 'Logout',
                he: 'יציאה',
              })}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  };

  return (
    <View style={[styles.root, rtl && styles.rootRtl]}>
      <LinearGradient colors={['#EC4899', '#8B5CF6']} style={styles.header}>
        <View style={[styles.headerRow, rtl && styles.rowReverse]}>
          <Pressable
            style={({ pressed }: PressableStateCallbackType) => [styles.avatarPressable, pressed && styles.pressedState]}
            onPress={pressWithHaptic(() => setAvatarModalVisible(true), 'medium')}
          >
            <LinearGradient colors={['#F472B6', '#A78BFA']} style={styles.avatarGradient}>
              {user.photo_uri ? (
                <Image source={{ uri: user.photo_uri }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarFallbackText}>{initials}</Text>
                </View>
              )}
            </LinearGradient>
          </Pressable>

          <View style={styles.headerInfo}>
            <Text style={[styles.userName, rtl && styles.textRtl]}>{user.name}</Text>
            <LinearGradient colors={['#EC4899', '#8B5CF6']} style={styles.classBadgeGradient}>
              <View style={styles.classBadgeInner}>
                <Text style={[styles.classBadgeText, rtl && styles.textRtl]}>{classLabel}</Text>
              </View>
            </LinearGradient>
          </View>
        </View>
      </LinearGradient>

      <Animated.View
        style={[
          styles.contentWrapper,
          {
            opacity: contentOpacity,
            transform: [{ translateY: contentTranslateY }],
          },
        ]}
      >
        {mainTab === 'home' ? renderHome() : null}
        {mainTab === 'events' ? renderEvents() : null}
        {mainTab === 'ideas' ? renderIdeas() : null}
        {mainTab === 'profile' ? renderProfile() : null}
      </Animated.View>

      <View style={[styles.bottomBar, rtl && styles.rowReverse]}>
        {MAIN_TABS.map((entry) => {
          const active = mainTab === entry.key;
          return (
            <Pressable
              key={entry.key}
              style={({ pressed }: PressableStateCallbackType) => [styles.bottomItem, pressed && styles.pressedState]}
              onPress={pressWithHaptic(() => {
                setMainTab(entry.key);
                if (entry.key === 'events') {
                  announcementOnly.forEach((thread) => {
                    void onMarkRead(thread.id);
                  });
                }
              })}
            >
              {active ? (
                <LinearGradient colors={['#EC4899', '#8B5CF6']} style={styles.bottomIconActiveWrap}>
                  <Ionicons name={entry.icon} size={20} color="#FFFFFF" />
                </LinearGradient>
              ) : (
                <View style={styles.bottomIconWrap}>
                  <Ionicons name={entry.icon} size={20} color="#94A3B8" />
                </View>
              )}
              <Text style={[styles.bottomLabel, active && styles.bottomLabelActive]}>
                {studentTabLabel(entry.key, language)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Modal visible={calendarVisible} animationType="slide" onRequestClose={() => setCalendarVisible(false)}>
        <View style={[styles.modalRoot, rtl && styles.rootRtl]}>
          <View style={[styles.modalHeaderRow, rtl && styles.rowReverse]}>
            <Pressable
              style={({ pressed }: PressableStateCallbackType) => [styles.modalBackButton, pressed && styles.pressedState]}
              onPress={pressWithHaptic(() => setCalendarVisible(false), 'medium')}
            >
              <Ionicons name="arrow-back" size={18} color="#F8FAFC" />
              <Text style={styles.modalBackText}>
                {t(language, {
                  ru: 'Назад',
                  en: 'Back',
                  he: 'חזרה',
                })}
              </Text>
            </Pressable>
          </View>

          <Text style={[styles.modalRangeTitle, rtl && styles.textRtl]}>{rangeLabel(selectedDateKey, language)}</Text>

          <ScrollView contentContainerStyle={styles.calendarScrollContent}>
            {fullCalendarWeeks.map((week, weekIndex) => (
              <GlassPanel key={`${week[0]}_${weekIndex}`} style={styles.calendarWeekCard}>
                <View style={styles.calendarWeekRow}>
                  {week.map((dayKey) => {
                    const active = dayKey === selectedDateKey;
                    const hasBirthday = birthdayDateMarkers.has(dayKey);
                    return (
                      <Pressable
                        key={dayKey}
                        style={({ pressed }: PressableStateCallbackType) => [
                          styles.calendarDay,
                          active && styles.calendarDayActive,
                          pressed && styles.pressedState,
                        ]}
                        onPress={pressWithHaptic(() => {
                          setSelectedDateKey(dayKey);
                          setCalendarVisible(false);
                        })}
                      >
                        <Text style={[styles.calendarDayWeek, active && styles.calendarDayWeekActive]}>
                          {shortWeekLabel(dayKey, language)}
                        </Text>
                        <Text style={[styles.calendarDayDate, active && styles.calendarDayDateActive]}>
                          {dayMonthLabel(dayKey, language)}
                        </Text>
                        {hasBirthday ? (
                          <View style={[styles.birthdayMarkerDot, active && styles.birthdayMarkerDotActive]} />
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              </GlassPanel>
            ))}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={ideaModalVisible} animationType="slide" onRequestClose={() => setIdeaModalVisible(false)}>
        <View style={[styles.modalRoot, rtl && styles.rootRtl]}>
          <View style={[styles.modalHeaderRow, rtl && styles.rowReverse]}>
            <Pressable
              style={({ pressed }: PressableStateCallbackType) => [styles.modalBackButton, pressed && styles.pressedState]}
              onPress={pressWithHaptic(() => setIdeaModalVisible(false), 'medium')}
            >
              <Ionicons name="arrow-back" size={18} color="#F8FAFC" />
              <Text style={styles.modalBackText}>
                {t(language, {
                  ru: 'Назад',
                  en: 'Back',
                  he: 'חזרה',
                })}
              </Text>
            </Pressable>
          </View>

          <View style={styles.ideaComposerBody}>
            <Text style={[styles.ideaComposerTitle, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Идеи для школы',
                en: 'Ideas for school',
                he: 'רעיונות לבית הספר',
              })}
            </Text>

            <TextInput
              style={[styles.ideaInput, rtl && styles.textRtl]}
              value={ideaText}
              onChangeText={setIdeaText}
              placeholder={t(language, {
                ru: 'Что предложишь? (например: пуфики в коридор)',
                en: 'What do you suggest? (example: beanbags in hallway)',
                he: 'מה תציע? (למשל: פופים במסדרון)',
              })}
              placeholderTextColor="#94A3B8"
              multiline
              textAlignVertical="top"
            />

            <View style={styles.ideaComposerActions}>
              <Pressable
                style={({ pressed }: PressableStateCallbackType) => [styles.cancelButton, pressed && styles.pressedState]}
                onPress={pressWithHaptic(() => setIdeaModalVisible(false), 'medium')}
              >
                <Text style={styles.cancelButtonText}>
                  {t(language, {
                    ru: 'Отменить',
                    en: 'Cancel',
                    he: 'ביטול',
                  })}
                </Text>
              </Pressable>

              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <Pressable
                  style={({ pressed }: PressableStateCallbackType) => [
                    styles.submitIdeaButton,
                    pressed && styles.pressedState,
                    submittingIdea && styles.submitIdeaButtonDisabled,
                  ]}
                  disabled={submittingIdea}
                  onPress={pressWithHaptic(submitIdea, 'success')}
                >
                  <Text style={styles.submitIdeaButtonText}>+ Новое</Text>
                </Pressable>
              </Animated.View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={birthdayGreetingVisible}
        transparent
        animationType="slide"
        onRequestClose={closeBirthdayGreetingModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.birthdayModalBackdrop}
          keyboardVerticalOffset={18}
        >
          <View style={styles.birthdaySheetModal}>
            <View style={[styles.birthdayModalHeader, rtl && styles.rowReverse]}>
              <Text style={[styles.birthdayModalTitle, rtl && styles.textRtl]}>
                {t(language, { ru: 'Поздравление', en: 'Greeting', he: 'ברכה' })}
              </Text>
              <Pressable onPress={pressWithHaptic(closeBirthdayGreetingModal, 'light')}>
                <Ionicons name="close" size={24} color="#F8FAFC" />
              </Pressable>
            </View>

            {birthdayGreetingTarget ? (
              <>
                <Text style={[styles.birthdayModalHint, rtl && styles.textRtl]}>
                  {t(language, {
                    ru: `Кому: ${birthdayGreetingTarget.name}`,
                    en: `To: ${birthdayGreetingTarget.name}`,
                    he: `אל: ${birthdayGreetingTarget.name}`,
                  })}
                </Text>
                <TextInput
                  value={birthdayGreetingDraft}
                  onChangeText={setBirthdayGreetingDraft}
                  placeholder={birthdaySuggestedGreeting(birthdayGreetingTarget)}
                  placeholderTextColor="#94A3B8"
                  style={[styles.birthdayModalInput, rtl && styles.textRtl]}
                  multiline
                  textAlignVertical="top"
                />
                <Pressable
                  style={[
                    styles.birthdayModalSubmitButton,
                    Boolean(birthdaySendingId) && styles.birthdayModalSubmitButtonDisabled,
                  ]}
                  disabled={Boolean(birthdaySendingId)}
                  onPress={pressWithHaptic(submitBirthdayGreeting, 'selection')}
                >
                  <Text style={styles.birthdayModalSubmitText}>
                    {birthdaySendingId === birthdayGreetingTarget.id
                      ? t(language, { ru: 'Отправка...', en: 'Sending...', he: 'שולח...' })
                      : birthdayCongratulatedIds.includes(birthdayGreetingTarget.id)
                        ? t(language, { ru: 'Сохранить', en: 'Save', he: 'שמור' })
                        : t(language, { ru: 'Поздравить', en: 'Congratulate', he: 'ברך' })}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={homeworkCelebrationVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setHomeworkCelebrationVisible(false)}
      >
        <View style={styles.homeworkCelebrationBackdrop}>
          <View style={styles.homeworkCelebrationCard}>
            <Text style={styles.homeworkCelebrationEmoji}>🎆</Text>
            <Text style={styles.homeworkCelebrationTitle}>
              {t(language, {
                ru: 'Поздравляем! 100%',
                en: 'Congrats! 100%',
                he: 'כל הכבוד! 100%',
              })}
            </Text>
          </View>
        </View>
      </Modal>

      <Modal visible={avatarModalVisible} transparent animationType="fade" onRequestClose={() => setAvatarModalVisible(false)}>
        <View style={styles.avatarModalBackdrop}>
          <View style={styles.avatarModalCard}>
            {user.photo_uri ? (
              <Image source={{ uri: user.photo_uri }} style={styles.avatarModalImage} />
            ) : (
              <View style={styles.avatarModalFallback}>
                <Text style={styles.avatarModalFallbackText}>{initials}</Text>
              </View>
            )}

            <View style={styles.avatarModalActions}>
              <Pressable
                style={({ pressed }: PressableStateCallbackType) => [styles.avatarModalButton, pressed && styles.pressedState]}
                onPress={pressWithHaptic(pickPhoto, 'medium')}
              >
                <Text style={styles.avatarModalButtonText}>
                  {t(language, {
                    ru: 'Сменить фото',
                    en: 'Change photo',
                    he: 'שנה תמונה',
                  })}
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }: PressableStateCallbackType) => [styles.avatarModalButton, styles.avatarModalCloseButton, pressed && styles.pressedState]}
                onPress={pressWithHaptic(() => setAvatarModalVisible(false), 'light')}
              >
                <Text style={styles.avatarModalButtonText}>
                  {t(language, {
                    ru: 'Закрыть',
                    en: 'Close',
                    he: 'סגור',
                  })}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function GlassPanel({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <BlurView intensity={26} tint="dark" style={[styles.glassPanel, style]}>
      {children}
    </BlurView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  rootRtl: {
    direction: 'rtl',
  },
  contentWrapper: {
    flex: 1,
  },
  header: {
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  avatarPressable: {
    borderRadius: 999,
  },
  avatarGradient: {
    width: 78,
    height: 78,
    borderRadius: 39,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#F472B6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 16,
    elevation: 6,
  },
  avatarImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  avatarFallback: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: '#F8FAFC',
    fontSize: 26,
    fontWeight: '800',
  },
  headerInfo: {
    flex: 1,
  },
  userName: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
  },
  classBadgeGradient: {
    marginTop: 8,
    borderRadius: 999,
    alignSelf: 'flex-start',
    padding: 1,
  },
  classBadgeInner: {
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  classBadgeText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 110,
    gap: 10,
  },
  glassPanel: {
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
    overflow: 'hidden',
    padding: 12,
  },
  rangePanel: {
    marginTop: 2,
  },
  rangeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  rangeText: {
    color: '#E2E8F0',
    fontWeight: '700',
    fontSize: 13,
  },
  calendarIconButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  daysRibbon: {
    gap: 8,
    paddingRight: 8,
  },
  dayChip: {
    minWidth: 66,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.45)',
    backgroundColor: 'rgba(15, 23, 42, 0.64)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: 'center',
  },
  dayChipActive: {
    borderColor: '#F472B6',
    backgroundColor: 'rgba(236, 72, 153, 0.18)',
  },
  dayChipWeekText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  dayChipWeekTextActive: {
    color: '#F8FAFC',
  },
  dayChipDateText: {
    color: '#CBD5E1',
    marginTop: 2,
    fontSize: 12,
    fontWeight: '700',
  },
  dayChipDateTextActive: {
    color: '#FFFFFF',
  },
  birthdayMarkerDot: {
    marginTop: 6,
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: '#EC4899',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 6,
    elevation: 5,
  },
  birthdayMarkerDotActive: {
    backgroundColor: '#F9A8D4',
  },
  sectionHeaderRow: {
    marginTop: 6,
    marginBottom: 2,
  },
  homeworkHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sectionTitle: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: '800',
  },
  birthdaySection: {
    gap: 8,
    borderColor: 'rgba(244, 114, 182, 0.5)',
  },
  birthdaySectionTitle: {
    color: '#FBCFE8',
    fontSize: 17,
    fontWeight: '800',
  },
  birthdayCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.36)',
    backgroundColor: 'rgba(15, 23, 42, 0.48)',
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  birthdayIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  birthdayAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  birthdayAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(244, 114, 182, 0.6)',
    backgroundColor: 'rgba(236, 72, 153, 0.15)',
  },
  birthdayName: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  birthdayRole: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '600',
  },
  birthdayGreetButton: {
    borderRadius: 999,
    backgroundColor: '#EC4899',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  birthdayGreetButtonDone: {
    backgroundColor: '#8B5CF6',
  },
  birthdayGreetButtonDisabled: {
    opacity: 0.55,
  },
  birthdayGreetText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  birthdaySentPreview: {
    marginTop: 2,
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
    maxWidth: 190,
  },
  lessonCardWrap: {
    borderRadius: 22,
  },
  lessonCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  lessonNumberWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lessonNumberText: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '900',
    lineHeight: 33,
  },
  lessonBody: {
    flex: 1,
  },
  lessonSubject: {
    color: '#F8FAFC',
    fontWeight: '800',
    fontSize: 16,
  },
  lessonMeta: {
    marginTop: 2,
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '500',
  },
  oldTimeRow: {
    alignSelf: 'flex-start',
    marginTop: 6,
    position: 'relative',
  },
  oldTimeText: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: '600',
  },
  oldTimeStrike: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 8,
    borderTopWidth: 1,
    borderTopColor: '#FB7185',
    shadowColor: '#FB7185',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 3,
  },
  lessonReason: {
    marginTop: 4,
    color: '#A5B4FC',
    fontSize: 11,
    fontWeight: '500',
  },
  lessonDigitalTime: {
    minWidth: 58,
    textAlign: 'right',
    color: '#F8FAFC',
    fontFamily: CLOCK_FONT,
    fontWeight: '700',
    fontSize: 12,
    lineHeight: 17,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
  homeworkProgressWidget: {
    minWidth: 82,
    alignItems: 'flex-end',
    gap: 4,
  },
  homeworkProgressValue: {
    color: '#C4B5FD',
    fontSize: 13,
    fontWeight: '800',
  },
  homeworkProgressTrack: {
    width: 82,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(148, 163, 184, 0.35)',
    overflow: 'hidden',
  },
  homeworkProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#22C55E',
  },
  homeworkCard: {
    gap: 8,
  },
  homeworkCardDone: {
    opacity: 0.72,
  },
  homeworkTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  homeworkTitle: {
    flex: 1,
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
  },
  homeworkDoneEmoji: {
    fontSize: 18,
  },
  homeworkMetaText: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '500',
  },
  homeworkDates: {
    color: '#C4B5FD',
    fontSize: 12,
    fontWeight: '700',
  },
  homeworkAttachmentList: {
    gap: 8,
  },
  homeworkAttachmentImage: {
    width: '100%',
    height: 150,
    borderRadius: 12,
  },
  homeworkAttachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
    backgroundColor: 'rgba(15, 23, 42, 0.34)',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  homeworkAttachmentText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  homeworkCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  homeworkCheckBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeworkCheckBoxIdle: {
    borderColor: 'rgba(148, 163, 184, 0.7)',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  homeworkCheckBoxStudent: {
    borderColor: '#7C3AED',
    backgroundColor: '#7C3AED',
  },
  homeworkCheckBoxParent: {
    borderColor: '#16A34A',
    backgroundColor: '#16A34A',
  },
  homeworkCheckMark: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 13,
  },
  homeworkCheckText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
  },
  ideaBannerWrap: {
    borderRadius: 20,
    marginTop: 4,
  },
  ideaBanner: {
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ideaBannerText: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  eventCard: {
    gap: 6,
  },
  eventTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: 'rgba(236, 72, 153, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  eventBody: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '500',
  },
  eventDate: {
    color: '#94A3B8',
    fontSize: 11,
  },
  newIdeaButton: {
    borderRadius: 999,
    backgroundColor: '#22C55E',
    paddingHorizontal: 14,
    paddingVertical: 7,
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.85,
    shadowRadius: 12,
    elevation: 6,
  },
  newIdeaButtonText: {
    color: '#082F1A',
    fontWeight: '900',
    fontSize: 13,
  },
  ideaCard: {
    gap: 8,
  },
  ideaCardSpacing: {
    marginTop: 8,
  },
  ideaTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  ideaAuthorBlock: {
    flex: 1,
    gap: 2,
  },
  ideaCategoryText: {
    color: '#CBD5E1',
    fontWeight: '700',
    fontSize: 12,
  },
  ideaAuthorMeta: {
    color: '#94A3B8',
    fontWeight: '500',
    fontSize: 11,
  },
  ideaStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  ideaStatusText: {
    fontSize: 11,
    fontWeight: '800',
  },
  ideaBodyText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '500',
  },
  profilePanel: {
    gap: 6,
  },
  profileTitle: {
    color: '#F8FAFC',
    fontWeight: '800',
    fontSize: 20,
  },
  profileMeta: {
    color: '#CBD5E1',
    fontSize: 12,
    fontWeight: '500',
  },
  profileActionsStack: {
    gap: 8,
  },
  profileActionButton: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.45)',
    backgroundColor: 'rgba(30, 41, 59, 0.75)',
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  profileActionText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 13,
  },
  profileLogoutButton: {
    borderColor: 'rgba(248, 113, 113, 0.52)',
    backgroundColor: 'rgba(127, 29, 29, 0.42)',
  },
  profileLogoutText: {
    color: '#FECACA',
    fontWeight: '800',
    fontSize: 13,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 163, 184, 0.28)',
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    paddingTop: 8,
    paddingBottom: 16,
    paddingHorizontal: 8,
  },
  bottomItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  bottomIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomIconActiveWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EC4899',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 10,
    elevation: 6,
  },
  bottomLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  bottomLabelActive: {
    color: '#F8FAFC',
    fontWeight: '800',
  },
  modalRoot: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  modalHeaderRow: {
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.48)',
    backgroundColor: 'rgba(30, 41, 59, 0.8)',
  },
  modalBackText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 13,
  },
  modalRangeTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  calendarScrollContent: {
    paddingHorizontal: 14,
    paddingBottom: 40,
    gap: 8,
  },
  calendarWeekCard: {
    padding: 8,
  },
  calendarWeekRow: {
    flexDirection: 'row',
    gap: 6,
  },
  calendarDay: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.45)',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    alignItems: 'center',
    paddingVertical: 7,
  },
  calendarDayActive: {
    borderColor: '#EC4899',
    backgroundColor: 'rgba(236, 72, 153, 0.2)',
  },
  calendarDayWeek: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '700',
  },
  calendarDayWeekActive: {
    color: '#FFFFFF',
  },
  calendarDayDate: {
    marginTop: 2,
    color: '#CBD5E1',
    fontSize: 11,
    fontWeight: '700',
  },
  calendarDayDateActive: {
    color: '#FFFFFF',
  },
  ideaComposerBody: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    flex: 1,
  },
  ideaComposerTitle: {
    color: '#F8FAFC',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
  },
  ideaInput: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.52)',
    backgroundColor: 'rgba(30, 41, 59, 0.78)',
    color: '#F8FAFC',
    minHeight: 160,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
  },
  ideaComposerActions: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cancelButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.48)',
    backgroundColor: 'rgba(30, 41, 59, 0.78)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  cancelButtonText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '700',
  },
  submitIdeaButton: {
    borderRadius: 14,
    backgroundColor: '#22C55E',
    paddingHorizontal: 18,
    paddingVertical: 11,
    shadowColor: '#22C55E',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.82,
    shadowRadius: 12,
    elevation: 6,
  },
  submitIdeaButtonDisabled: {
    opacity: 0.72,
  },
  submitIdeaButtonText: {
    color: '#052E16',
    fontWeight: '900',
    fontSize: 14,
  },
  birthdayModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.7)',
    justifyContent: 'flex-end',
  },
  birthdaySheetModal: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.38)',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 18,
    gap: 8,
  },
  birthdayModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  birthdayModalTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '800',
  },
  birthdayModalHint: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  birthdayModalInput: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.45)',
    backgroundColor: 'rgba(30, 41, 59, 0.82)',
    color: '#F8FAFC',
    minHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  birthdayModalSubmitButton: {
    borderRadius: 14,
    backgroundColor: '#EC4899',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthdayModalSubmitButtonDisabled: {
    opacity: 0.7,
  },
  birthdayModalSubmitText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  homeworkCelebrationBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.56)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  homeworkCelebrationCard: {
    minWidth: 220,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.4)',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    gap: 8,
  },
  homeworkCelebrationEmoji: {
    fontSize: 42,
  },
  homeworkCelebrationTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
  },
  avatarModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  avatarModalCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.42)',
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
  },
  avatarModalImage: {
    width: '100%',
    height: 300,
    borderRadius: 18,
  },
  avatarModalFallback: {
    width: '100%',
    height: 300,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
  },
  avatarModalFallbackText: {
    color: '#F8FAFC',
    fontSize: 72,
    fontWeight: '900',
  },
  avatarModalActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  avatarModalButton: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.45)',
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  avatarModalCloseButton: {
    backgroundColor: 'rgba(71, 85, 105, 0.68)',
  },
  avatarModalButtonText: {
    color: '#F8FAFC',
    fontWeight: '700',
    fontSize: 13,
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  pressedState: {
    opacity: 0.84,
  },
});
