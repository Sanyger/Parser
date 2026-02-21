import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ThreadChat } from '../components/ThreadChat';
import { BirthdaySettingsCard } from '../components/BirthdaySettingsCard';
import { isRtlLanguage, localeByLanguage } from '../lib/i18n';
import {
  announcementThreads,
  birthdayDateKeysForUser,
  birthdaysForDateForUser,
  threadTitle,
} from '../lib/selectors';
import { formatDate, formatTime, fromJerusalemDateTime, getDayIndexInJerusalem, toJerusalemDateInput } from '../lib/time';
import { ensureTranslationMap, getLocalizedText } from '../lib/translation';
import { DatabaseSnapshot, Feedback, FeedbackCategory, Thread, User } from '../types/models';

type StaffTab = 'home' | 'schedule' | 'proposals' | 'messages' | 'profile';
type ProposalFormCategory = 'repair' | 'equipment' | 'safety';

type ShiftValue = {
  start: string;
  end: string;
};

const NAV_ITEMS: Array<{ key: StaffTab; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'home', label: 'Главная', icon: 'home-outline' },
  { key: 'schedule', label: 'График', icon: 'calendar-outline' },
  { key: 'proposals', label: 'Предложения', icon: 'document-text-outline' },
  { key: 'messages', label: 'Сообщения', icon: 'chatbubble-ellipses-outline' },
  { key: 'profile', label: 'Профиль', icon: 'person-outline' },
];

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

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
  return Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(dateKey), index));
}

function formatHeaderDate(date: Date, locale: string): string {
  const formatted = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function dayName(dateKey: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: 'Asia/Jerusalem',
  })
    .format(new Date(jerusalemNoonIso(dateKey)))
    .replace('.', '')
    .toUpperCase();
}

function dayMonth(dateKey: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Jerusalem',
  }).format(new Date(jerusalemNoonIso(dateKey)));
}

function toFeedbackCategory(category: ProposalFormCategory): FeedbackCategory {
  if (category === 'equipment') {
    return 'equipment';
  }
  if (category === 'safety') {
    return 'gym';
  }
  return 'furniture';
}

function formCategoryLabel(category: ProposalFormCategory): string {
  if (category === 'repair') {
    return 'Ремонт';
  }
  if (category === 'equipment') {
    return 'Оборудование';
  }
  return 'Безопасность';
}

function feedbackCategoryLabel(category: FeedbackCategory | undefined): string {
  if (category === 'equipment') {
    return 'Оборудование';
  }
  if (category === 'gym' || category === 'canteen') {
    return 'Безопасность';
  }
  return 'Ремонт';
}

function feedbackStatusView(status: Feedback['status']): { label: string; bg: string; text: string } {
  if (status === 'new') {
    return {
      label: 'Рассматривается',
      bg: 'rgba(251, 146, 60, 0.2)',
      text: '#9A3412',
    };
  }
  return {
    label: 'Принято',
    bg: 'rgba(74, 222, 128, 0.2)',
    text: '#166534',
  };
}

function parseProposalTitle(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return 'Без текста';
  }
  return lines[0];
}

function defaultShiftsForWeek(weekStart: string): Record<string, ShiftValue> {
  const result: Record<string, ShiftValue> = {};
  for (let index = 0; index < 7; index += 1) {
    const dateKey = addDays(weekStart, index);
    const dayIndex = getDayIndexInJerusalem(jerusalemNoonIso(dateKey));
    if (dayIndex >= 1 && dayIndex <= 5) {
      result[dateKey] = { start: '08:00', end: '20:00' };
    }
  }
  return result;
}

function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (words.length === 0) {
    return '?';
  }
  return words.map((word) => word.charAt(0).toUpperCase()).join('');
}

export function StaffScreen({
  user,
  snapshot,
  showOriginal,
  onToggleOriginal,
  onRefresh,
  onLogout,
  onMarkRead,
  onSendMessage,
  onCreateFeedback,
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
  onSendMessage: (params: { threadId: string; text: string; attachments: string[] }) => Promise<void>;
  onCreateFeedback: (params: { text: string; category: FeedbackCategory }) => Promise<void>;
  onUpdateBirthdaySettings: (params: { dob: string; showInCalendar: boolean }) => Promise<void>;
  onSendDirectMessage: (params: {
    targetUserId: string;
    text: string;
    attachments: string[];
  }) => Promise<void>;
}) {
  const language = user.preferred_language;
  const rtl = isRtlLanguage(language);
  const locale = localeByLanguage(language);
  const todayDateKey = toJerusalemDateInput(new Date().toISOString());

  const [tab, setTab] = useState<StaffTab>('home');
  const [position, setPosition] = useState('');
  const [positionDraft, setPositionDraft] = useState('');

  const [weekStartDateKey, setWeekStartDateKey] = useState(() => startOfWeek(todayDateKey));
  const [shiftByDate, setShiftByDate] = useState<Record<string, ShiftValue>>(() =>
    defaultShiftsForWeek(startOfWeek(todayDateKey)),
  );
  const [selectedDateKey, setSelectedDateKey] = useState(todayDateKey);
  const [editorVisible, setEditorVisible] = useState(false);
  const [shiftStartDraft, setShiftStartDraft] = useState('08:00');
  const [shiftEndDraft, setShiftEndDraft] = useState('20:00');
  const [birthdaySendingId, setBirthdaySendingId] = useState<string | null>(null);
  const [birthdayGreetingVisible, setBirthdayGreetingVisible] = useState(false);
  const [birthdayGreetingTarget, setBirthdayGreetingTarget] = useState<User | null>(null);
  const [birthdayGreetingDraft, setBirthdayGreetingDraft] = useState('');
  const [birthdayGreetingByUserId, setBirthdayGreetingByUserId] = useState<Record<string, string>>({});
  const [birthdayCongratulatedIds, setBirthdayCongratulatedIds] = useState<string[]>([]);

  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const [createProposalVisible, setCreateProposalVisible] = useState(false);
  const [proposalTextDraft, setProposalTextDraft] = useState('');
  const [proposalCategoryDraft, setProposalCategoryDraft] = useState<ProposalFormCategory>('repair');
  const [submittingProposal, setSubmittingProposal] = useState(false);

  const daysInWeek = useMemo(() => weekDays(weekStartDateKey), [weekStartDateKey]);

  useEffect(() => {
    if (!daysInWeek.includes(selectedDateKey)) {
      setSelectedDateKey(daysInWeek[0]);
    }
  }, [daysInWeek, selectedDateKey]);

  useEffect(() => {
    setPositionDraft(position);
  }, [position]);

  const threads = useMemo(() => announcementThreads(user, snapshot), [snapshot, user]);
  const selectedThread: Thread | undefined = threads.find((thread) => thread.id === selectedThreadId);
  const defaultThread = threads[0];

  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    }
  }, [selectedThreadId, threads]);

  const threadIds = useMemo(() => new Set(threads.map((thread) => thread.id)), [threads]);
  const adminIds = useMemo(
    () => new Set(snapshot.users.filter((entry) => entry.role_id === 1 || entry.role_id === 7).map((entry) => entry.id)),
    [snapshot.users],
  );

  const adminMessages = useMemo(
    () =>
      snapshot.messages
        .filter((message) => threadIds.has(message.thread_id) && adminIds.has(message.sender_id))
        .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    [adminIds, snapshot.messages, threadIds],
  );

  const urgentMessages = useMemo(
    () =>
      adminMessages.filter((message) => {
        const localized = getLocalizedText(
          message.text_original,
          ensureTranslationMap(message.text_original, message.lang_original, message.translations),
          language,
          showOriginal,
        );
        return /срочн|urgent|דחוף/i.test(localized);
      }),
    [adminMessages, language, showOriginal],
  );

  const unreadCount = useMemo(
    () =>
      snapshot.messages.filter(
        (message) => threadIds.has(message.thread_id) && !message.read_by.includes(user.id),
      ).length,
    [snapshot.messages, threadIds, user.id],
  );

  const ownFeedback = useMemo(
    () => snapshot.feedback.filter((entry) => entry.author_id === user.id).slice().reverse(),
    [snapshot.feedback, user.id],
  );

  const latestFeedback = ownFeedback.slice(0, 3);
  const todayShift = shiftByDate[todayDateKey];

  const selectedShift = shiftByDate[selectedDateKey] ?? null;

  const weekBirthdayMarkers = useMemo(
    () => birthdayDateKeysForUser(user, snapshot, daysInWeek[0] ?? selectedDateKey, daysInWeek[6] ?? selectedDateKey),
    [daysInWeek, selectedDateKey, snapshot, user],
  );

  const selectedDateBirthdays = useMemo(
    () => birthdaysForDateForUser(user, snapshot, selectedDateKey),
    [selectedDateKey, snapshot, user],
  );

  const openShiftEditor = (withDefaultIfEmpty: boolean) => {
    const current = shiftByDate[selectedDateKey];
    if (current) {
      setShiftStartDraft(current.start);
      setShiftEndDraft(current.end);
    } else if (withDefaultIfEmpty) {
      setShiftStartDraft('08:00');
      setShiftEndDraft('20:00');
    }
    setEditorVisible(true);
  };

  const saveShift = () => {
    if (!TIME_PATTERN.test(shiftStartDraft) || !TIME_PATTERN.test(shiftEndDraft)) {
      Alert.alert('Неверный формат', 'Введите время в формате HH:MM, например 08:00.');
      return;
    }
    if (shiftStartDraft >= shiftEndDraft) {
      Alert.alert('Проверьте время', 'Конец смены должен быть позже начала.');
      return;
    }

    setShiftByDate((prev) => ({
      ...prev,
      [selectedDateKey]: {
        start: shiftStartDraft,
        end: shiftEndDraft,
      },
    }));
    setEditorVisible(false);
  };

  const removeShift = () => {
    setShiftByDate((prev) => {
      const next = { ...prev };
      delete next[selectedDateKey];
      return next;
    });
    setEditorVisible(false);
  };

  const birthdayRoleText = (entry: User): string => {
    if (entry.role_id === 5) {
      return snapshot.classes.find((classEntry) => entry.class_ids.includes(classEntry.id))?.name ?? 'Ученик';
    }
    if (entry.role_id === 3) {
      return 'Учитель';
    }
    if (entry.role_id === 1) {
      return 'Директор';
    }
    if (entry.role_id === 6) {
      return 'Сотрудник';
    }
    if (entry.role_id === 7) {
      return 'Администратор';
    }
    return 'Пользователь';
  };

  const birthdaySuggestedGreeting = (entry: User): string => `С днём рождения, ${entry.name}! 🎉`;

  const closeBirthdayGreetingModal = () => {
    setBirthdayGreetingVisible(false);
    setBirthdayGreetingTarget(null);
    setBirthdayGreetingDraft('');
  };

  const openBirthdayGreetingModal = (entry: User) => {
    if (entry.id === user.id) {
      return;
    }
    const existing = birthdayGreetingByUserId[entry.id]?.trim();
    setBirthdayGreetingTarget(entry);
    setBirthdayGreetingDraft(existing || birthdaySuggestedGreeting(entry));
    setBirthdayGreetingVisible(true);
  };

  const submitBirthdayGreeting = async () => {
    if (!birthdayGreetingTarget || birthdayGreetingTarget.id === user.id) {
      return;
    }
    const text = birthdayGreetingDraft.trim();
    if (!text) {
      Alert.alert('Пустое сообщение', 'Введите текст поздравления.');
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
      Alert.alert('Отправлено', `Поздравление для ${birthdayGreetingTarget.name} отправлено.`);
    } catch (error) {
      Alert.alert('Ошибка', (error as Error).message);
    } finally {
      setBirthdaySendingId(null);
    }
  };

  const submitProposal = async () => {
    const text = proposalTextDraft.trim();
    if (!text) {
      Alert.alert('Пустое предложение', 'Введите текст предложения.');
      return;
    }

    setSubmittingProposal(true);
    try {
      await onCreateFeedback({
        text,
        category: toFeedbackCategory(proposalCategoryDraft),
      });
      setProposalTextDraft('');
      setProposalCategoryDraft('repair');
      setCreateProposalVisible(false);
    } catch (error) {
      Alert.alert('Ошибка', 'Не удалось отправить предложение.');
    } finally {
      setSubmittingProposal(false);
    }
  };

  const captureAndSendToThread = async (): Promise<string | null> => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Нет доступа к камере', 'Разрешите доступ к камере в настройках устройства.');
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: true,
    });

    if (result.canceled || !result.assets[0]) {
      return null;
    }

    return result.assets[0].uri;
  };

  const renderDashboard = () => (
    <>
      <View style={styles.statsRow}>
        <View style={styles.glassCardHalf}>
          <Text style={styles.cardLabel}>Смена</Text>
          <Text style={styles.cardValue}>{todayShift ? `${todayShift.start} - ${todayShift.end}` : 'Не назначена'}</Text>
          <Text style={styles.cardHint}>Время работы сегодня</Text>
        </View>

        <View style={styles.glassCardHalf}>
          <Text style={styles.cardLabel}>Уведомления</Text>
          <Text style={styles.cardValue}>{urgentMessages.length}</Text>
          <Text style={styles.cardHint}>Срочные сообщения администрации</Text>
        </View>
      </View>

      <View style={styles.glassCard}>
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>Мои предложения</Text>
          <Pressable style={styles.inlinePillButton} onPress={() => setTab('proposals')}>
            <Text style={styles.inlinePillButtonText}>Все</Text>
          </Pressable>
        </View>

        {latestFeedback.length === 0 ? (
          <Text style={[styles.emptyText, rtl && styles.textRtl]}>Пока нет поданных предложений.</Text>
        ) : (
          latestFeedback.map((entry) => {
            const status = feedbackStatusView(entry.status);
            return (
              <View key={entry.id} style={styles.proposalPreviewRow}>
                <Text style={[styles.proposalPreviewText, rtl && styles.textRtl]} numberOfLines={2}>
                  {parseProposalTitle(
                    getLocalizedText(
                      entry.text_original,
                      ensureTranslationMap(entry.text_original, entry.lang_original, entry.translations),
                      language,
                      showOriginal,
                    ),
                  )}
                </Text>
                <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                  <Text style={[styles.statusBadgeText, { color: status.text }]}>{status.label}</Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      <View style={styles.glassCard}>
        <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>Срочные уведомления</Text>
        {urgentMessages.length === 0 ? (
          <Text style={[styles.emptyText, rtl && styles.textRtl]}>Срочных уведомлений сейчас нет.</Text>
        ) : (
          urgentMessages.slice(0, 3).map((message) => (
            <Pressable
              key={message.id}
              style={styles.noticeRow}
              onPress={() => {
                setTab('messages');
                setSelectedThreadId(message.thread_id);
                void onMarkRead(message.thread_id);
              }}
            >
              <Text style={[styles.noticeText, rtl && styles.textRtl]} numberOfLines={2}>
                {getLocalizedText(
                  message.text_original,
                  ensureTranslationMap(message.text_original, message.lang_original, message.translations),
                  language,
                  showOriginal,
                )}
              </Text>
              <Text style={[styles.noticeMeta, rtl && styles.textRtl]}>
                {formatDate(message.created_at, language)} {formatTime(message.created_at, language)}
              </Text>
            </Pressable>
          ))
        )}
      </View>
    </>
  );

  const renderSchedule = () => (
    <>
      <View style={styles.glassCard}>
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>График работы</Text>
          <View style={styles.weekSwitcherRow}>
            <Pressable
              style={styles.iconCircleButton}
              onPress={() => setWeekStartDateKey((prev) => addDays(prev, -7))}
            >
              <Ionicons name="chevron-back" size={18} color="#1D4ED8" />
            </Pressable>
            <Pressable
              style={styles.iconCircleButton}
              onPress={() => setWeekStartDateKey((prev) => addDays(prev, 7))}
            >
              <Ionicons name="chevron-forward" size={18} color="#1D4ED8" />
            </Pressable>
          </View>
        </View>

        {daysInWeek.map((dateKey) => {
          const dayShift = shiftByDate[dateKey];
          const selected = dateKey === selectedDateKey;
          const hasBirthday = weekBirthdayMarkers.has(dateKey);
          return (
            <Pressable
              key={dateKey}
              style={[styles.dayRow, selected && styles.dayRowActive]}
              onPress={() => setSelectedDateKey(dateKey)}
            >
              <View style={styles.dayRowMain}>
                <View style={styles.dayRowTitleWrap}>
                  <Text style={[styles.dayRowTitle, rtl && styles.textRtl]}>
                    {dayName(dateKey, locale)} · {dayMonth(dateKey, locale)}
                  </Text>
                  {hasBirthday ? <View style={styles.birthdayDot} /> : null}
                </View>
                <Text style={[styles.dayRowSub, rtl && styles.textRtl]}>
                  {dayShift ? `${dayShift.start} - ${dayShift.end}` : 'Смена не задана'}
                </Text>
              </View>
              <Ionicons name="time-outline" size={18} color={selected ? '#1D4ED8' : '#64748B'} />
            </Pressable>
          );
        })}
      </View>

      {selectedDateBirthdays.length > 0 ? (
        <View style={styles.glassCard}>
          <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>Сегодня праздник!</Text>
          {selectedDateBirthdays.map((entry) => (
            <View key={`staff_birthday_${entry.id}`} style={styles.birthdayCardRow}>
              <View style={styles.birthdayLeftCol}>
                {entry.photo_uri ? (
                  <Image source={{ uri: entry.photo_uri }} style={styles.birthdayAvatar} />
                ) : (
                  <View style={styles.birthdayAvatarFallback}>
                    <Ionicons name="person-outline" size={14} color="#EC4899" />
                  </View>
                )}
                <View>
                  <Text style={styles.birthdayName}>{entry.name}</Text>
                  <Text style={styles.birthdayMeta}>{birthdayRoleText(entry)}</Text>
                  {birthdayCongratulatedIds.includes(entry.id) && birthdayGreetingByUserId[entry.id] ? (
                    <Text style={styles.birthdaySentPreview} numberOfLines={1}>
                      {birthdayGreetingByUserId[entry.id]}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Pressable
                style={[
                  styles.birthdayActionButton,
                  birthdayCongratulatedIds.includes(entry.id) && styles.birthdayActionButtonDone,
                  entry.id === user.id && styles.birthdayActionButtonDisabled,
                ]}
                disabled={entry.id === user.id || birthdaySendingId === entry.id}
                onPress={() => openBirthdayGreetingModal(entry)}
              >
                <Text style={styles.birthdayActionText}>
                  {birthdaySendingId === entry.id
                    ? 'Отправка...'
                    : birthdayCongratulatedIds.includes(entry.id)
                      ? 'Вы поздравили'
                      : 'Поздравить'}
                </Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.actionButtonsRow}>
        <Pressable onPress={() => openShiftEditor(false)} style={styles.bigActionPressable}>
          <LinearGradient
            colors={editorVisible ? ['#2563EB', '#8B5CF6'] : ['#DBEAFE', '#EDE9FE']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.bigActionGradient}
          >
            <Text style={[styles.bigActionText, editorVisible && styles.bigActionTextActive]}>Редактировать график</Text>
          </LinearGradient>
        </Pressable>

        <Pressable onPress={() => openShiftEditor(true)} style={styles.bigActionPressable}>
          <LinearGradient
            colors={selectedShift ? ['#DBEAFE', '#EDE9FE'] : ['#2563EB', '#8B5CF6']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.bigActionGradient}
          >
            <Text style={[styles.bigActionText, !selectedShift && styles.bigActionTextActive]}>Добавить смену</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {editorVisible ? (
        <View style={styles.glassCard}>
          <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>
            {dayName(selectedDateKey, locale)} · {dayMonth(selectedDateKey, locale)}
          </Text>

          <View style={styles.timeInputsRow}>
            <View style={styles.timeInputWrap}>
              <Text style={styles.inputLabel}>Начало</Text>
              <TextInput
                value={shiftStartDraft}
                onChangeText={setShiftStartDraft}
                style={styles.timeInput}
                placeholder="08:00"
                placeholderTextColor="#94A3B8"
                keyboardType="numbers-and-punctuation"
              />
            </View>
            <View style={styles.timeInputWrap}>
              <Text style={styles.inputLabel}>Конец</Text>
              <TextInput
                value={shiftEndDraft}
                onChangeText={setShiftEndDraft}
                style={styles.timeInput}
                placeholder="20:00"
                placeholderTextColor="#94A3B8"
                keyboardType="numbers-and-punctuation"
              />
            </View>
          </View>

          <View style={styles.editorActionsRow}>
            <Pressable style={styles.saveButton} onPress={saveShift}>
              <Text style={styles.saveButtonText}>Сохранить</Text>
            </Pressable>
            <Pressable style={styles.cancelButton} onPress={() => setEditorVisible(false)}>
              <Text style={styles.cancelButtonText}>Отмена</Text>
            </Pressable>
            {selectedShift ? (
              <Pressable style={styles.removeButton} onPress={removeShift}>
                <Text style={styles.removeButtonText}>Удалить смену</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </>
  );

  const renderProposals = () => (
    <>
      <View style={styles.glassCard}>
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>Предложения</Text>
          <Pressable
            style={styles.addButton}
            onPress={() => setCreateProposalVisible((prev) => !prev)}
          >
            <Text style={styles.addButtonText}>+ Новое предложение</Text>
          </Pressable>
        </View>

        {createProposalVisible ? (
          <View style={styles.createWrap}>
            <TextInput
              value={proposalTextDraft}
              onChangeText={setProposalTextDraft}
              style={styles.proposalTextInput}
              multiline
              placeholder="Например: Починить замок на задней калитке"
              placeholderTextColor="#94A3B8"
            />

            <View style={styles.categoryRow}>
              {(['repair', 'equipment', 'safety'] as ProposalFormCategory[]).map((category) => (
                <Pressable
                  key={category}
                  style={[
                    styles.categoryButton,
                    proposalCategoryDraft === category && styles.categoryButtonActive,
                  ]}
                  onPress={() => setProposalCategoryDraft(category)}
                >
                  <Text
                    style={[
                      styles.categoryButtonText,
                      proposalCategoryDraft === category && styles.categoryButtonTextActive,
                    ]}
                  >
                    {formCategoryLabel(category)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={[styles.sendProposalButton, submittingProposal && styles.sendProposalButtonDisabled]}
              onPress={() => {
                void submitProposal();
              }}
              disabled={submittingProposal}
            >
              <Text style={styles.sendProposalButtonText}>
                {submittingProposal ? 'Отправка...' : 'Отправить'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {ownFeedback.length === 0 ? (
          <Text style={[styles.emptyText, rtl && styles.textRtl]}>Список пуст. Добавьте первое предложение.</Text>
        ) : (
          ownFeedback.map((entry) => {
            const status = feedbackStatusView(entry.status);
            return (
              <View key={entry.id} style={styles.proposalRow}>
                <Text style={[styles.proposalRowText, rtl && styles.textRtl]}>
                  {getLocalizedText(
                    entry.text_original,
                    ensureTranslationMap(entry.text_original, entry.lang_original, entry.translations),
                    language,
                    showOriginal,
                  )}
                </Text>
                <View style={styles.proposalRowMeta}>
                  <Text style={[styles.proposalCategoryText, rtl && styles.textRtl]}>
                    {feedbackCategoryLabel(entry.category)}
                  </Text>
                  <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: status.text }]}>{status.label}</Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>
    </>
  );

  const renderMessages = () => (
    <>
      <View style={styles.glassCard}>
        <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>Сообщения</Text>
        {threads.length === 0 ? (
          <Text style={[styles.emptyText, rtl && styles.textRtl]}>Нет доступных чатов.</Text>
        ) : (
          <View style={styles.threadTabs}>
            {threads.map((thread) => (
              <Pressable
                key={thread.id}
                style={[styles.threadButton, selectedThreadId === thread.id && styles.threadButtonActive]}
                onPress={() => {
                  setSelectedThreadId(thread.id);
                  void onMarkRead(thread.id);
                }}
              >
                <Text
                  style={[
                    styles.threadButtonText,
                    selectedThreadId === thread.id && styles.threadButtonTextActive,
                    rtl && styles.textRtl,
                  ]}
                >
                  {threadTitle(thread, snapshot, language)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>

      {selectedThread ? (
        <View style={styles.glassCard}>
          <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>{threadTitle(selectedThread, snapshot, language)}</Text>
          <ThreadChat
            thread={selectedThread}
            messages={snapshot.messages}
            users={snapshot.users}
            currentUser={user}
            userLanguage={language}
            showOriginal={showOriginal}
            allowSend
            onAttach={captureAndSendToThread}
            onSend={async (text, attachments) => {
              await onSendMessage({
                threadId: selectedThread.id,
                text,
                attachments,
              });
              await onMarkRead(selectedThread.id);
            }}
          />
        </View>
      ) : null}

      {defaultThread ? (
        <Pressable
          style={styles.inlinePillButton}
          onPress={() => {
            setSelectedThreadId(defaultThread.id);
            void onMarkRead(defaultThread.id);
          }}
        >
          <Text style={styles.inlinePillButtonText}>Открыть основной канал</Text>
        </Pressable>
      ) : null}
    </>
  );

  const renderProfile = () => (
    <>
      <View style={styles.glassCard}>
        <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>Профиль</Text>
        <Text style={[styles.profileMainName, rtl && styles.textRtl]}>{user.name}</Text>
        <Text style={[styles.profileMeta, rtl && styles.textRtl]}>Логин: {user.login}</Text>
        {user.dob ? <Text style={[styles.profileMeta, rtl && styles.textRtl]}>ДР: {user.dob.split('-').reverse().join('.')} 🎂</Text> : null}
        <Text style={[styles.profileMeta, rtl && styles.textRtl]}>
          Непрочитанные сообщения: {unreadCount}
        </Text>

        <Text style={[styles.inputLabel, rtl && styles.textRtl]}>Должность</Text>
        <TextInput
          value={positionDraft}
          onChangeText={setPositionDraft}
          style={styles.profileInput}
          placeholder="Например: Старший охранник"
          placeholderTextColor="#94A3B8"
        />

        <Pressable
          style={styles.saveButton}
          onPress={() => setPosition(positionDraft.trim())}
        >
          <Text style={styles.saveButtonText}>Сохранить должность</Text>
        </Pressable>
      </View>

      <View style={styles.glassCard}>
        <BirthdaySettingsCard user={user} onSave={onUpdateBirthdaySettings} />

        <Pressable
          style={styles.profileActionButton}
          onPress={() => {
            void onRefresh();
          }}
        >
          <Ionicons name="refresh-outline" size={18} color="#1D4ED8" />
          <Text style={styles.profileActionText}>Обновить данные</Text>
        </Pressable>

        <Pressable style={styles.profileActionButton} onPress={onToggleOriginal}>
          <Ionicons name="language-outline" size={18} color="#1D4ED8" />
          <Text style={styles.profileActionText}>
            Оригинал текста: {showOriginal ? 'включен' : 'выключен'}
          </Text>
        </Pressable>

        <Pressable style={styles.profileLogoutButton} onPress={onLogout}>
          <Ionicons name="log-out-outline" size={18} color="#7F1D1D" />
          <Text style={styles.profileLogoutText}>Выйти</Text>
        </Pressable>
      </View>
    </>
  );

  const renderContent = () => {
    if (tab === 'home') {
      return renderDashboard();
    }
    if (tab === 'schedule') {
      return renderSchedule();
    }
    if (tab === 'proposals') {
      return renderProposals();
    }
    if (tab === 'messages') {
      return renderMessages();
    }
    return renderProfile();
  };

  return (
    <View style={[styles.root, rtl && styles.rootRtl]}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <LinearGradient
          colors={['#1D4ED8', '#7C3AED']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.header}
        >
          <Text style={[styles.headerDate, rtl && styles.textRtl]}>{formatHeaderDate(new Date(), locale)}</Text>

          <View style={[styles.headerMainRow, rtl && styles.rowReverse]}>
            <LinearGradient
              colors={['#60A5FA', '#A78BFA']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatarRing}
            >
              {user.photo_uri ? (
                <Image source={{ uri: user.photo_uri }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarFallbackText}>{initials(user.name)}</Text>
                </View>
              )}
            </LinearGradient>

            <View style={styles.headerInfo}>
              <Text style={[styles.headerName, rtl && styles.textRtl]}>{user.name}</Text>
              <Text style={[styles.headerRole, rtl && styles.textRtl]}>
                Должность: {position || '______'}
              </Text>
            </View>
          </View>
        </LinearGradient>

        {renderContent()}
      </ScrollView>

      <View style={styles.bottomNavBar}>
        {NAV_ITEMS.map((item) => {
          const active = tab === item.key;
          const showUnreadDot = item.key === 'messages' && unreadCount > 0;

          return (
            <Pressable key={item.key} style={styles.bottomNavItem} onPress={() => setTab(item.key)}>
              <Ionicons name={item.icon} size={20} color={active ? '#1D4ED8' : '#64748B'} />
              {showUnreadDot ? <View style={styles.unreadDot} /> : null}
              <Text style={[styles.bottomNavLabel, active && styles.bottomNavLabelActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Modal
        visible={birthdayGreetingVisible}
        transparent
        animationType="slide"
        onRequestClose={closeBirthdayGreetingModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
          keyboardVerticalOffset={18}
        >
          <View style={styles.sheetModal}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Поздравление</Text>
              <Pressable onPress={closeBirthdayGreetingModal}>
                <Ionicons name="close" size={24} color="#0F172A" />
              </Pressable>
            </View>

            {birthdayGreetingTarget ? (
              <>
                <Text style={[styles.modalHint, rtl && styles.textRtl]}>Кому: {birthdayGreetingTarget.name}</Text>
                <TextInput
                  value={birthdayGreetingDraft}
                  onChangeText={setBirthdayGreetingDraft}
                  placeholder={birthdaySuggestedGreeting(birthdayGreetingTarget)}
                  placeholderTextColor="#94A3B8"
                  style={[styles.modalInput, rtl && styles.textRtl]}
                  multiline
                  textAlignVertical="top"
                />
                <Pressable
                  style={[styles.modalSubmitButton, Boolean(birthdaySendingId) && styles.modalSubmitButtonDisabled]}
                  disabled={Boolean(birthdaySendingId)}
                  onPress={() => {
                    void submitBirthdayGreeting();
                  }}
                >
                  <Text style={styles.modalSubmitText}>
                    {birthdaySendingId === birthdayGreetingTarget.id
                      ? 'Отправка...'
                      : birthdayCongratulatedIds.includes(birthdayGreetingTarget.id)
                        ? 'Сохранить'
                        : 'Поздравить'}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#EEF2FF',
  },
  rootRtl: {
    direction: 'rtl',
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 110,
    gap: 12,
  },
  header: {
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 2,
  },
  headerDate: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
  },
  headerMainRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  headerInfo: {
    flex: 1,
  },
  headerName: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
  },
  headerRole: {
    marginTop: 4,
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    fontWeight: '600',
  },
  avatarRing: {
    width: 72,
    height: 72,
    borderRadius: 24,
    padding: 3,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 21,
  },
  avatarFallback: {
    flex: 1,
    borderRadius: 21,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
  },
  glassCard: {
    borderRadius: 24,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.66)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
    gap: 10,
  },
  glassCardHalf: {
    flex: 1,
    borderRadius: 24,
    padding: 12,
    backgroundColor: 'rgba(255,255,255,0.66)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cardLabel: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  cardValue: {
    color: '#1E293B',
    fontSize: 20,
    fontWeight: '800',
    marginTop: 6,
  },
  cardHint: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 4,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    color: '#1E293B',
    fontSize: 17,
    fontWeight: '800',
  },
  inlinePillButton: {
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.25)',
    alignSelf: 'flex-start',
  },
  inlinePillButtonText: {
    color: '#1D4ED8',
    fontWeight: '700',
    fontSize: 12,
  },
  proposalPreviewRow: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 163, 184, 0.22)',
    paddingTop: 10,
    gap: 7,
  },
  proposalPreviewText: {
    color: '#0F172A',
    fontWeight: '600',
    fontSize: 14,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 24,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusBadgeText: {
    fontWeight: '700',
    fontSize: 12,
  },
  emptyText: {
    color: '#64748B',
    fontSize: 13,
  },
  noticeRow: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 163, 184, 0.22)',
    paddingTop: 10,
    gap: 4,
  },
  noticeText: {
    color: '#0F172A',
    fontWeight: '600',
    fontSize: 14,
  },
  noticeMeta: {
    color: '#64748B',
    fontSize: 12,
  },
  weekSwitcherRow: {
    flexDirection: 'row',
    gap: 8,
  },
  iconCircleButton: {
    width: 36,
    height: 36,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.22)',
  },
  dayRow: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.24)',
    backgroundColor: 'rgba(255,255,255,0.65)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayRowActive: {
    borderColor: 'rgba(37, 99, 235, 0.45)',
    backgroundColor: 'rgba(219, 234, 254, 0.8)',
  },
  dayRowMain: {
    flex: 1,
    gap: 2,
  },
  dayRowTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dayRowTitle: {
    color: '#1E293B',
    fontWeight: '700',
    fontSize: 14,
  },
  birthdayDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: '#EC4899',
  },
  dayRowSub: {
    color: '#64748B',
    fontSize: 13,
  },
  birthdayCardRow: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(236, 72, 153, 0.24)',
    backgroundColor: '#FFF7FB',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  birthdayLeftCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  birthdayAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  birthdayAvatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FBCFE8',
    backgroundColor: '#FDF2F8',
  },
  birthdayName: {
    color: '#1E293B',
    fontSize: 13,
    fontWeight: '700',
  },
  birthdayMeta: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  birthdaySentPreview: {
    marginTop: 2,
    color: '#64748B',
    fontSize: 11,
    fontWeight: '500',
    maxWidth: 180,
  },
  birthdayActionButton: {
    borderRadius: 999,
    backgroundColor: '#EC4899',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  birthdayActionButtonDone: {
    backgroundColor: '#7C3AED',
  },
  birthdayActionButtonDisabled: {
    opacity: 0.55,
  },
  birthdayActionText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '800',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  bigActionPressable: {
    flex: 1,
    borderRadius: 24,
    overflow: 'hidden',
  },
  bigActionGradient: {
    borderRadius: 24,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigActionText: {
    color: '#1E3A8A',
    fontWeight: '800',
    fontSize: 14,
    textAlign: 'center',
  },
  bigActionTextActive: {
    color: '#FFFFFF',
  },
  timeInputsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  timeInputWrap: {
    flex: 1,
    gap: 5,
  },
  inputLabel: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  timeInput: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#0F172A',
    fontWeight: '700',
  },
  editorActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  saveButton: {
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#2563EB',
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  cancelButton: {
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(100, 116, 139, 0.18)',
  },
  cancelButtonText: {
    color: '#334155',
    fontWeight: '700',
    fontSize: 13,
  },
  removeButton: {
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.16)',
  },
  removeButtonText: {
    color: '#991B1B',
    fontWeight: '700',
    fontSize: 13,
  },
  addButton: {
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(37, 99, 235, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.3)',
  },
  addButtonText: {
    color: '#1D4ED8',
    fontWeight: '700',
    fontSize: 12,
  },
  createWrap: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.24)',
    padding: 10,
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  proposalTextInput: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 96,
    textAlignVertical: 'top',
    color: '#0F172A',
  },
  categoryRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  categoryButton: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  categoryButtonActive: {
    borderColor: 'rgba(37, 99, 235, 0.45)',
    backgroundColor: 'rgba(219, 234, 254, 0.85)',
  },
  categoryButtonText: {
    color: '#475569',
    fontWeight: '700',
    fontSize: 12,
  },
  categoryButtonTextActive: {
    color: '#1D4ED8',
  },
  sendProposalButton: {
    borderRadius: 24,
    backgroundColor: '#2563EB',
    paddingVertical: 11,
    alignItems: 'center',
  },
  sendProposalButtonDisabled: {
    opacity: 0.7,
  },
  sendProposalButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  proposalRow: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(148, 163, 184, 0.22)',
    paddingTop: 10,
    gap: 8,
  },
  proposalRowText: {
    color: '#0F172A',
    fontWeight: '600',
    fontSize: 14,
  },
  proposalRowMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  proposalCategoryText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  threadTabs: {
    gap: 8,
  },
  threadButton: {
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  threadButtonActive: {
    borderColor: 'rgba(37, 99, 235, 0.45)',
    backgroundColor: 'rgba(219, 234, 254, 0.9)',
  },
  threadButtonText: {
    color: '#475569',
    fontWeight: '700',
    fontSize: 13,
  },
  threadButtonTextActive: {
    color: '#1D4ED8',
  },
  profileMainName: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 20,
  },
  profileMeta: {
    color: '#64748B',
    fontSize: 13,
  },
  profileInput: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
    backgroundColor: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#0F172A',
  },
  profileActionButton: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(37, 99, 235, 0.28)',
    backgroundColor: 'rgba(219, 234, 254, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileActionText: {
    color: '#1D4ED8',
    fontWeight: '700',
    fontSize: 13,
  },
  profileLogoutButton: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    backgroundColor: 'rgba(254, 226, 226, 0.75)',
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileLogoutText: {
    color: '#7F1D1D',
    fontWeight: '700',
    fontSize: 13,
  },
  bottomNavBar: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.25)',
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    shadowColor: '#1E293B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  bottomNavItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  bottomNavLabel: {
    marginTop: 2,
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  bottomNavLabelActive: {
    color: '#1D4ED8',
    fontWeight: '800',
  },
  unreadDot: {
    position: 'absolute',
    top: 5,
    right: 22,
    width: 8,
    height: 8,
    borderRadius: 24,
    backgroundColor: '#EF4444',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.35)',
    justifyContent: 'flex-end',
  },
  sheetModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    gap: 8,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '800',
  },
  modalHint: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  modalInput: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.35)',
    backgroundColor: 'rgba(255,255,255,0.82)',
    minHeight: 116,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#0F172A',
  },
  modalSubmitButton: {
    borderRadius: 14,
    backgroundColor: '#EC4899',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubmitButtonDisabled: {
    opacity: 0.7,
  },
  modalSubmitText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
