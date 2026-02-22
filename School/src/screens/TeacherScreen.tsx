import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  KeyboardEvent,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BirthdaySettingsCard } from '../components/BirthdaySettingsCard';
import {
  birthdayDateKeysForUser,
  birthdaysForDateForUser,
  currentLesson,
  lessonsForUser,
  todayLessons,
} from '../lib/selectors';
import { localizeLessonRoom, localizeLessonSubject, localeByLanguage, t } from '../lib/i18n';
import {
  fromJerusalemDateTime,
  getDayIndexInJerusalem,
  toJerusalemDateInput,
  toJerusalemTimeInput,
} from '../lib/time';
import { ensureTranslationMap, getLocalizedText, localizePersonName } from '../lib/translation';
import {
  DatabaseSnapshot,
  Feedback,
  FeedbackCategory,
  Homework,
  Lesson,
  LessonType,
  RoleId,
  StudentDetailsResponse,
  User,
} from '../types/models';

type TeacherTab = 'home' | 'schedule' | 'tasks' | 'classes' | 'profile';

type SuggestionCategory = 'household' | 'equipment' | 'learning' | 'other';
type SuggestionStatus = 'review' | 'progress' | 'done' | 'rejected';
type SuggestionAudience = 'all' | 'no_students' | 'director_only';

interface SuggestionItem {
  id: string;
  authorId: string;
  title: string;
  description: string;
  category: SuggestionCategory;
  status: SuggestionStatus;
  archived: boolean;
  photoUri: string | null;
  createdAt: string;
}

interface ParentMessageItem {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  childName: string | null;
  text: string;
  createdAt: string;
  isRead: boolean;
}

interface BirthdayMessageItem {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  peerUserId: string;
  peerName: string;
  text: string;
  createdAt: string;
  isIncoming: boolean;
  isRead: boolean;
}

interface LessonDraft {
  lessonId?: string;
  dateInput: string;
  dayIndex: number;
  startTime: string;
  endTime: string;
  subject: string;
  customSubject: string;
  classId: string;
  room: string;
  type: LessonType;
}

interface LessonVisualState {
  kind: 'canceled' | 'replaced';
  note: string;
}

const COLORS = {
  pageBg: '#F8FAFC',
  gradientFrom: '#6366F1',
  gradientTo: '#8B5CF6',
  cardBg: '#FFFFFF',
  textMain: '#0F172A',
  textMuted: '#64748B',
  chipBg: '#EEF2FF',
  chipBorder: '#DBE4FF',
  violet: '#8B5CF6',
  orange: '#F59E0B',
  green: '#10B981',
  red: '#EF4444',
};

const LESSON_NUMBER_COLORS = ['#8B5CF6', '#F59E0B', '#10B981'];
const CUSTOM_SUBJECT_VALUE = '__custom_subject__';
const CLASS_TASK_VALUE = '__class_task__';
const DAY_MS = 24 * 60 * 60 * 1000;
const BIRTHDAY_GREETING_PATTERN = /(дн[её]м\s+рожд|день\s+рожд|happy\s*birthday|יום\s+הולדת|🎂)/i;
const HOMEWORK_INPUT_MIN_HEIGHT = 120;
const HOMEWORK_INPUT_MAX_HEIGHT = 220;
const HOMEWORK_INPUT_SCROLL_GAP = 14;
const HOMEWORK_INPUT_ACCESSORY_ID = 'homework_input_accessory';
const HOMEWORK_BOTTOM_ACTIONS_RESERVED = 120;

const DAY_CHIPS = [
  { index: 0, label: 'Вс' },
  { index: 1, label: 'Пн' },
  { index: 2, label: 'Вт' },
  { index: 3, label: 'Ср' },
  { index: 4, label: 'Чт' },
  { index: 5, label: 'Пт' },
  { index: 6, label: 'Сб' },
] as const;

const TIME_SLOT_OPTIONS = [
  { label: '08:00 – 08:45', start: '08:00', end: '08:45' },
  { label: '08:55 – 09:40', start: '08:55', end: '09:40' },
  { label: '09:50 – 10:35', start: '09:50', end: '10:35' },
  { label: '10:45 – 11:30', start: '10:45', end: '11:30' },
  { label: '11:40 – 12:25', start: '11:40', end: '12:25' },
  { label: '12:35 – 13:20', start: '12:35', end: '13:20' },
  { label: '13:30 – 14:15', start: '13:30', end: '14:15' },
  { label: '14:25 – 15:10', start: '14:25', end: '15:10' },
] as const;

interface SchoolCalendarRange {
  id: string;
  startInput: string;
  endInput: string;
  label: string;
  icon: string;
}

const SCHOOL_CALENDAR_RANGES: SchoolCalendarRange[] = [
  { id: 'rosh_hashana_2025', startInput: '2025-09-22', endInput: '2025-09-24', label: 'Рош а-Шана', icon: '🍎' },
  { id: 'sukkot_2025', startInput: '2025-10-01', endInput: '2025-10-15', label: 'Йом Кипур / Суккот', icon: '🍂' },
  { id: 'hanukkah_2025', startInput: '2025-12-16', endInput: '2025-12-22', label: 'Ханука', icon: '🕎' },
  { id: 'purim_2026', startInput: '2026-03-03', endInput: '2026-03-04', label: 'Пурим', icon: '🎭' },
  { id: 'pesach_2026', startInput: '2026-03-24', endInput: '2026-04-08', label: 'Песах', icon: '🌸' },
  { id: 'zikaron_atzmaut_2026', startInput: '2026-04-21', endInput: '2026-04-22', label: 'Йом а-Зикарон / а-Ацмаут', icon: '🇮🇱' },
  { id: 'lag_baomer_2026', startInput: '2026-05-05', endInput: '2026-05-05', label: 'Лаг ба-Омер', icon: '🔥' },
  { id: 'shavuot_2026', startInput: '2026-05-21', endInput: '2026-05-22', label: 'Шавуот', icon: '📜' },
  { id: 'summer_mid_high_2026', startInput: '2026-06-19', endInput: '2026-06-30', label: 'Летние каникулы (средняя/старшая)', icon: '☀️' },
  { id: 'summer_primary_2026', startInput: '2026-07-01', endInput: '2026-08-31', label: 'Летние каникулы (начальная)', icon: '🌻' },
];

const NAV_ITEMS: Array<{ key: TeacherTab; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'home', icon: 'home-outline' },
  { key: 'schedule', icon: 'calendar-outline' },
  { key: 'tasks', icon: 'chatbubble-ellipses-outline' },
  { key: 'classes', icon: 'people-outline' },
  { key: 'profile', icon: 'person-outline' },
];

function tabLabel(tab: TeacherTab, language: User['preferred_language']): string {
  if (tab === 'home') {
    return t(language, { ru: 'Главная', en: 'Home', he: 'ראשי' });
  }
  if (tab === 'schedule') {
    return t(language, { ru: 'Расписание', en: 'Schedule', he: 'מערכת' });
  }
  if (tab === 'tasks') {
    return t(language, { ru: 'Сообщения', en: 'Messages', he: 'הודעות' });
  }
  if (tab === 'classes') {
    return t(language, { ru: 'Классы', en: 'Classes', he: 'כיתות' });
  }
  return t(language, { ru: 'Профиль', en: 'Profile', he: 'פרופיל' });
}

function fallbackLocalizedClassName(value: string, language: User['preferred_language']): string {
  const clean = value.trim();
  if (!clean) {
    return clean;
  }
  const classWord = t(language, { ru: 'Класс', en: 'Class', he: 'כיתה' });
  const suffix = clean.replace(/^(класс|class|כיתה)\s*/iu, '').trim();
  if (!suffix) {
    return classWord;
  }
  return `${classWord} ${suffix}`;
}

function className(
  snapshot: DatabaseSnapshot,
  classId: string,
  language?: User['preferred_language'],
): string {
  const classModel = snapshot.classes.find((entry) => entry.id === classId);
  if (!classModel) {
    return classId;
  }
  if (!language) {
    return classModel.name;
  }
  return classModel.name_i18n?.[language] ?? fallbackLocalizedClassName(classModel.name, language);
}

function parentRelationLabel(
  relation: 'mother' | 'father' | 'guardian',
  language: User['preferred_language'],
): string {
  if (relation === 'mother') {
    return t(language, { ru: 'Мама', en: 'Mother', he: 'אמא' });
  }
  if (relation === 'father') {
    return t(language, { ru: 'Папа', en: 'Father', he: 'אבא' });
  }
  return t(language, { ru: 'Опекун', en: 'Guardian', he: 'אפוטרופוס' });
}

function feedbackStatusToSuggestionStatus(status: Feedback['status']): SuggestionStatus {
  if (status === 'new') {
    return 'review';
  }
  if (status === 'reviewed' || status === 'planned') {
    return 'progress';
  }
  return 'done';
}

function suggestionStatusView(status: SuggestionStatus): { label: string; bg: string; text: string } {
  if (status === 'review') {
    return { label: 'Рассматривается', bg: '#FEF3C7', text: '#92400E' };
  }
  if (status === 'progress') {
    return { label: 'В работе', bg: '#DBEAFE', text: '#1D4ED8' };
  }
  if (status === 'done') {
    return { label: 'Выполнено', bg: '#DCFCE7', text: '#166534' };
  }
  return { label: 'Отклонено', bg: '#E2E8F0', text: '#475569' };
}

function categoryFromText(text: string): SuggestionCategory {
  const source = text.toLowerCase();
  if (source.includes('штор') || source.includes('кабинет') || source.includes('ремонт')) {
    return 'household';
  }
  if (source.includes('проектор') || source.includes('ноутбук') || source.includes('компьютер')) {
    return 'equipment';
  }
  if (source.includes('урок') || source.includes('учеб') || source.includes('программ')) {
    return 'learning';
  }
  return 'other';
}

function feedbackToSuggestion(entry: Feedback): SuggestionItem {
  const lines = entry.text_original
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const title = lines[0] ?? 'Без темы';
  const description = lines.slice(1).join(' ') || entry.text_original;
  return {
    id: entry.id,
    authorId: entry.author_id,
    title,
    description,
    category: categoryFromText(entry.text_original),
    status: feedbackStatusToSuggestionStatus(entry.status),
    archived: false,
    photoUri: null,
    createdAt: new Date().toISOString(),
  };
}

function suggestionCategoryView(category: SuggestionCategory): {
  label: string;
  color: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
} {
  if (category === 'household') {
    return { label: 'Хозяйство', color: '#F59E0B', icon: 'tools' };
  }
  if (category === 'equipment') {
    return { label: 'Оборудование', color: '#3B82F6', icon: 'projector-screen' };
  }
  if (category === 'learning') {
    return { label: 'Учебный процесс', color: '#10B981', icon: 'book-education' };
  }
  return { label: 'Другое', color: '#8B5CF6', icon: 'lightbulb-on-outline' };
}

function visibilityRolesForSuggestionAudience(audience: SuggestionAudience): RoleId[] {
  if (audience === 'director_only') {
    return [1, 7];
  }
  if (audience === 'no_students') {
    return [1, 3, 4, 6, 7];
  }
  return [1, 3, 4, 5, 6, 7];
}

function suggestionDefaultsFromFeedback(feedback: Feedback[]): SuggestionItem[] {
  const mapped = feedback.map(feedbackToSuggestion);
  if (mapped.some((entry) => entry.status === 'rejected')) {
    return mapped;
  }
  return [
    ...mapped,
    {
      id: 'suggestion_demo_rejected',
      authorId: 'system',
      title: 'Обновить освещение в спортзале',
      description: 'Запрос отклонён: включён в план капремонта следующего семестра.',
      category: 'household',
      status: 'rejected',
      archived: false,
      photoUri: null,
      createdAt: new Date().toISOString(),
    },
  ];
}

function isBirthdayGreetingText(text: string): boolean {
  return BIRTHDAY_GREETING_PATTERN.test(text.trim());
}

function emptyLessonDraft(primaryClassId: string): LessonDraft {
  const todayInput = toJerusalemDateInput(new Date().toISOString());
  const selectedDay = dayIndexFromDateInput(todayInput);
  return {
    dateInput: todayInput,
    dayIndex: selectedDay,
    startTime: '08:00',
    endTime: '08:45',
    subject: '',
    customSubject: '',
    classId: primaryClassId,
    room: 'Кабинет 1',
    type: 'lesson',
  };
}

function parseDateInput(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function isValidDateInput(value: string): boolean {
  return Boolean(parseDateInput(value));
}

function normalizeDateInput(value: string | null | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }
  return isValidDateInput(value) ? value : fallback;
}

function formatDateInput(value: Date): string {
  const year = value.getUTCFullYear();
  const month = `${value.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${value.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDaysToDateInput(dateInput: string, days: number): string {
  const base = parseDateInput(dateInput);
  if (!base) {
    return dateInput;
  }
  base.setUTCDate(base.getUTCDate() + days);
  return formatDateInput(base);
}

function dayIndexFromDateInput(value: string): number {
  const parsed = parseDateInput(value);
  if (!parsed) {
    return 0;
  }
  return parsed.getUTCDay();
}

function dateInputLabel(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return value;
  }
  return `${match[3]}.${match[2]}`;
}

function dateShortLabel(value: string, locale = 'ru-RU'): string {
  const parsed = parseDateInput(value);
  if (!parsed) {
    return dateInputLabel(value);
  }
  const formatted = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(parsed);
  return formatted.replace('.', '');
}

function hhmm(isoDate: string): string {
  const value = toJerusalemTimeInput(isoDate);
  if (!/^\d{2}:\d{2}$/.test(value)) {
    return '--:--';
  }
  return value;
}

function toDateInputFromDayMonth(dayMonth: string, fallbackYear: number): string | null {
  const match = dayMonth.match(/^(\d{2})\.(\d{2})$/);
  if (!match) {
    return null;
  }
  const day = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return null;
  }
  return `${fallbackYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fallbackIsoFromDateTimeInput(dateInput: string, timeInput: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput) || !/^\d{2}:\d{2}$/.test(timeInput)) {
    return null;
  }
  const candidate = new Date(`${dateInput}T${timeInput}:00`);
  if (Number.isNaN(candidate.getTime())) {
    return null;
  }
  return candidate.toISOString();
}

function monthCursorFromDateInput(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) {
    return toJerusalemDateInput(new Date().toISOString()).slice(0, 7);
  }
  return `${match[1]}-${match[2]}`;
}

function shiftMonthCursor(cursor: string, delta: number): string {
  const match = cursor.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return cursor;
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1, 12, 0, 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isBeforeDateInput(left: string, right: string): boolean {
  const leftDate = parseDateInput(left);
  const rightDate = parseDateInput(right);
  if (!leftDate || !rightDate) {
    return false;
  }
  return leftDate.getTime() < rightDate.getTime();
}

function buildMonthDateCells(cursor: string): string[] {
  const match = cursor.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return [];
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const firstDay = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const firstWeekDay = firstDay.getUTCDay();
  const gridStart = new Date(Date.UTC(year, month - 1, 1 - firstWeekDay, 12, 0, 0));
  const cells: string[] = [];
  for (let index = 0; index < 42; index += 1) {
    const current = new Date(gridStart.getTime() + index * DAY_MS);
    const dateInput = formatDateInput(current);
    cells.push(dateInput);
  }
  return cells;
}

function endOfMonthDateInput(cursor: string): string {
  const match = cursor.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return toJerusalemDateInput(new Date().toISOString());
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const end = new Date(Date.UTC(year, month, 0, 12, 0, 0));
  return formatDateInput(end);
}

function monthLabelFromCursor(cursor: string): string {
  const match = cursor.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return cursor;
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const date = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const value = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function monthNameFromCursor(cursor: string): string {
  const match = cursor.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return cursor;
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const date = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
  const value = new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    timeZone: 'UTC',
  }).format(date);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function yearFromCursor(cursor: string): number {
  const match = cursor.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    return new Date().getFullYear();
  }
  return Number.parseInt(match[1], 10);
}

function schoolCalendarRangeForDate(dateInput: string): SchoolCalendarRange | null {
  const found = SCHOOL_CALENDAR_RANGES.find(
    (range) => dateInput >= range.startInput && dateInput <= range.endInput,
  );
  return found ?? null;
}

async function compressLargeDataImage(dataUri: string): Promise<string> {
  if (!dataUri.startsWith('data:image/')) {
    return dataUri;
  }
  if (Platform.OS !== 'web' || dataUri.length < 450_000) {
    return dataUri;
  }

  const browserImage = (globalThis as any).Image;
  const doc = (globalThis as any).document;
  if (!browserImage || !doc?.createElement) {
    return dataUri;
  }

  return new Promise<string>((resolve) => {
    const image = new browserImage();
    image.onload = () => {
      try {
        const maxSide = 1280;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const targetWidth = Math.max(1, Math.round(image.width * scale));
        const targetHeight = Math.max(1, Math.round(image.height * scale));
        const canvas = doc.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext('2d');
        if (!context) {
          resolve(dataUri);
          return;
        }
        context.drawImage(image, 0, 0, targetWidth, targetHeight);
        canvas.toBlob(
          (blob: any) => {
            if (!blob) {
              resolve(dataUri);
              return;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
              resolve(typeof reader.result === 'string' ? reader.result : dataUri);
            };
            reader.onerror = () => resolve(dataUri);
            reader.readAsDataURL(blob);
          },
          'image/jpeg',
          0.68,
        );
      } catch {
        resolve(dataUri);
      }
    };
    image.onerror = () => resolve(dataUri);
    image.src = dataUri;
  });
}

function parseHomeworkText(text: string): { given: string | null; due: string | null; body: string } {
  const year = new Date().getFullYear();
  const givenMatch = text.match(/Дано:\s*(\d{2}\.\d{2})/i);
  const dueMatch = text.match(/(?:Срок сдачи|Сдать до):\s*(\d{2}\.\d{2})/i);
  const given = givenMatch ? toDateInputFromDayMonth(givenMatch[1], year) : null;
  const due = dueMatch ? toDateInputFromDayMonth(dueMatch[1], year) : null;
  const body = text
    .replace(/Дано:\s*\d{2}\.\d{2}\s*/gi, '')
    .replace(/(?:Срок сдачи|Сдать до):\s*\d{2}\.\d{2}\s*/gi, '')
    .trim();

  return { given, due, body };
}

function dateInputForDayInSameWeek(baseDateInput: string, dayIndex: number): string {
  const weekStart = addDaysToDateInput(baseDateInput, -dayIndexFromDateInput(baseDateInput));
  return addDaysToDateInput(weekStart, dayIndex);
}

function diffDays(fromDateInput: string, toDateInput: string): number {
  const from = parseDateInput(fromDateInput);
  const to = parseDateInput(toDateInput);
  if (!from || !to) {
    return 0;
  }
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function maxDateInput(left: string, right: string): string {
  const leftDate = parseDateInput(left);
  const rightDate = parseDateInput(right);
  if (!leftDate || !rightDate) {
    return left;
  }
  return leftDate.getTime() >= rightDate.getTime() ? left : right;
}

function isAudioAttachment(uri: string): boolean {
  const value = uri.toLowerCase();
  if (value.startsWith('audio:') || value.includes('audio/')) {
    return true;
  }
  return value.endsWith('.m4a') || value.endsWith('.aac') || value.endsWith('.mp3') || value.endsWith('.wav');
}

function isImageAttachment(uri: string): boolean {
  const value = uri.toLowerCase();
  if (value.startsWith('data:image/')) {
    return true;
  }
  return (
    value.endsWith('.png') ||
    value.endsWith('.jpg') ||
    value.endsWith('.jpeg') ||
    value.endsWith('.webp') ||
    value.endsWith('.heic')
  );
}

function normalizeSubjectNames(values: string[]): string[] {
  const normalized: string[] = [];
  const normalizedLower = new Set<string>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    const lower = value.toLowerCase();
    if (!normalizedLower.has(lower)) {
      normalizedLower.add(lower);
      normalized.push(value);
    }
  }
  return normalized;
}

export function TeacherScreen({
  user,
  snapshot,
  showOriginal,
  onToggleOriginal,
  onRefresh,
  onLogout,
  onSaveHomework,
  onDeleteHomework,
  onSendMessage,
  onPublishAnnouncement,
  onMarkRead,
  onUpdateFeedback,
  onCreateFeedback,
  onUpdateProfilePhoto,
  onSaveLesson,
  onDeleteLesson,
  onSwapLessons,
  onSaveLessonReport,
  onSaveStudentRecord,
  onUpdateProfile,
  onSendDirectMessage,
  onAssignHomeroom,
  onUpdateTeachingSubjects,
  onUpdateBirthdaySettings,
  onGetStudentDetails,
  onEnsureDirectThread,
}: {
  user: User;
  snapshot: DatabaseSnapshot;
  showOriginal: boolean;
  onToggleOriginal: () => void;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
  onSaveHomework: (params: {
    homeworkId?: string;
    lessonId: string;
    text: string;
    assignedDate: string;
    dueDate: string;
    attachments: string[];
    source: 'manual' | 'photo_ocr';
    ocrRawText: string | null;
  }) => Promise<void>;
  onDeleteHomework: (homeworkId: string) => Promise<void>;
  onSendMessage: (params: { threadId: string; text: string; attachments: string[] }) => Promise<void>;
  onPublishAnnouncement: (params: { text: string; classId?: string }) => Promise<void>;
  onMarkRead: (threadId: string) => Promise<void>;
  onUpdateFeedback: (params: { feedbackId: string; status?: Feedback['status'] }) => Promise<void>;
  onCreateFeedback: (params: {
    text: string;
    category: FeedbackCategory;
    visibilityRoles?: RoleId[];
    classId?: string | null;
  }) => Promise<void>;
  onUpdateProfilePhoto: (photoUri: string | null) => Promise<void>;
  onSaveLesson: (params: {
    lessonId?: string;
    classId: string;
    subject: string;
    room: string;
    startDatetime: string;
    endDatetime: string;
    type: LessonType;
  }) => Promise<void>;
  onDeleteLesson?: (lessonId: string) => Promise<void>;
  onSwapLessons: (params: { firstLessonId: string; secondLessonId: string }) => Promise<void>;
  onSaveLessonReport: (params: {
    lessonId: string;
    summaryText: string;
    audioTranscript: string | null;
  }) => Promise<void>;
  onSaveStudentRecord: (params: {
    lessonId: string;
    studentId: string;
    absent: boolean;
    remark: string | null;
    grade: string | null;
  }) => Promise<void>;
  onUpdateProfile: (params: { name: string; email: string | null; phone: string | null }) => Promise<void>;
  onSendDirectMessage: (params: {
    targetUserId: string;
    text: string;
    attachments: string[];
  }) => Promise<void>;
  onAssignHomeroom: (teacherId: string, classId: string, isHomeroom: boolean) => Promise<void>;
  onUpdateTeachingSubjects: (teacherId: string, teachingSubjects: string[]) => Promise<void>;
  onUpdateBirthdaySettings: (params: { dob: string; showInCalendar: boolean }) => Promise<void>;
  onGetStudentDetails: (studentId: string) => Promise<StudentDetailsResponse>;
  onEnsureDirectThread: (params: { targetUserId: string }) => Promise<void>;
}) {
  const initialScheduleDateInput = toJerusalemDateInput(new Date().toISOString());
  const language = user.preferred_language;
  const uiLocale = useMemo(() => localeByLanguage(language), [language]);
  const weekdayShortLabels = useMemo(() => {
    if (language === 'he') {
      return ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
    }
    if (language === 'en') {
      return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    }
    return ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  }, [language]);
  const [tab, setTab] = useState<TeacherTab>('home');
  const [selectedScheduleDateInput, setSelectedScheduleDateInput] = useState<string>(initialScheduleDateInput);
  const [scheduleMonthCursor, setScheduleMonthCursor] = useState<string>(
    monthCursorFromDateInput(initialScheduleDateInput),
  );
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [monthPickerVisible, setMonthPickerVisible] = useState(false);
  const [yearPickerVisible, setYearPickerVisible] = useState(false);

  const [addLessonVisible, setAddLessonVisible] = useState(false);
  const [lessonActionsVisible, setLessonActionsVisible] = useState(false);
  const [homeworkFormVisible, setHomeworkFormVisible] = useState(false);
  const [homeworkDuePickerVisible, setHomeworkDuePickerVisible] = useState(false);
  const [directMessageVisible, setDirectMessageVisible] = useState(false);
  const [absenceModalVisible, setAbsenceModalVisible] = useState(false);
  const [lessonSummaryVisible, setLessonSummaryVisible] = useState(false);
  const [replacementPickerVisible, setReplacementPickerVisible] = useState(false);
  const [suggestionsVisible, setSuggestionsVisible] = useState(false);
  const [suggestionFormVisible, setSuggestionFormVisible] = useState(false);
  const [studentsVisible, setStudentsVisible] = useState(false);
  const [studentCardVisible, setStudentCardVisible] = useState(false);
  const [studentCardLoading, setStudentCardLoading] = useState(false);
  const [studentCardDetails, setStudentCardDetails] = useState<StudentDetailsResponse | null>(null);
  const [studentCardError, setStudentCardError] = useState<string | null>(null);
  const [replyModalVisible, setReplyModalVisible] = useState(false);
  const [birthdaySendingId, setBirthdaySendingId] = useState<string | null>(null);
  const [birthdayGreetingVisible, setBirthdayGreetingVisible] = useState(false);
  const [birthdayGreetingTarget, setBirthdayGreetingTarget] = useState<User | null>(null);
  const [birthdayGreetingDraft, setBirthdayGreetingDraft] = useState('');
  const [birthdayGreetingByUserId, setBirthdayGreetingByUserId] = useState<Record<string, string>>({});
  const [birthdayCongratulatedIds, setBirthdayCongratulatedIds] = useState<string[]>([]);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [selectedParentMessage, setSelectedParentMessage] = useState<ParentMessageItem | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedClassHomeworkId, setSelectedClassHomeworkId] = useState<string | null>(null);
  const [expandedClassIds, setExpandedClassIds] = useState<string[]>([]);

  const [draft, setDraft] = useState<LessonDraft>(emptyLessonDraft(user.class_ids[0] ?? ''));
  const [lessonVisualState, setLessonVisualState] = useState<Record<string, LessonVisualState>>({});
  const [forcedUnreadParentMessageIds, setForcedUnreadParentMessageIds] = useState<string[]>([]);
  const [absenceDraft, setAbsenceDraft] = useState<Record<string, boolean>>({});
  const [lessonSummaryDraft, setLessonSummaryDraft] = useState('');
  const [lessonSummarySaving, setLessonSummarySaving] = useState(false);
  const [lessonDeleting, setLessonDeleting] = useState(false);

  const contentScrollY = useRef(new Animated.Value(0)).current;
  const headerTopInset = Platform.OS === 'android' ? (RNStatusBar.currentHeight ?? 0) : 0;
  const headerMaxHeight = 124 + headerTopInset;
  const headerMinHeight = 94 + headerTopInset;

  const [homeworkDraftText, setHomeworkDraftText] = useState('');
  const [editingHomeworkId, setEditingHomeworkId] = useState<string | undefined>(undefined);
  const [homeworkPhotoUri, setHomeworkPhotoUri] = useState<string | null>(null);
  const [homeworkAudioUri, setHomeworkAudioUri] = useState<string | null>(null);
  const [homeworkAudioTranscript, setHomeworkAudioTranscript] = useState('');
  const [homeworkAudioPlaying, setHomeworkAudioPlaying] = useState(false);
  const [homeworkSpeechRecording, setHomeworkSpeechRecording] = useState(false);
  const [homeworkPhotoBusy, setHomeworkPhotoBusy] = useState(false);
  const [homeworkSpeechBusy, setHomeworkSpeechBusy] = useState(false);
  const [homeworkSubmitting, setHomeworkSubmitting] = useState(false);
  const [homeworkSubmitSuccess, setHomeworkSubmitSuccess] = useState(false);
  const [homeworkKeyboardInset, setHomeworkKeyboardInset] = useState(0);
  const [homeworkInputHeight, setHomeworkInputHeight] = useState(HOMEWORK_INPUT_MIN_HEIGHT);
  const [homeworkInputAutoGrowEnabled, setHomeworkInputAutoGrowEnabled] = useState(false);
  const [homeworkInputFocused, setHomeworkInputFocused] = useState(false);
  const [homeworkClassId, setHomeworkClassId] = useState(user.class_ids[0] ?? '');
  const [homeworkClassTaskMode, setHomeworkClassTaskMode] = useState(false);
  const [homeworkSubjectDraft, setHomeworkSubjectDraft] = useState('');
  const [homeworkGivenDate, setHomeworkGivenDate] = useState(() =>
    toJerusalemDateInput(new Date().toISOString()),
  );
  const [homeworkDueDate, setHomeworkDueDate] = useState(() =>
    addDaysToDateInput(toJerusalemDateInput(new Date().toISOString()), 1),
  );
  const [homeworkCalendarTarget, setHomeworkCalendarTarget] = useState<'given' | 'due'>('due');
  const [homeworkDueMonthCursor, setHomeworkDueMonthCursor] = useState(() =>
    monthCursorFromDateInput(addDaysToDateInput(toJerusalemDateInput(new Date().toISOString()), 1)),
  );
  const [replyText, setReplyText] = useState('');
  const [directTargetUserId, setDirectTargetUserId] = useState('');
  const [directMessageText, setDirectMessageText] = useState('');
  const [suggestionPhotoUri, setSuggestionPhotoUri] = useState<string | null>(null);

  const [suggestionDescription, setSuggestionDescription] = useState('');
  const [suggestionAudience, setSuggestionAudience] = useState<SuggestionAudience>('all');
  const [submittingSuggestion, setSubmittingSuggestion] = useState(false);
  const [suggestionSuccessVisible, setSuggestionSuccessVisible] = useState(false);

  const suggestionFlyY = useRef(new Animated.Value(0)).current;
  const suggestionFlyOpacity = useRef(new Animated.Value(1)).current;
  const suggestionSuccessScale = useRef(new Animated.Value(0.2)).current;
  const suggestionSuccessOpacity = useRef(new Animated.Value(0)).current;
  const homeworkSheetTranslateY = useRef(new Animated.Value(0)).current;
  const studentCardTranslateY = useRef(new Animated.Value(0)).current;
  const reopenStudentsAfterCardRef = useRef(false);
  const lastHomeworkSubmitKeyRef = useRef<string | null>(null);
  const homeworkSubmitSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeSuccessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechRecognitionRef = useRef<any>(null);
  const nativeRecordingRef = useRef<Audio.Recording | null>(null);
  const webRecorderRef = useRef<any>(null);
  const webRecorderChunksRef = useRef<any[]>([]);
  const webRecorderStopResolveRef = useRef<((uri: string | null) => void) | null>(null);
  const webStreamRef = useRef<any>(null);
  const webSpeechTranscriptRef = useRef('');
  const generatedWebAudioUrlsRef = useRef<string[]>([]);
  const homeworkAudioSoundRef = useRef<Audio.Sound | null>(null);
  const homeworkScrollRef = useRef<ScrollView | null>(null);
  const homeworkInputAnchorYRef = useRef(0);
  const homeworkScrollOffsetYRef = useRef(0);
  const homeworkClosingRef = useRef(false);

  const [homeroomOptIn, setHomeroomOptIn] = useState(user.is_homeroom);
  const [homeroomClassId, setHomeroomClassId] = useState<string>(() => {
    const fromSchool = snapshot.classes.find((entry) => entry.homeroom_teacher_id === user.id)?.id;
    return fromSchool ?? user.class_ids[0] ?? '';
  });
  const [homeroomSaving, setHomeroomSaving] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState(user.name);
  const [profileEmailDraft, setProfileEmailDraft] = useState(user.email ?? '');
  const [profilePhoneDraft, setProfilePhoneDraft] = useState(user.phone ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [subjectOtherInput, setSubjectOtherInput] = useState('');

  const [suggestions, setSuggestions] = useState<SuggestionItem[]>(() =>
    suggestionDefaultsFromFeedback(snapshot.feedback),
  );

  const teacherLessons = useMemo(
    () =>
      lessonsForUser(user, snapshot).sort(
        (left, right) =>
          new Date(left.start_datetime).getTime() - new Date(right.start_datetime).getTime(),
      ),
    [snapshot, user],
  );

  const todayList = useMemo(
    () =>
      todayLessons(user, snapshot).sort(
        (left, right) =>
          new Date(left.start_datetime).getTime() - new Date(right.start_datetime).getTime(),
      ),
    [snapshot, user],
  );

  const current = useMemo(() => currentLesson(user, snapshot), [snapshot, user]);

  const usersById = useMemo(() => new Map(snapshot.users.map((entry) => [entry.id, entry])), [snapshot.users]);
  const threadsById = useMemo(() => new Map(snapshot.threads.map((entry) => [entry.id, entry])), [snapshot.threads]);
  const feedbackById = useMemo(() => new Map(snapshot.feedback.map((entry) => [entry.id, entry])), [snapshot.feedback]);
  const directThreadsById = useMemo(
    () =>
      new Map(
        snapshot.threads
          .filter((entry) => entry.type === 'direct')
          .map((entry) => [entry.id, entry]),
      ),
    [snapshot.threads],
  );

  const parentMessages = useMemo<ParentMessageItem[]>(() => {
    return snapshot.messages
      .map((message) => {
        const sender = usersById.get(message.sender_id);
        if (!sender || sender.role_id !== 4) {
          return null;
        }
        const childName =
          sender.child_ids
            .map((childId) => usersById.get(childId)?.name)
            .find(Boolean) ?? null;
        return {
          id: message.id,
          threadId: message.thread_id,
          senderId: sender.id,
          senderName: sender.name,
          childName,
          text: getLocalizedText(
            message.text_original,
            ensureTranslationMap(message.text_original, message.lang_original, message.translations),
            language,
            showOriginal,
          ),
          createdAt: message.created_at,
          isRead: message.read_by.includes(user.id),
        };
      })
      .filter((entry): entry is ParentMessageItem => Boolean(entry))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }, [language, showOriginal, snapshot.messages, user.id, usersById]);

  const unresolvedParentMessages = useMemo(
    () => parentMessages.filter((entry) => !entry.isRead || forcedUnreadParentMessageIds.includes(entry.id)),
    [parentMessages, forcedUnreadParentMessageIds],
  );

  const featuredParentMessage = unresolvedParentMessages[0] ?? null;

  const birthdayMessages = useMemo<BirthdayMessageItem[]>(() => {
    return snapshot.messages
      .map((message) => {
        const thread = directThreadsById.get(message.thread_id);
        const sender = usersById.get(message.sender_id);
        if (!thread || !sender || sender.role_id === 4) {
          return null;
        }
        if (!thread.participants.includes(user.id) || !isBirthdayGreetingText(message.text_original)) {
          return null;
        }
        const peerUserId =
          message.sender_id === user.id
            ? thread.participants.find((participant) => participant !== user.id) ?? message.sender_id
            : message.sender_id;
        const peerName = usersById.get(peerUserId)?.name ?? 'Пользователь';
        return {
          id: message.id,
          threadId: message.thread_id,
          senderId: message.sender_id,
          senderName: sender.name,
          peerUserId,
          peerName,
          text: getLocalizedText(
            message.text_original,
            ensureTranslationMap(message.text_original, message.lang_original, message.translations),
            language,
            showOriginal,
          ),
          createdAt: message.created_at,
          isIncoming: message.sender_id !== user.id,
          isRead: message.read_by.includes(user.id),
        };
      })
      .filter((entry): entry is BirthdayMessageItem => Boolean(entry))
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  }, [directThreadsById, language, showOriginal, snapshot.messages, user.id, usersById]);

  const unreadBirthdayMessages = useMemo(
    () => birthdayMessages.filter((entry) => entry.isIncoming && !entry.isRead),
    [birthdayMessages],
  );

  const sentMessages = useMemo(() => {
    const birthdayMessageIds = new Set(birthdayMessages.map((entry) => entry.id));
    return snapshot.messages
      .filter((entry) => entry.sender_id === user.id && !birthdayMessageIds.has(entry.id))
      .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
      .map((entry) => {
        const thread = threadsById.get(entry.thread_id);
        if (!thread) {
          return {
            id: entry.id,
            target: 'Чат',
            text: getLocalizedText(
              entry.text_original,
              ensureTranslationMap(entry.text_original, entry.lang_original, entry.translations),
              language,
              showOriginal,
            ),
            createdAt: entry.created_at,
          };
        }
        if (thread.class_id) {
          return {
            id: entry.id,
            target: className(snapshot, thread.class_id, language),
            text: getLocalizedText(
              entry.text_original,
              ensureTranslationMap(entry.text_original, entry.lang_original, entry.translations),
              language,
              showOriginal,
            ),
            createdAt: entry.created_at,
          };
        }
        const recipients = thread.participants
          .filter((participant) => participant !== user.id)
          .map((participant) => usersById.get(participant)?.name)
          .filter((name): name is string => Boolean(name));
        return {
          id: entry.id,
          target: recipients.length > 0 ? recipients.join(', ') : 'Личный чат',
          text: getLocalizedText(
            entry.text_original,
            ensureTranslationMap(entry.text_original, entry.lang_original, entry.translations),
            language,
            showOriginal,
          ),
          createdAt: entry.created_at,
        };
      });
  }, [birthdayMessages, language, showOriginal, snapshot, snapshot.messages, threadsById, user.id, usersById]);

  const studentUsers = useMemo(
    () =>
      snapshot.users.filter(
        (entry) => entry.role_id === 5 && entry.class_ids.some((classId) => user.class_ids.includes(classId)),
      ),
    [snapshot.users, user.class_ids],
  );

  const lessonDisplaySubject = (lesson: Lesson): string => {
    const visual = lessonVisualState[lesson.id];
    if (visual?.kind === 'replaced') {
      const match = visual.note.match(/"(.+?)"/);
      if (match?.[1]) {
        return localizeSubjectName(match[1]);
      }
    }
    return localizeSubjectName(lesson.subject);
  };

  const nextLesson = useMemo(() => {
    const nowMs = Date.now();
    return (
      teacherLessons.find((entry) => {
        const visual = lessonVisualState[entry.id];
        if (entry.status === 'canceled' || visual?.kind === 'canceled') {
          return false;
        }
        return new Date(entry.start_datetime).getTime() > nowMs;
      }) ?? null
    );
  }, [lessonVisualState, teacherLessons]);

  const nextLessonWhen = useMemo(() => {
    if (!nextLesson) {
      return '';
    }
    const now = new Date();
    const target = new Date(nextLesson.start_datetime);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    const diffDaysLocal = Math.round((startOfTarget - startOfToday) / DAY_MS);

    if (diffDaysLocal === 0) {
      return t(language, { ru: 'сегодня', en: 'today', he: 'היום' });
    }
    if (diffDaysLocal === 1) {
      return t(language, { ru: 'завтра', en: 'tomorrow', he: 'מחר' });
    }
    if (diffDaysLocal === 2) {
      return t(language, { ru: 'послезавтра', en: 'day after tomorrow', he: 'מחרתיים' });
    }
    return dateShortLabel(toJerusalemDateInput(nextLesson.start_datetime), uiLocale);
  }, [language, nextLesson, uiLocale]);

  const absentCountToday = useMemo(() => {
    const lessonIds = new Set(todayList.map((entry) => entry.id));
    return new Set(
      snapshot.absence
        .filter((entry) => lessonIds.has(entry.lesson_id))
        .map((entry) => entry.student_id),
    ).size;
  }, [snapshot.absence, todayList]);

  const lessonsByDate = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const lesson of teacherLessons) {
      const dateInput = toJerusalemDateInput(lesson.start_datetime);
      const currentDateLessons = map.get(dateInput) ?? [];
      currentDateLessons.push(lesson);
      map.set(dateInput, currentDateLessons);
    }
    for (const dateLessons of map.values()) {
      dateLessons.sort(
        (left, right) =>
          new Date(left.start_datetime).getTime() - new Date(right.start_datetime).getTime(),
      );
    }
    return map;
  }, [teacherLessons]);

  const lessonsByClass = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const lesson of teacherLessons) {
      const list = map.get(lesson.class_id) ?? [];
      list.push(lesson);
      map.set(lesson.class_id, list);
    }
    for (const list of map.values()) {
      list.sort((left, right) => new Date(left.start_datetime).getTime() - new Date(right.start_datetime).getTime());
    }
    return map;
  }, [teacherLessons]);

  const monthStartInput = useMemo(() => `${scheduleMonthCursor}-01`, [scheduleMonthCursor]);
  const monthEndInput = useMemo(() => endOfMonthDateInput(scheduleMonthCursor), [scheduleMonthCursor]);
  const scheduleWeekStartInput = useMemo(
    () => addDaysToDateInput(selectedScheduleDateInput, -dayIndexFromDateInput(selectedScheduleDateInput)),
    [selectedScheduleDateInput],
  );
  const scheduleFiveDayStartInput = useMemo(() => {
    const selectedDayIndex = dayIndexFromDateInput(selectedScheduleDateInput);
    const shiftFromWeekStart = Math.max(0, selectedDayIndex - 4);
    return addDaysToDateInput(scheduleWeekStartInput, shiftFromWeekStart);
  }, [scheduleWeekStartInput, selectedScheduleDateInput]);
  const fiveDayScheduleInputs = useMemo(
    () => Array.from({ length: 5 }, (_, index) => addDaysToDateInput(scheduleFiveDayStartInput, index)),
    [scheduleFiveDayStartInput],
  );
  const visibleRange = useMemo(
    () =>
      calendarExpanded
        ? { startInput: monthStartInput, endInput: monthEndInput }
        : {
            startInput: fiveDayScheduleInputs[0] ?? selectedScheduleDateInput,
            endInput:
              fiveDayScheduleInputs[fiveDayScheduleInputs.length - 1] ??
              fiveDayScheduleInputs[0] ??
              selectedScheduleDateInput,
          },
    [calendarExpanded, fiveDayScheduleInputs, monthEndInput, monthStartInput, selectedScheduleDateInput],
  );

  const scheduleMonthCells = useMemo(
    () => buildMonthDateCells(scheduleMonthCursor),
    [scheduleMonthCursor],
  );

  const scheduleMonthLabel = useMemo(
    () => monthLabelFromCursor(scheduleMonthCursor),
    [scheduleMonthCursor],
  );
  const scheduleMonthName = useMemo(
    () => monthNameFromCursor(scheduleMonthCursor),
    [scheduleMonthCursor],
  );
  const scheduleYearValue = useMemo(
    () => yearFromCursor(scheduleMonthCursor),
    [scheduleMonthCursor],
  );
  const scheduleYearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 21 }, (_, index) => currentYear - 10 + index);
  }, []);

  const selectedDayDateInput = selectedScheduleDateInput;
  const selectedDayLessons = lessonsByDate.get(selectedDayDateInput) ?? [];

  const birthdayMarkers = useMemo(
    () => birthdayDateKeysForUser(user, snapshot, monthStartInput, monthEndInput),
    [monthEndInput, monthStartInput, snapshot, user],
  );

  const selectedDayBirthdays = useMemo(
    () => birthdaysForDateForUser(user, snapshot, selectedDayDateInput),
    [selectedDayDateInput, snapshot, user],
  );

  const scheduleDayStatsByDate = useMemo(() => {
    const stats = new Map<string, { lessons: number; events: number; holidays: number }>();
    for (const lesson of teacherLessons) {
      if (lesson.status === 'canceled' || lessonVisualState[lesson.id]?.kind === 'canceled') {
        continue;
      }
      const dateInput = toJerusalemDateInput(lesson.start_datetime);
      const current = stats.get(dateInput) ?? { lessons: 0, events: 0, holidays: 0 };
      if (lesson.type === 'holiday') {
        current.holidays += 1;
      } else if (lesson.type === 'event') {
        current.events += 1;
      } else {
        current.lessons += 1;
      }
      stats.set(dateInput, current);
    }
    return stats;
  }, [lessonVisualState, teacherLessons]);

  const customHolidayByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const lesson of teacherLessons) {
      if (lesson.type !== 'holiday') {
        continue;
      }
      if (lesson.status === 'canceled' || lessonVisualState[lesson.id]?.kind === 'canceled') {
        continue;
      }
      const dateInput = toJerusalemDateInput(lesson.start_datetime);
      map.set(dateInput, lesson.subject || 'Выходной');
    }
    return map;
  }, [lessonVisualState, teacherLessons]);

  const persistedTeachingSubjects = useMemo(
    () => normalizeSubjectNames(user.teaching_subjects ?? []),
    [user.teaching_subjects],
  );

  const inferredTeachingSubjects = useMemo(() => {
    if (persistedTeachingSubjects.length > 0) {
      return persistedTeachingSubjects;
    }
    return normalizeSubjectNames(teacherLessons.map((entry) => entry.subject));
  }, [persistedTeachingSubjects, teacherLessons]);

  const [teachingSubjectsDraft, setTeachingSubjectsDraft] = useState<string[]>(inferredTeachingSubjects);
  const [teachingSubjectsSaving, setTeachingSubjectsSaving] = useState(false);

  const availableAdminSubjects = useMemo(
    () =>
      normalizeSubjectNames(
        snapshot.subjects
          .filter((entry) => !entry.is_archived)
          .map((entry) => entry.name.trim())
          .filter(Boolean),
      ),
    [snapshot.subjects],
  );

  const localizeSubjectName = useCallback(
    (subject: string): string => {
      const clean = subject.trim();
      if (!clean) {
        return clean;
      }
      const lower = clean.toLocaleLowerCase();
      const subjectModel = snapshot.subjects.find((entry) => {
        const baseName = entry.name.trim();
        if (baseName && baseName.toLocaleLowerCase() === lower) {
          return true;
        }
        return (['ru', 'en', 'he'] as const).some((code) => {
          const translated = entry.name_i18n?.[code]?.trim() ?? '';
          return translated.toLocaleLowerCase() === lower;
        });
      });
      if (subjectModel) {
        const localizedFromModel = subjectModel.name_i18n?.[language]?.trim() ?? '';
        if (localizedFromModel) {
          return localizedFromModel;
        }
      }
      return localizeLessonSubject(clean, language);
    },
    [language, snapshot.subjects],
  );

  const subjects = useMemo(
    () => (inferredTeachingSubjects.length > 0 ? inferredTeachingSubjects : availableAdminSubjects),
    [inferredTeachingSubjects, availableAdminSubjects],
  );

  const classStats = useMemo(
    () =>
      snapshot.classes
        .filter((entry) => user.class_ids.includes(entry.id))
        .map((classModel) => {
          const classStudents = studentUsers.filter((entry) => entry.class_ids.includes(classModel.id));

          return {
            classId: classModel.id,
            className: className(snapshot, classModel.id, language),
            students: classStudents.length,
          };
        }),
    [language, snapshot, snapshot.classes, studentUsers, user.class_ids],
  );

  const classHomeworkMap = useMemo(() => {
    const lessonClassMap = new Map(snapshot.lessons.map((lesson) => [lesson.id, lesson.class_id]));
    const map = new Map<string, Homework[]>();
    for (const item of snapshot.homework) {
      if (item.teacher_id !== user.id) {
        continue;
      }
      const classId = lessonClassMap.get(item.lesson_id) ?? item.class_id;
      const list = map.get(classId) ?? [];
      list.push(item);
      map.set(classId, list);
    }
    for (const list of map.values()) {
      list.sort(
        (left, right) =>
          left.due_date.localeCompare(right.due_date) ||
          new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
      );
    }
    return map;
  }, [snapshot.homework, snapshot.lessons, user.id]);

  const teacherClassModels = useMemo(
    () => snapshot.classes.filter((entry) => user.class_ids.includes(entry.id)),
    [snapshot.classes, user.class_ids],
  );

  const homeroomClassName = useMemo(
    () => {
      const classModel = teacherClassModels.find((entry) => entry.id === homeroomClassId);
      if (!classModel) {
        return '';
      }
      return classModel.name_i18n?.[language] ?? classModel.name;
    },
    [homeroomClassId, language, teacherClassModels],
  );

  const parentIdsByChild = useMemo(() => {
    const map = new Map<string, string[]>();
    snapshot.users
      .filter((entry) => entry.role_id === 4)
      .forEach((parent) => {
        parent.child_ids.forEach((childId) => {
          const current = map.get(childId) ?? [];
          current.push(parent.id);
          map.set(childId, current);
        });
      });
    return map;
  }, [snapshot.users]);

  const selectedClassStudents = useMemo(() => {
    if (!selectedClassId) {
      return [];
    }
    return snapshot.users
      .filter((entry) => entry.role_id === 5 && entry.class_ids.includes(selectedClassId))
      .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
  }, [selectedClassId, snapshot.users]);

  const selectedClassHomework = useMemo(() => {
    if (!selectedClassId) {
      return null;
    }
    const classHomework = classHomeworkMap.get(selectedClassId) ?? [];
    if (classHomework.length === 0) {
      return null;
    }
    return classHomework.find((entry) => entry.id === selectedClassHomeworkId) ?? classHomework[0];
  }, [classHomeworkMap, selectedClassHomeworkId, selectedClassId]);

  const absentStudentsInSelectedClass = useMemo(() => {
    if (!selectedClassId) {
      return new Set<string>();
    }
    const selectedClassLessonIds = new Set(
      todayList.filter((entry) => entry.class_id === selectedClassId).map((entry) => entry.id),
    );
    return new Set(
      snapshot.absence
        .filter((entry) => selectedClassLessonIds.has(entry.lesson_id))
        .map((entry) => entry.student_id),
    );
  }, [selectedClassId, snapshot.absence, todayList]);

  const selectedClassName = selectedClassId ? className(snapshot, selectedClassId, language) : '';
  const todayDateInput = useMemo(() => toJerusalemDateInput(new Date().toISOString()), []);

  const messagesForBadge = useMemo(
    () => unresolvedParentMessages.length + unreadBirthdayMessages.length,
    [unresolvedParentMessages.length, unreadBirthdayMessages.length],
  );

  const directMessageTargets = useMemo(
    () =>
      snapshot.users
        .filter((entry) => entry.id !== user.id)
        .filter((entry) => [1, 3, 4, 5, 6].includes(entry.role_id))
        .sort((left, right) => left.name.localeCompare(right.name, 'ru')),
    [snapshot.users, user.id],
  );

  const homeworkByLessonId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of snapshot.homework) {
      const list = map.get(item.lesson_id) ?? [];
      list.push(item.id);
      map.set(item.lesson_id, list);
    }
    return map;
  }, [snapshot.homework]);

  const selectedLessonHomeworkIds = useMemo(
    () => (selectedLesson ? homeworkByLessonId.get(selectedLesson.id) ?? [] : []),
    [homeworkByLessonId, selectedLesson],
  );
  const selectedLessonHomeworkId = selectedLessonHomeworkIds[selectedLessonHomeworkIds.length - 1];
  const selectedLessonHasHomework = selectedLessonHomeworkIds.length > 0;

  const orderedSuggestions = useMemo(() => {
    return [...suggestions].sort((left, right) => {
      if (left.archived && !right.archived) {
        return 1;
      }
      if (!left.archived && right.archived) {
        return -1;
      }
      if (left.status === 'rejected' && right.status !== 'rejected') {
        return 1;
      }
      if (left.status !== 'rejected' && right.status === 'rejected') {
        return -1;
      }
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  }, [suggestions]);

  const homeworkDueForSelectedDate = useMemo(
    () =>
      snapshot.homework.filter((entry) => {
        const parsed = parseHomeworkText(entry.text);
        return (entry.due_date || parsed.due) === selectedDayDateInput;
      }),
    [snapshot.homework, selectedDayDateInput],
  );

  const homeworkAllowedSubjectSet = useMemo(
    () => new Set(inferredTeachingSubjects.map((entry) => entry.trim().toLowerCase()).filter(Boolean)),
    [inferredTeachingSubjects],
  );

  const homeworkLessonOptions = useMemo(() => {
    const filtered =
      homeworkAllowedSubjectSet.size === 0
        ? teacherLessons
        : teacherLessons.filter((lesson) => homeworkAllowedSubjectSet.has(lesson.subject.trim().toLowerCase()));
    return filtered;
  }, [homeworkAllowedSubjectSet, teacherLessons]);

  const homeworkSubjectOptions = useMemo(() => {
    const fromProfile = normalizeSubjectNames(inferredTeachingSubjects);
    if (fromProfile.length > 0) {
      return fromProfile;
    }
    return normalizeSubjectNames(homeworkLessonOptions.map((lesson) => lesson.subject));
  }, [homeworkLessonOptions, inferredTeachingSubjects]);

  useEffect(() => {
    setSuggestions((previous) => {
      const existingIds = new Set(previous.map((entry) => entry.id));
      const next = [...previous];
      for (const feedback of snapshot.feedback) {
        if (!existingIds.has(feedback.id)) {
          next.push(feedbackToSuggestion(feedback));
        }
      }
      return next;
    });
  }, [snapshot.feedback]);

  useEffect(() => {
    const availableIds = new Set(parentMessages.map((entry) => entry.id));
    setForcedUnreadParentMessageIds((current) => current.filter((entry) => availableIds.has(entry)));
  }, [parentMessages]);

  useEffect(() => {
    if (!selectedClassId) {
      setSelectedClassHomeworkId(null);
      return;
    }
    const classHomework = classHomeworkMap.get(selectedClassId) ?? [];
    if (classHomework.length === 0) {
      setSelectedClassHomeworkId(null);
      return;
    }
    if (selectedClassHomeworkId && classHomework.some((entry) => entry.id === selectedClassHomeworkId)) {
      return;
    }
    setSelectedClassHomeworkId(classHomework[0].id);
  }, [classHomeworkMap, selectedClassHomeworkId, selectedClassId]);

  useEffect(() => {
    if (user.class_ids.length === 0) {
      return;
    }
    setDraft((currentDraft) => {
      if (currentDraft.classId) {
        return currentDraft;
      }
      return {
        ...currentDraft,
        classId: user.class_ids[0],
      };
    });
  }, [user.class_ids]);

  useEffect(() => {
    setHomeroomOptIn(user.is_homeroom);
    const classFromSnapshot = snapshot.classes.find((entry) => entry.homeroom_teacher_id === user.id)?.id;
    const fallbackClass = user.class_ids[0] ?? '';
    setHomeroomClassId(classFromSnapshot ?? fallbackClass);
  }, [snapshot.classes, user.class_ids, user.id, user.is_homeroom]);

  useEffect(() => {
    setProfileNameDraft(user.name);
    setProfileEmailDraft(user.email ?? '');
    setProfilePhoneDraft(user.phone ?? '');
  }, [user.email, user.name, user.phone]);

  useEffect(() => {
    if (!homeroomClassId && user.class_ids[0]) {
      setHomeroomClassId(user.class_ids[0]);
      return;
    }
    if (homeroomClassId && !user.class_ids.includes(homeroomClassId)) {
      setHomeroomClassId(user.class_ids[0] ?? '');
    }
  }, [homeroomClassId, user.class_ids]);

  useEffect(() => {
    if (!homeworkClassId && user.class_ids[0] && !homeworkFormVisible) {
      setHomeworkClassId(user.class_ids[0]);
      return;
    }
    if (homeworkClassId && !user.class_ids.includes(homeworkClassId)) {
      setHomeworkClassId(user.class_ids[0] ?? '');
    }
  }, [homeworkClassId, user.class_ids, homeworkFormVisible]);

  useEffect(() => {
    setTeachingSubjectsDraft(inferredTeachingSubjects);
  }, [inferredTeachingSubjects]);

  useEffect(() => {
    if (tab !== 'schedule') {
      return;
    }
    const todayInput = toJerusalemDateInput(new Date().toISOString());
    setCalendarExpanded(false);
    setSelectedScheduleDateInput(todayInput);
    setScheduleMonthCursor(monthCursorFromDateInput(todayInput));
  }, [tab]);

  useEffect(
    () => () => {
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop?.();
        } catch {
          // ignored
        }
        speechRecognitionRef.current = null;
      }
      if (nativeRecordingRef.current) {
        nativeRecordingRef.current
          .stopAndUnloadAsync()
          .catch(() => undefined)
          .finally(() => {
            nativeRecordingRef.current = null;
          });
      }
      if (webRecorderRef.current) {
        try {
          webRecorderRef.current.stop?.();
        } catch {
          // ignored
        }
        webRecorderRef.current = null;
      }
      if (webStreamRef.current) {
        try {
          webStreamRef.current.getTracks().forEach((track: any) => track.stop());
        } catch {
          // ignored
        }
        webStreamRef.current = null;
      }
      for (const uri of generatedWebAudioUrlsRef.current) {
        try {
          URL.revokeObjectURL(uri);
        } catch {
          // ignored
        }
      }
      generatedWebAudioUrlsRef.current = [];
      if (homeworkAudioSoundRef.current) {
        homeworkAudioSoundRef.current
          .unloadAsync()
          .catch(() => undefined)
          .finally(() => {
            homeworkAudioSoundRef.current = null;
          });
      }
      setHomeworkAudioPlaying(false);
      setHomeworkSpeechRecording(false);
      if (closeSuccessTimer.current) {
        clearTimeout(closeSuccessTimer.current);
      }
      if (homeworkSubmitSuccessTimer.current) {
        clearTimeout(homeworkSubmitSuccessTimer.current);
      }
    },
    [],
  );

  const resetSuggestionForm = () => {
    setSuggestionDescription('');
    setSuggestionPhotoUri(null);
    setSuggestionAudience('all');
    setSuggestionSuccessVisible(false);
    setSubmittingSuggestion(false);
    suggestionFlyY.setValue(0);
    suggestionFlyOpacity.setValue(1);
    suggestionSuccessScale.setValue(0.2);
    suggestionSuccessOpacity.setValue(0);
  };

  const closeSuggestionForm = () => {
    if (closeSuccessTimer.current) {
      clearTimeout(closeSuccessTimer.current);
      closeSuccessTimer.current = null;
    }
    setSuggestionFormVisible(false);
    resetSuggestionForm();
  };

  const openNewLessonModal = () => {
    const targetDateInput = selectedScheduleDateInput || toJerusalemDateInput(new Date().toISOString());
    const targetDay = dayIndexFromDateInput(targetDateInput);
    setDraft((current) => {
      const base = emptyLessonDraft(user.class_ids[0] ?? '');
      const firstSubject = subjects[0] ?? '';
      return {
        ...base,
        dateInput: targetDateInput,
        dayIndex: targetDay,
        type: 'lesson',
        room: 'Кабинет 1',
        subject: firstSubject || current.subject || '',
        customSubject: '',
      };
    });
    setAddLessonVisible(true);
  };

  const openNewEventModal = () => {
    const targetDateInput = selectedScheduleDateInput || toJerusalemDateInput(new Date().toISOString());
    const targetDay = dayIndexFromDateInput(targetDateInput);
    setDraft((current) => {
      const base = emptyLessonDraft(user.class_ids[0] ?? '');
      return {
        ...base,
        dateInput: targetDateInput,
        dayIndex: targetDay,
        type: 'event',
        subject: CUSTOM_SUBJECT_VALUE,
        customSubject: current.customSubject.trim() || 'Мероприятие',
        room: 'Актовый зал',
      };
    });
    setAddLessonVisible(true);
  };

  const openNewHolidayModal = () => {
    const targetDateInput = selectedScheduleDateInput || toJerusalemDateInput(new Date().toISOString());
    const targetDay = dayIndexFromDateInput(targetDateInput);
    setDraft((current) => {
      const base = emptyLessonDraft(user.class_ids[0] ?? '');
      return {
        ...base,
        dateInput: targetDateInput,
        dayIndex: targetDay,
        type: 'holiday',
        subject: CUSTOM_SUBJECT_VALUE,
        customSubject: current.customSubject.trim() || 'Выходной',
        room: '—',
        startTime: '00:00',
        endTime: '23:59',
      };
    });
    setAddLessonVisible(true);
  };

  const openEditLessonModal = (lesson: Lesson) => {
    const hasPresetSubject = subjects.includes(lesson.subject);
    setDraft({
      lessonId: lesson.id,
      dateInput: toJerusalemDateInput(lesson.start_datetime),
      dayIndex: getDayIndexInJerusalem(lesson.start_datetime),
      startTime: toJerusalemTimeInput(lesson.start_datetime),
      endTime: toJerusalemTimeInput(lesson.end_datetime),
      subject: hasPresetSubject ? lesson.subject : CUSTOM_SUBJECT_VALUE,
      customSubject: hasPresetSubject ? '' : lesson.subject,
      classId: lesson.class_id,
      room: lesson.room,
      type: lesson.type,
    });
    setAddLessonVisible(true);
  };

  const onLessonPress = (lesson: Lesson) => {
    setSelectedLesson(lesson);
    setLessonActionsVisible(true);
  };

  const selectScheduleDate = (dateInput: string) => {
    setSelectedScheduleDateInput(dateInput);
    setScheduleMonthCursor(monthCursorFromDateInput(dateInput));
  };

  const navigateMonth = (direction: -1 | 1) => {
    const nextCursor = shiftMonthCursor(scheduleMonthCursor, direction);
    setScheduleMonthCursor(nextCursor);
    const nextDateInput = `${nextCursor}-01`;
    setSelectedScheduleDateInput(nextDateInput);
  };

  const navigateWeek = (direction: -1 | 1) => {
    const nextWeekStart = addDaysToDateInput(scheduleWeekStartInput, direction * 7);
    setSelectedScheduleDateInput(nextWeekStart);
    setScheduleMonthCursor(monthCursorFromDateInput(nextWeekStart));
  };

  const openRangePicker = () => {
    setCalendarExpanded((current) => {
      const next = !current;
      if (next) {
        setScheduleMonthCursor(monthCursorFromDateInput(selectedScheduleDateInput));
      }
      return next;
    });
  };

  const selectScheduleMonth = (monthValue: number) => {
    const cursor = `${scheduleYearValue}-${String(monthValue).padStart(2, '0')}`;
    setScheduleMonthCursor(cursor);
    setSelectedScheduleDateInput(`${cursor}-01`);
    setMonthPickerVisible(false);
  };

  const selectScheduleYear = (yearValue: number) => {
    const monthPart = scheduleMonthCursor.slice(5, 7);
    const cursor = `${String(yearValue).padStart(4, '0')}-${monthPart}`;
    setScheduleMonthCursor(cursor);
    setSelectedScheduleDateInput(`${cursor}-01`);
    setYearPickerVisible(false);
  };

  const queueClassNotifications = (_classId: string, _text: string) => {};

  const canAssignHomeworkForSubject = (subject: string): boolean => {
    if (homeworkAllowedSubjectSet.size === 0) {
      return true;
    }
    return homeworkAllowedSubjectSet.has(subject.trim().toLowerCase());
  };

  const getClassHomeworkAnchorLesson = (
    classId: string,
    preferredLessonId?: string,
    preferredSubject?: string,
  ): Lesson | null => {
    const classLessons = lessonsByClass.get(classId) ?? [];
    if (classLessons.length === 0) {
      return null;
    }

    if (preferredLessonId) {
      const preferred = classLessons.find((entry) => entry.id === preferredLessonId);
      if (preferred) {
        return preferred;
      }
    }

    const normalizedPreferredSubject = preferredSubject?.trim().toLowerCase() ?? '';
    if (normalizedPreferredSubject) {
      const preferredActive = classLessons.find((entry) => {
        if (entry.subject.trim().toLowerCase() !== normalizedPreferredSubject) {
          return false;
        }
        const visual = lessonVisualState[entry.id];
        return entry.status !== 'canceled' && visual?.kind !== 'canceled';
      });
      if (preferredActive) {
        return preferredActive;
      }
    }

    const nowMs = Date.now();
    const nextActive = classLessons.find((entry) => {
      const visual = lessonVisualState[entry.id];
      if (entry.status === 'canceled' || visual?.kind === 'canceled') {
        return false;
      }
      if (
        normalizedPreferredSubject &&
        entry.subject.trim().toLowerCase() !== normalizedPreferredSubject
      ) {
        return false;
      }
      return new Date(entry.start_datetime).getTime() > nowMs;
    });

    if (nextActive) {
      return nextActive;
    }

    return classLessons[0];
  };

  const getHomeworkLessonBySubject = (subject: string, classId: string): Lesson | null => {
    const normalizedSubject = subject.trim().toLowerCase();
    if (!normalizedSubject) {
      return null;
    }
    const classLessons = (lessonsByClass.get(classId) ?? []).filter((entry) => entry.status !== 'canceled');
    const classMatch = classLessons.find((entry) => entry.subject.trim().toLowerCase() === normalizedSubject);
    if (classMatch) {
      return classMatch;
    }
    return (
      teacherLessons.find(
        (entry) => entry.status !== 'canceled' && entry.subject.trim().toLowerCase() === normalizedSubject,
      ) ?? null
    );
  };

  const defaultHomeworkDueDateForClass = (classId: string, givenInput: string): string => {
    const nowMs = Date.now();
    const nextActive = (lessonsByClass.get(classId) ?? []).find((entry) => {
      const visual = lessonVisualState[entry.id];
      if (entry.status === 'canceled' || visual?.kind === 'canceled') {
        return false;
      }
      return new Date(entry.start_datetime).getTime() > nowMs;
    });
    if (!nextActive) {
      return addDaysToDateInput(givenInput, 1);
    }
    return toJerusalemDateInput(nextActive.start_datetime);
  };

  const openStudentsForClass = (classId: string) => {
    reopenStudentsAfterCardRef.current = false;
    setSelectedClassId(classId);
    const classHomework = classHomeworkMap.get(classId) ?? [];
    setSelectedClassHomeworkId(classHomework[0]?.id ?? null);
    setStudentsVisible(true);
  };

  const closeStudentCardInternal = useCallback((shouldReopen: boolean) => {
    reopenStudentsAfterCardRef.current = false;
    setStudentCardVisible(false);
    setStudentCardLoading(false);
    setStudentCardError(null);
    studentCardTranslateY.setValue(0);
    if (shouldReopen && selectedClassId) {
      setStudentsVisible(true);
    }
  }, [selectedClassId, studentCardTranslateY]);

  const closeStudentCard = useCallback(() => {
    closeStudentCardInternal(reopenStudentsAfterCardRef.current);
  }, [closeStudentCardInternal]);

  const closeStudentCardStayClosed = useCallback(() => {
    closeStudentCardInternal(false);
  }, [closeStudentCardInternal]);

  const studentCardPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (evt, gesture) => {
          const touchY = evt.nativeEvent.locationY ?? Number.MAX_SAFE_INTEGER;
          return (
            studentCardVisible &&
            touchY <= 120 &&
            gesture.dy > 8 &&
            Math.abs(gesture.dy) > Math.abs(gesture.dx)
          );
        },
        onPanResponderMove: (_evt, gesture) => {
          if (gesture.dy > 0) {
            studentCardTranslateY.setValue(Math.min(gesture.dy, 420));
          }
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (gesture.dy > 120 || gesture.vy > 1.2) {
            Animated.timing(studentCardTranslateY, {
              toValue: 420,
              duration: 180,
              useNativeDriver: true,
            }).start(() => {
              closeStudentCard();
            });
            return;
          }
          Animated.spring(studentCardTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 120,
            friction: 14,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(studentCardTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 120,
            friction: 14,
          }).start();
        },
      }),
    [closeStudentCard, studentCardTranslateY, studentCardVisible],
  );

  const openStudentCard = async (studentId: string) => {
    reopenStudentsAfterCardRef.current = true;
    setStudentsVisible(false);
    setStudentCardVisible(true);
    setStudentCardLoading(true);
    setStudentCardError(null);
    setStudentCardDetails(null);
    studentCardTranslateY.setValue(0);
    try {
      const details = await onGetStudentDetails(studentId);
      setStudentCardDetails(details);
    } catch (error) {
      setStudentCardError((error as Error).message || 'Не удалось загрузить карточку ученика.');
    } finally {
      setStudentCardLoading(false);
    }
  };

  const callParentFromCard = async (phone: string | null) => {
    const cleaned = (phone ?? '').trim().replace(/\s+/g, '');
    if (!cleaned) {
      Alert.alert('Телефон не указан', 'Для этого родителя номер телефона не заполнен.');
      return;
    }
    const telUrl = `tel:${cleaned}`;
    try {
      const canCall = await Linking.canOpenURL(telUrl);
      if (!canCall) {
        Alert.alert('Недоступно', 'Устройство не поддерживает звонки.');
        return;
      }
      await Linking.openURL(telUrl);
    } catch {
      Alert.alert('Ошибка', 'Не удалось открыть звонок.');
    }
  };

  const writeToParentFromCard = async (parentUserId: string) => {
    try {
      await onEnsureDirectThread({ targetUserId: parentUserId });
      setDirectTargetUserId(parentUserId);
      setDirectMessageText('');
      setStudentsVisible(false);
      closeStudentCardStayClosed();
      setTab('tasks');
      setDirectMessageVisible(true);
    } catch (error) {
      Alert.alert('Ошибка', (error as Error).message);
    }
  };

  const presentHomeworkFormSheet = useCallback(() => {
    if (homeworkFormVisible) {
      homeworkClosingRef.current = false;
      homeworkSheetTranslateY.stopAnimation();
      homeworkSheetTranslateY.setValue(0);
      return;
    }
    homeworkClosingRef.current = false;
    homeworkSheetTranslateY.stopAnimation();
    homeworkSheetTranslateY.setValue(0);
    setHomeworkFormVisible(true);
  }, [homeworkFormVisible, homeworkSheetTranslateY]);

  const openHomeworkModalForLesson = (
    lesson: Lesson,
    homeworkId?: string,
    options?: { preserveDraft?: boolean },
  ) => {
    if (!homeworkId && !canAssignHomeworkForSubject(lesson.subject)) {
      Alert.alert('Предмет недоступен', 'Выберите предмет из списка в профиле, чтобы дать задание.');
      return;
    }
    const preserveDraft = options?.preserveDraft ?? false;
    const existing = snapshot.homework.find((entry) =>
      homeworkId ? entry.id === homeworkId : entry.lesson_id === lesson.id,
    );
    const parsed = existing ? parseHomeworkText(existing.text) : null;

    const todayInput = toJerusalemDateInput(new Date().toISOString());
    const givenInput = normalizeDateInput(existing?.assigned_date ?? parsed?.given, todayInput);
    const dueCandidate = normalizeDateInput(
      existing?.due_date ?? parsed?.due,
      defaultHomeworkDueDateForClass(lesson.class_id, givenInput),
    );
    const dueInput = isBeforeDateInput(dueCandidate, todayInput) ? todayInput : dueCandidate;
    const existingImage = existing?.attachments.find((entry) => isImageAttachment(entry)) ?? null;
    const existingAudio = existing?.attachments.find((entry) => isAudioAttachment(entry)) ?? null;

    if (!preserveDraft) {
      setHomeworkDraftText(parsed?.body ?? '');
      setHomeworkPhotoUri(existingImage);
      setHomeworkAudioUri(existingAudio);
      setHomeworkAudioTranscript(existing?.ocr_raw_text ?? '');
      setHomeworkGivenDate(givenInput);
      setHomeworkDueDate(dueInput);
      setHomeworkDueMonthCursor(monthCursorFromDateInput(dueInput));
      setHomeworkCalendarTarget('due');
      setHomeworkDuePickerVisible(false);
      setHomeworkSubmitting(false);
    } else if (!homeworkPhotoUri && existing?.attachments[0]) {
      if (existingImage) {
        setHomeworkPhotoUri(existingImage);
      }
      if (existingAudio) {
        setHomeworkAudioUri(existingAudio);
      }
    }

    setHomeworkClassTaskMode(false);
    setHomeworkSubjectDraft(lesson.subject);
    setEditingHomeworkId(existing?.id);
    setHomeworkClassId(lesson.class_id);
    setSelectedLesson(lesson);
    setLessonActionsVisible(false);
    void stopHomeworkAudioPlayback();
    setHomeworkAudioPlaying(false);
    setHomeworkPhotoBusy(false);
    setHomeworkSpeechBusy(false);
    setHomeworkSubmitSuccess(false);
    setHomeworkInputAutoGrowEnabled(false);
    homeworkScrollOffsetYRef.current = 0;
    homeworkClosingRef.current = false;
    presentHomeworkFormSheet();
  };

  const openHomeworkModalForClassTask = (classId: string) => {
    const resolvedClassId = classId || homeworkClassId || selectedLesson?.class_id || user.class_ids[0] || '';
    const todayInput = toJerusalemDateInput(new Date().toISOString());
    const anchorLesson = resolvedClassId
      ? getClassHomeworkAnchorLesson(resolvedClassId, selectedLesson?.id, selectedLesson?.subject)
      : null;
    setHomeworkClassTaskMode(true);
    setHomeworkSubjectDraft('');
    setHomeworkClassId(resolvedClassId);
    setEditingHomeworkId(undefined);
    setHomeworkDraftText('');
    setHomeworkPhotoUri(null);
    setHomeworkAudioUri(null);
    setHomeworkAudioTranscript('');
    setHomeworkGivenDate(todayInput);
    const defaultDue = normalizeDateInput(
      resolvedClassId ? defaultHomeworkDueDateForClass(resolvedClassId, todayInput) : addDaysToDateInput(todayInput, 1),
      addDaysToDateInput(todayInput, 1),
    );
    setHomeworkDueDate(defaultDue);
    setHomeworkDueMonthCursor(monthCursorFromDateInput(defaultDue));
    setHomeworkCalendarTarget('due');
    setHomeworkDuePickerVisible(false);
    setSelectedLesson(anchorLesson ?? null);
    void stopHomeworkAudioPlayback();
    setHomeworkAudioPlaying(false);
    setHomeworkPhotoBusy(false);
    setHomeworkSpeechBusy(false);
    setHomeworkSubmitSuccess(false);
    setHomeworkInputAutoGrowEnabled(false);
    homeworkScrollOffsetYRef.current = 0;
    homeworkClosingRef.current = false;
    presentHomeworkFormSheet();
  };

  const onHomeworkClassChange = (classId: string) => {
    setHomeworkClassId(classId);
    const anchorLesson =
      homeworkSubjectDraft
        ? getHomeworkLessonBySubject(homeworkSubjectDraft, classId)
        : getClassHomeworkAnchorLesson(classId, selectedLesson?.id, selectedLesson?.subject || homeworkSubjectDraft);
    if (anchorLesson) {
      setSelectedLesson(anchorLesson);
    } else if (homeworkClassTaskMode || Boolean(homeworkSubjectDraft)) {
      setSelectedLesson(null);
    }
    if (!editingHomeworkId) {
      const defaultDue = defaultHomeworkDueDateForClass(classId, homeworkGivenDate);
      setHomeworkDueDate(defaultDue);
      setHomeworkDueMonthCursor(monthCursorFromDateInput(defaultDue));
    }
  };

  const onHomeworkSubjectChange = (subject: string) => {
    const normalized = subject.trim();
    setHomeworkSubjectDraft(normalized);
    setHomeworkClassTaskMode(false);
    const classId = homeworkClassId || selectedLesson?.class_id || user.class_ids[0] || '';
    const anchorLesson = classId ? getHomeworkLessonBySubject(normalized, classId) : null;
    if (anchorLesson) {
      setSelectedLesson(anchorLesson);
      if (!homeworkClassId) {
        setHomeworkClassId(anchorLesson.class_id);
      }
    } else {
      setSelectedLesson(null);
    }
    if (!editingHomeworkId && classId) {
      const defaultDue = defaultHomeworkDueDateForClass(classId, homeworkGivenDate);
      setHomeworkDueDate(defaultDue);
      setHomeworkDueMonthCursor(monthCursorFromDateInput(defaultDue));
    }
  };

  const onHomeworkDraftTextChange = (value: string) => {
    setHomeworkDraftText(value);
    if (!homeworkInputAutoGrowEnabled && value.trim().length > 0) {
      setHomeworkInputAutoGrowEnabled(true);
    }
    if (value.length === 0) {
      setHomeworkInputHeight(HOMEWORK_INPUT_MIN_HEIGHT);
    }
  };

  const minHomeworkDueDateInput = useMemo(
    () => maxDateInput(homeworkGivenDate, toJerusalemDateInput(new Date().toISOString())),
    [homeworkGivenDate],
  );

  const nextLessonDuePreset = useMemo(() => {
    const classId = homeworkClassId || selectedLesson?.class_id || user.class_ids[0] || '';
    if (!classId) {
      return minHomeworkDueDateInput;
    }
    const nextValue = defaultHomeworkDueDateForClass(classId, homeworkGivenDate);
    return maxDateInput(nextValue, minHomeworkDueDateInput);
  }, [defaultHomeworkDueDateForClass, homeworkClassId, homeworkGivenDate, minHomeworkDueDateInput, selectedLesson, user.class_ids]);

  const homeworkDueMonthLabel = useMemo(() => {
    const parts = homeworkDueMonthCursor.match(/^(\d{4})-(\d{2})$/);
    if (!parts) {
      return '';
    }
    const year = Number.parseInt(parts[1], 10);
    const month = Number.parseInt(parts[2], 10);
    const date = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
    return new Intl.DateTimeFormat('ru-RU', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }, [homeworkDueMonthCursor]);

  const homeworkDueCalendarCells = useMemo(
    () => buildMonthDateCells(homeworkDueMonthCursor),
    [homeworkDueMonthCursor],
  );

  const openHomeworkDuePicker = (target: 'given' | 'due') => {
    Keyboard.dismiss();
    if (homeworkDuePickerVisible && homeworkCalendarTarget === target) {
      setHomeworkDuePickerVisible(false);
      return;
    }
    setHomeworkCalendarTarget(target);
    const todayInput = toJerusalemDateInput(new Date().toISOString());
    const activeDate = target === 'given' ? homeworkGivenDate : homeworkDueDate;
    const safeDate = normalizeDateInput(activeDate, todayInput);
    setHomeworkDueMonthCursor(monthCursorFromDateInput(safeDate));
    setHomeworkDuePickerVisible(true);
  };

  const scrollHomeworkInputIntoView = useCallback((animated = true) => {
    const targetY = Math.max(0, homeworkInputAnchorYRef.current - 120 + HOMEWORK_INPUT_SCROLL_GAP);
    requestAnimationFrame(() => {
      homeworkScrollRef.current?.scrollTo({
        y: targetY,
        animated,
      });
    });
  }, []);

  useEffect(() => {
    if (!homeworkFormVisible) {
      setHomeworkKeyboardInset(0);
      return;
    }
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onKeyboardShow = (event: KeyboardEvent) => {
      if (!homeworkInputFocused) {
        return;
      }
      const keyboardHeight = Math.max(0, event.endCoordinates?.height ?? 0);
      setHomeworkKeyboardInset((current) =>
        Math.abs(current - keyboardHeight) < 2 ? current : keyboardHeight,
      );
      if (homeworkInputFocused) {
        setTimeout(() => {
          scrollHomeworkInputIntoView();
        }, Platform.OS === 'ios' ? 60 : 30);
      }
    };
    const onKeyboardHide = () => {
      setHomeworkKeyboardInset((current) => (current === 0 ? current : 0));
    };
    const showSubscription = Keyboard.addListener(showEvent, onKeyboardShow);
    const hideSubscription = Keyboard.addListener(hideEvent, onKeyboardHide);
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [homeworkFormVisible, homeworkInputFocused, scrollHomeworkInputIntoView]);

  const pickHomeworkPhotoFromCamera = async () => {
    if (homeworkPhotoBusy || homeworkSubmitting) {
      return;
    }
    setHomeworkPhotoBusy(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Нет доступа', 'Разрешите доступ к камере, чтобы добавить фото.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.4,
      });
      if (!result.canceled && result.assets.length > 0) {
        setHomeworkPhotoUri(result.assets[0].uri);
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось открыть камеру. Попробуйте еще раз.');
    } finally {
      setHomeworkPhotoBusy(false);
    }
  };

  const stopHomeworkAudioPlayback = async () => {
    if (!homeworkAudioSoundRef.current) {
      return;
    }
    try {
      await homeworkAudioSoundRef.current.stopAsync();
      await homeworkAudioSoundRef.current.unloadAsync();
    } catch {
      // ignored
    } finally {
      homeworkAudioSoundRef.current = null;
      setHomeworkAudioPlaying(false);
    }
  };

  const toggleHomeworkAudioPlayback = async () => {
    if (!homeworkAudioUri) {
      return;
    }
    if (homeworkAudioPlaying) {
      await stopHomeworkAudioPlayback();
      return;
    }
    await stopHomeworkAudioPlayback();
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: homeworkAudioUri },
        { shouldPlay: true },
        (status) => {
          if (!status.isLoaded) {
            setHomeworkAudioPlaying(false);
            return;
          }
          setHomeworkAudioPlaying(status.isPlaying);
          if (status.didJustFinish) {
            void stopHomeworkAudioPlayback();
          }
        },
      );
      homeworkAudioSoundRef.current = sound;
      setHomeworkAudioPlaying(true);
    } catch {
      Alert.alert('Ошибка', 'Не удалось воспроизвести аудио.');
      await stopHomeworkAudioPlayback();
    }
  };

  const appendAudioTranscriptToHomework = (transcript: string) => {
    const cleaned = transcript.trim();
    if (!cleaned) {
      return;
    }
    setHomeworkAudioTranscript(cleaned);
    setHomeworkDraftText((current) => (current.trim() ? `${current.trim()}\n${cleaned}` : cleaned));
  };

  const stopHomeworkSpeech = async (appendToDraft = true): Promise<string> => {
    const wasRecording = Boolean(nativeRecordingRef.current || webRecorderRef.current || speechRecognitionRef.current);

    if (speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop?.();
      } catch {
        // ignored
      }
      await new Promise((resolve) => setTimeout(resolve, 220));
      speechRecognitionRef.current = null;
    }

    if (nativeRecordingRef.current) {
      try {
        await nativeRecordingRef.current.stopAndUnloadAsync();
        const uri = nativeRecordingRef.current.getURI() ?? null;
        if (uri) {
          setHomeworkAudioUri(uri);
        }
      } catch {
        // ignored
      } finally {
        nativeRecordingRef.current = null;
      }
    }

    if (webRecorderRef.current) {
      const recorder = webRecorderRef.current;
      const uri = await Promise.race<string | null>([
        new Promise<string | null>((resolve) => {
          webRecorderStopResolveRef.current = resolve;
          try {
            recorder.stop();
          } catch {
            resolve(null);
          }
        }),
        new Promise<string | null>((resolve) => {
          setTimeout(() => resolve(null), 1800);
        }),
      ]);
      if (!uri) {
        try {
          webStreamRef.current?.getTracks().forEach((track: any) => track.stop());
        } catch {
          // ignored
        }
        webStreamRef.current = null;
        webRecorderRef.current = null;
        webRecorderStopResolveRef.current = null;
      }
      if (uri) {
        setHomeworkAudioUri(uri);
      }
    }

    let recognizedText = webSpeechTranscriptRef.current.trim();
    let appendedTranscript = '';
    if (wasRecording && (recognizedText || homeworkAudioTranscript.trim())) {
      if (!recognizedText && homeworkAudioTranscript.trim()) {
        recognizedText = homeworkAudioTranscript.trim();
      }
      if (appendToDraft) {
        appendAudioTranscriptToHomework(recognizedText);
      } else {
        setHomeworkAudioTranscript(recognizedText);
      }
      appendedTranscript = recognizedText;
    }

    webSpeechTranscriptRef.current = '';
    setHomeworkSpeechRecording(false);
    return appendedTranscript;
  };

  const startWebSpeechRecognition = (): boolean => {
    if (speechRecognitionRef.current) {
      return true;
    }
    const webApi = globalThis as typeof globalThis & {
      SpeechRecognition?: new () => any;
      webkitSpeechRecognition?: new () => any;
    };
    const RecognitionCtor = webApi.SpeechRecognition ?? webApi.webkitSpeechRecognition;
    if (!RecognitionCtor) {
      return false;
    }

    const recognition = new RecognitionCtor();
    recognition.lang = 'ru-RU';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results ?? [])
        .map((result: any) => result?.[0]?.transcript ?? '')
        .join(' ')
        .trim();
      if (!transcript) {
        return;
      }
      webSpeechTranscriptRef.current = transcript;
      setHomeworkAudioTranscript(transcript);
    };
    recognition.onerror = () => {
      speechRecognitionRef.current = null;
    };
    recognition.onend = () => {
      speechRecognitionRef.current = null;
    };

    try {
      speechRecognitionRef.current = recognition;
      recognition.start();
      return true;
    } catch {
      return false;
    }
  };

  const startHomeworkSpeech = async () => {
    if (homeworkSpeechRecording) {
      return;
    }
    webSpeechTranscriptRef.current = '';
    setHomeworkAudioTranscript('');
    await stopHomeworkAudioPlayback();
    setHomeworkAudioPlaying(false);

    if (Platform.OS !== 'web') {
      try {
        const permission = await Audio.requestPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Нет доступа', 'Разрешите доступ к микрофону.');
          return;
        }
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
        });
        if (nativeRecordingRef.current) {
          await nativeRecordingRef.current.stopAndUnloadAsync().catch(() => undefined);
          nativeRecordingRef.current = null;
        }
        const recording = new Audio.Recording();
        await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        await recording.startAsync();
        nativeRecordingRef.current = recording;
        setHomeworkSpeechRecording(true);
      } catch {
        setHomeworkSpeechRecording(false);
        Alert.alert('Ошибка', 'Не удалось начать запись аудио.');
      }
      return;
    }

    const speechRecognitionStarted = startWebSpeechRecognition();

    const mediaDevices = (globalThis as any).navigator?.mediaDevices;
    const MediaRecorderCtor = (globalThis as any).MediaRecorder;
    if (!mediaDevices?.getUserMedia || !MediaRecorderCtor) {
      if (!speechRecognitionStarted) {
        Alert.alert('Недоступно', 'В этом браузере нельзя записать аудио.');
      }
      return;
    }

    try {
      const stream = await mediaDevices.getUserMedia({ audio: true });
      const supportedTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/aac',
      ];
      const mimeType = supportedTypes.find((type) => (MediaRecorderCtor.isTypeSupported?.(type) ?? false)) ?? '';
      const recorder = mimeType ? new MediaRecorderCtor(stream, { mimeType }) : new MediaRecorderCtor(stream);
      webRecorderChunksRef.current = [];
      recorder.ondataavailable = (event: any) => {
        if (event.data && event.data.size > 0) {
          webRecorderChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        let resultUri: string | null = null;
        try {
          const blob = new Blob(webRecorderChunksRef.current, {
            type: recorder.mimeType || 'audio/webm',
          });
          if (blob.size > 0) {
            resultUri = URL.createObjectURL(blob);
            generatedWebAudioUrlsRef.current.push(resultUri);
          }
        } catch {
          resultUri = null;
        }
        webRecorderChunksRef.current = [];
        webRecorderRef.current = null;
        webStreamRef.current?.getTracks().forEach((track: any) => track.stop());
        webStreamRef.current = null;
        webRecorderStopResolveRef.current?.(resultUri);
        webRecorderStopResolveRef.current = null;
      };
      recorder.start();
      webRecorderRef.current = recorder;
      webStreamRef.current = stream;
      if (!speechRecognitionRef.current) {
        startWebSpeechRecognition();
      }
      setHomeworkSpeechRecording(true);
    } catch {
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop?.();
        } catch {
          // ignored
        }
        speechRecognitionRef.current = null;
      }
      setHomeworkSpeechRecording(false);
      Alert.alert('Ошибка', 'Не удалось начать запись аудио.');
    }
  };

  const finalizeCloseHomeworkFormSheet = useCallback(() => {
    if (homeworkSubmitSuccessTimer.current) {
      clearTimeout(homeworkSubmitSuccessTimer.current);
      homeworkSubmitSuccessTimer.current = null;
    }
    Keyboard.dismiss();
    void stopHomeworkSpeech(false);
    void stopHomeworkAudioPlayback();
    setHomeworkDuePickerVisible(false);
    setHomeworkFormVisible(false);
    setHomeworkSubmitSuccess(false);
    setHomeworkInputFocused(false);
    setHomeworkKeyboardInset(0);
    setHomeworkInputHeight(HOMEWORK_INPUT_MIN_HEIGHT);
    setHomeworkInputAutoGrowEnabled(false);
    setHomeworkPhotoBusy(false);
    setHomeworkSpeechBusy(false);
    setHomeworkSubjectDraft('');
    homeworkScrollOffsetYRef.current = 0;
    homeworkClosingRef.current = false;
  }, [homeworkSheetTranslateY]);

  const closeHomeworkFormSheet = useCallback(() => {
    if (!homeworkFormVisible) {
      return;
    }
    if (homeworkClosingRef.current) {
      return;
    }
    homeworkClosingRef.current = true;
    Keyboard.dismiss();
    homeworkSheetTranslateY.stopAnimation();
    Animated.timing(homeworkSheetTranslateY, {
      toValue: 420,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      finalizeCloseHomeworkFormSheet();
    });
  }, [finalizeCloseHomeworkFormSheet, homeworkFormVisible, homeworkSheetTranslateY]);

  const homeworkSheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_evt, gesture) =>
          homeworkFormVisible && gesture.dy > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_evt, gesture) => {
          if (gesture.dy > 0) {
            homeworkSheetTranslateY.setValue(Math.min(gesture.dy, 420));
          }
        },
        onPanResponderRelease: (_evt, gesture) => {
          if (gesture.dy > 56 || gesture.vy > 0.8) {
            closeHomeworkFormSheet();
            return;
          }
          Animated.spring(homeworkSheetTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 120,
            friction: 14,
          }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(homeworkSheetTranslateY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 120,
            friction: 14,
          }).start();
        },
      }),
    [closeHomeworkFormSheet, homeworkFormVisible, homeworkSheetTranslateY],
  );

  const pickProfilePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Нет доступа', 'Разрешите доступ к фото.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
      aspect: [1, 1],
      base64: true,
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }

    try {
      const asset = result.assets[0];
      const stableUri =
        asset.base64 && asset.mimeType
          ? `data:${asset.mimeType};base64,${asset.base64}`
          : asset.base64
            ? `data:image/jpeg;base64,${asset.base64}`
            : asset.uri;
      await onUpdateProfilePhoto(stableUri);
      Alert.alert('Готово', 'Фото профиля обновлено.');
    } catch (error) {
      Alert.alert('Ошибка', (error as Error).message);
    }
  };

  const persistHomeroom = async (enabled: boolean, classId: string) => {
    if (!classId) {
      Alert.alert('Ошибка', 'Выберите класс.');
      return;
    }
    setHomeroomSaving(true);
    try {
      await onAssignHomeroom(user.id, classId, enabled);
      setHomeroomOptIn(enabled);
      setHomeroomClassId(classId);
    } catch (error) {
      Alert.alert('Ошибка', (error as Error).message);
    } finally {
      setHomeroomSaving(false);
    }
  };

  const toggleHomeroom = () => {
    const nextEnabled = !homeroomOptIn;
    const targetClass = homeroomClassId || user.class_ids[0] || '';
    void persistHomeroom(nextEnabled, targetClass);
  };

  const normalizedTeachingDraft = useMemo(
    () => normalizeSubjectNames(teachingSubjectsDraft),
    [teachingSubjectsDraft],
  );

  const teachingSubjectsDirty = useMemo(() => {
    return normalizedTeachingDraft.join('||') !== inferredTeachingSubjects.join('||');
  }, [inferredTeachingSubjects, normalizedTeachingDraft]);

  const addTeachingSubject = (subject: string) => {
    const value = subject.trim();
    if (!value) {
      return;
    }
    if (normalizedTeachingDraft.includes(value)) {
      return;
    }
    setTeachingSubjectsDraft((current) => [...current, value]);
  };

  const addCustomTeachingSubject = () => {
    const value = subjectOtherInput.trim();
    if (!value) {
      return;
    }
    addTeachingSubject(value);
    setSubjectOtherInput('');
  };

  const removeTeachingSubject = (subject: string) => {
    const next = normalizeSubjectNames(teachingSubjectsDraft.filter((entry) => entry !== subject));
    if (next.length === 0) {
      Alert.alert('Минимум один предмет', 'Оставьте хотя бы один предмет в списке.');
      return;
    }
    const nowMs = Date.now();
    const blockedLessons = teacherLessons
      .filter((lesson) => lesson.subject.trim() === subject)
      .filter((lesson) => lesson.status !== 'canceled')
      .filter((lesson) => new Date(lesson.start_datetime).getTime() > nowMs);
    if (blockedLessons.length > 0) {
      const dates = Array.from(
        new Set(blockedLessons.map((lesson) => dateInputLabel(toJerusalemDateInput(lesson.start_datetime)))),
      );
      Alert.alert(
        'Сначала измените расписание',
        `По предмету "${subject}" есть будущие уроки: ${dates.slice(0, 6).join(', ')}${
          dates.length > 6 ? ', ...' : ''
        }. Сначала замените или удалите эти уроки в расписании.`,
      );
      return;
    }
    setTeachingSubjectsDraft(next);
  };

  const toggleTeachingSubject = (subject: string) => {
    if (normalizedTeachingDraft.includes(subject)) {
      removeTeachingSubject(subject);
      return;
    }
    addTeachingSubject(subject);
  };

  const saveTeachingSubjects = async () => {
    const nextSubjects = normalizeSubjectNames(teachingSubjectsDraft);
    if (nextSubjects.length === 0) {
      Alert.alert('Ошибка', 'Добавьте хотя бы один предмет.');
      return;
    }
    setTeachingSubjectsSaving(true);
    try {
      await onUpdateTeachingSubjects(user.id, nextSubjects);
      Alert.alert('Готово', 'Список предметов сохранён.');
    } catch (error) {
      Alert.alert('Не удалось сохранить', (error as Error).message);
    } finally {
      setTeachingSubjectsSaving(false);
    }
  };

  const saveProfileInfo = async () => {
    const name = profileNameDraft.trim();
    if (!name) {
      Alert.alert('Ошибка', 'Введите имя и фамилию.');
      return;
    }
    const email = profileEmailDraft.trim();
    const phone = profilePhoneDraft.trim();
    setProfileSaving(true);
    try {
      await onUpdateProfile({
        name,
        email: email ? email : null,
        phone: phone ? phone : null,
      });
      Alert.alert('Готово', 'Профиль обновлён.');
    } catch (error) {
      Alert.alert('Ошибка', (error as Error).message);
    } finally {
      setProfileSaving(false);
    }
  };

  const resetHomeworkFormAfterSubmit = () => {
    const todayInput = toJerusalemDateInput(new Date().toISOString());
    const classId = homeworkClassId || selectedLesson?.class_id || user.class_ids[0] || '';
    const defaultDue = normalizeDateInput(
      classId ? defaultHomeworkDueDateForClass(classId, todayInput) : addDaysToDateInput(todayInput, 1),
      addDaysToDateInput(todayInput, 1),
    );

    setHomeworkDraftText('');
    setHomeworkPhotoUri(null);
    setHomeworkAudioUri(null);
    setHomeworkAudioTranscript('');
    setHomeworkAudioPlaying(false);
    setHomeworkGivenDate(todayInput);
    setHomeworkDueDate(defaultDue);
    setHomeworkDueMonthCursor(monthCursorFromDateInput(defaultDue));
    setHomeworkDuePickerVisible(false);
    setEditingHomeworkId(undefined);
    setHomeworkInputHeight(HOMEWORK_INPUT_MIN_HEIGHT);
    setHomeworkInputAutoGrowEnabled(false);
    setHomeworkInputFocused(false);
    setHomeworkPhotoBusy(false);
    setHomeworkSpeechBusy(false);
    if (homeworkClassTaskMode) {
      setHomeworkSubjectDraft('');
      setSelectedLesson(null);
    } else {
      const currentSubject = homeworkSubjectDraft || selectedLesson?.subject || '';
      const anchorLesson = classId
        ? getHomeworkLessonBySubject(currentSubject, classId) ??
          getClassHomeworkAnchorLesson(classId, selectedLesson?.id, currentSubject)
        : null;
      if (anchorLesson) {
        setSelectedLesson(anchorLesson);
        setHomeworkSubjectDraft(anchorLesson.subject);
      }
    }
    homeworkScrollRef.current?.scrollTo({ y: 0, animated: true });
  };

  const submitHomeworkForLesson = async () => {
    if (homeworkSubmitting || homeworkSubmitSuccess) {
      return;
    }
    let transcriptFromRecording = '';
    if (homeworkSpeechRecording) {
      transcriptFromRecording = await stopHomeworkSpeech(false);
    }
    if (!homeworkClassId) {
      Alert.alert('Ошибка', 'Выберите класс для задания.');
      return;
    }

    const minimumDueDate = maxDateInput(homeworkGivenDate, toJerusalemDateInput(new Date().toISOString()));
    if (isBeforeDateInput(homeworkDueDate, minimumDueDate)) {
      Alert.alert('Ошибка дат', 'Нельзя поставить срок сдачи в прошедшую дату.');
      return;
    }

    if (diffDays(homeworkGivenDate, homeworkDueDate) < 0) {
      Alert.alert('Ошибка дат', 'Срок сдачи не может быть раньше даты выдачи.');
      return;
    }

    const draftBaseText = homeworkDraftText.trim();
    const transcriptText = transcriptFromRecording.trim();
    const finalText = transcriptText
      ? draftBaseText
        ? `${draftBaseText}\n${transcriptText}`
        : transcriptText
      : draftBaseText;
    if (finalText && finalText !== homeworkDraftText) {
      setHomeworkDraftText(finalText);
    }

    if (!finalText) {
      Alert.alert('Пустое задание', 'Добавьте текст задания.');
      return;
    }

    const text = finalText;
    const existingHomework = editingHomeworkId
      ? snapshot.homework.find((entry) => entry.id === editingHomeworkId)
      : undefined;
    const attachments: string[] = [];
    let preparedPhotoUri = homeworkPhotoUri;
    if (preparedPhotoUri) {
      preparedPhotoUri = await compressLargeDataImage(preparedPhotoUri);
      if (preparedPhotoUri.length > 1_800_000) {
        Alert.alert('Фото слишком большое', 'Уменьшите размер фото и отправьте задание снова.');
        return;
      }
      attachments.push(preparedPhotoUri);
      if (preparedPhotoUri !== homeworkPhotoUri) {
        setHomeworkPhotoUri(preparedPhotoUri);
      }
    }
    if (homeworkAudioUri) {
      attachments.push(homeworkAudioUri);
    }
    if (attachments.length === 0 && existingHomework) {
      attachments.push(...existingHomework.attachments);
    }
    const transcript = (transcriptFromRecording || homeworkAudioTranscript).trim();
    const anchorLesson =
      selectedLesson && selectedLesson.class_id === homeworkClassId
        ? selectedLesson
        : getClassHomeworkAnchorLesson(
            homeworkClassId,
            selectedLesson?.id,
            selectedLesson?.subject || homeworkSubjectDraft,
          );
    if (!anchorLesson) {
      Alert.alert('Нет уроков', 'Для выбранного класса нет уроков, добавьте урок и попробуйте снова.');
      return;
    }

    const submitKey = JSON.stringify({
      lessonId: anchorLesson.id,
      classId: homeworkClassId,
      given: homeworkGivenDate,
      due: homeworkDueDate,
      text,
      attachments,
      editId: editingHomeworkId ?? null,
    });
    if (lastHomeworkSubmitKeyRef.current === submitKey) {
      Alert.alert('Уже отправлено', 'Это задание уже отправлено. Измените текст, даты или вложения.');
      return;
    }

    setHomeworkSubmitting(true);
    try {
      await onSaveHomework({
        homeworkId: editingHomeworkId,
        lessonId: anchorLesson.id,
        assignedDate: homeworkGivenDate,
        dueDate: homeworkDueDate,
        text,
        attachments,
        source: transcript ? 'photo_ocr' : 'manual',
        ocrRawText: transcript || null,
      });
      lastHomeworkSubmitKeyRef.current = submitKey;
      await stopHomeworkAudioPlayback();
      queueClassNotifications(
        anchorLesson.class_id,
        `Новое домашнее задание: ${homeworkClassTaskMode ? 'Задание для класса' : lessonDisplaySubject(anchorLesson)}`,
      );
      setHomeworkSubmitSuccess(true);
      if (homeworkSubmitSuccessTimer.current) {
        clearTimeout(homeworkSubmitSuccessTimer.current);
      }
      await new Promise<void>((resolve) => {
        homeworkSubmitSuccessTimer.current = setTimeout(() => {
          setHomeworkSubmitSuccess(false);
          homeworkSubmitSuccessTimer.current = null;
          resolve();
        }, 1000);
      });
      resetHomeworkFormAfterSubmit();
    } catch (error) {
      setHomeworkSubmitSuccess(false);
      Alert.alert('Не удалось добавить задание', (error as Error).message);
    } finally {
      setHomeworkSubmitting(false);
    }
  };

  const markParentMessageRead = async (message: ParentMessageItem) => {
    try {
      await onMarkRead(message.threadId);
      setForcedUnreadParentMessageIds((current) => current.filter((entry) => entry !== message.id));
    } catch (error) {
      Alert.alert('Ошибка', (error as Error).message);
    }
  };

  const markBirthdayMessageRead = async (message: BirthdayMessageItem) => {
    if (!message.isIncoming || message.isRead) {
      return;
    }
    try {
      await onMarkRead(message.threadId);
    } catch (error) {
      Alert.alert('Ошибка', (error as Error).message);
    }
  };

  const deleteHomeworkEntry = async () => {
    if (!editingHomeworkId) {
      return;
    }
    try {
      await onDeleteHomework(editingHomeworkId);
      setHomeworkFormVisible(false);
      setEditingHomeworkId(undefined);
      setHomeworkPhotoUri(null);
      setHomeworkAudioUri(null);
      setHomeworkAudioTranscript('');
      await stopHomeworkAudioPlayback();
      void stopHomeworkSpeech(false);
      Alert.alert('Готово', 'Домашнее задание удалено.');
    } catch (error) {
      Alert.alert('Ошибка', (error as Error).message);
    }
  };

  const markParentMessageUnread = (messageId: string) => {
    setForcedUnreadParentMessageIds((current) =>
      current.includes(messageId) ? current : [...current, messageId],
    );
  };

  const openReplyModal = (message: ParentMessageItem) => {
    setSelectedParentMessage(message);
    setReplyText('');
    setReplyModalVisible(true);
  };

  const sendReplyToParent = async () => {
    if (!selectedParentMessage || !replyText.trim()) {
      return;
    }
    try {
      await onSendDirectMessage({
        targetUserId: selectedParentMessage.senderId,
        text: replyText.trim(),
        attachments: [],
      });
      await markParentMessageRead(selectedParentMessage);
      setReplyModalVisible(false);
      setReplyText('');
      setSelectedParentMessage(null);
    } catch (error) {
      Alert.alert('Ошибка отправки', (error as Error).message);
    }
  };

  const openAbsenceModalForLesson = (lesson: Lesson) => {
    const students = snapshot.users.filter(
      (entry) => entry.role_id === 5 && entry.class_ids.includes(lesson.class_id),
    );
    const initialDraft: Record<string, boolean> = {};
    for (const student of students) {
      const existing = snapshot.student_lesson_records.find(
        (entry) => entry.lesson_id === lesson.id && entry.student_id === student.id,
      );
      initialDraft[student.id] = existing?.absent ?? false;
    }
    setSelectedLesson(lesson);
    setAbsenceDraft(initialDraft);
    setLessonActionsVisible(false);
    setAbsenceModalVisible(true);
  };

  const saveAbsenceMarks = async () => {
    if (!selectedLesson) {
      return;
    }
    const students = snapshot.users.filter(
      (entry) => entry.role_id === 5 && entry.class_ids.includes(selectedLesson.class_id),
    );
    try {
      await Promise.all(
        students.map((student) =>
          onSaveStudentRecord({
            lessonId: selectedLesson.id,
            studentId: student.id,
            absent: Boolean(absenceDraft[student.id]),
            remark: null,
            grade: null,
          }),
        ),
      );
      setAbsenceModalVisible(false);
      queueClassNotifications(selectedLesson.class_id, `Обновлена отметка посещаемости: ${selectedLesson.subject}`);
      Alert.alert('Готово', 'Отсутствующие отмечены.');
    } catch (error) {
      Alert.alert('Ошибка', (error as Error).message);
    }
  };

  const openLessonSummaryModal = (lesson: Lesson) => {
    const existing = snapshot.lesson_reports.find((entry) => entry.lesson_id === lesson.id);
    setSelectedLesson(lesson);
    setLessonSummaryDraft(existing?.summary_text ?? '');
    setLessonSummarySaving(false);
    setLessonActionsVisible(false);
    setLessonSummaryVisible(true);
  };

  const saveLessonSummary = async () => {
    if (!selectedLesson || lessonSummarySaving) {
      return;
    }
    setLessonSummarySaving(true);
    try {
      await onSaveLessonReport({
        lessonId: selectedLesson.id,
        summaryText: lessonSummaryDraft.trim(),
        audioTranscript: null,
      });
      setLessonSummaryVisible(false);
      queueClassNotifications(selectedLesson.class_id, `Добавлено описание урока: ${selectedLesson.subject}`);
      Alert.alert('Готово', 'Описание урока сохранено.');
    } catch (error) {
      Alert.alert('Ошибка', (error as Error).message);
    } finally {
      setLessonSummarySaving(false);
    }
  };

  const deleteLessonFromSchedule = async (lesson: Lesson) => {
    if (lessonDeleting) {
      return;
    }
    if (!onDeleteLesson) {
      Alert.alert('Недоступно', 'Удаление урока сейчас недоступно.');
      return;
    }
    setLessonDeleting(true);
    try {
      await onDeleteLesson(lesson.id);
      setLessonActionsVisible(false);
      setSelectedLesson(null);
      setLessonVisualState((current) => {
        const next = { ...current };
        delete next[lesson.id];
        return next;
      });
      Alert.alert('Готово', 'Урок удалён из расписания.');
    } catch (error) {
      Alert.alert('Ошибка', (error as Error).message);
    } finally {
      setLessonDeleting(false);
    }
  };

  const markLessonCanceled = (lesson: Lesson) => {
    setLessonVisualState((current) => ({
      ...current,
      [lesson.id]: {
        kind: 'canceled',
        note: 'Отмена',
      },
    }));
    setLessonActionsVisible(false);
    queueClassNotifications(lesson.class_id, `Урок "${lesson.subject}" отменен.`);
  };

  const markLessonReplaced = (lesson: Lesson) => {
    setLessonVisualState((current) => ({
      ...current,
      [lesson.id]: {
        kind: 'replaced',
        note: 'Замена',
      },
    }));
    setLessonActionsVisible(false);
    queueClassNotifications(lesson.class_id, `В уроке "${lesson.subject}" назначена замена.`);
  };

  const revertLessonVisualState = (lesson: Lesson) => {
    setLessonVisualState((current) => {
      const next = { ...current };
      delete next[lesson.id];
      return next;
    });
    setLessonActionsVisible(false);
    queueClassNotifications(lesson.class_id, `Изменение по уроку "${lesson.subject}" отменено.`);
  };

  const openReplacementPicker = (lesson: Lesson) => {
    setSelectedLesson(lesson);
    setLessonActionsVisible(false);
    setReplacementPickerVisible(true);
  };

  const applyReplacement = (targetLesson: Lesson) => {
    if (!selectedLesson) {
      return;
    }
    setLessonVisualState((current) => ({
      ...current,
      [selectedLesson.id]: {
        kind: 'replaced',
        note: `Замена на "${targetLesson.subject}"`,
      },
    }));
    setReplacementPickerVisible(false);
    queueClassNotifications(
      selectedLesson.class_id,
      `Урок "${selectedLesson.subject}" заменен на "${targetLesson.subject}".`,
    );
  };

  const sendDirectMessage = async () => {
    if (!directTargetUserId || !directMessageText.trim()) {
      return;
    }
    try {
      await onSendDirectMessage({
        targetUserId: directTargetUserId,
        text: directMessageText.trim(),
        attachments: [],
      });
      setDirectMessageText('');
      setDirectTargetUserId('');
      setDirectMessageVisible(false);
      Alert.alert('Готово', 'Сообщение отправлено.');
    } catch (error) {
      Alert.alert('Ошибка отправки', (error as Error).message);
    }
  };

  const pickSuggestionMedia = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Нет доступа', 'Разрешите доступ к фото.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets.length > 0) {
      setSuggestionPhotoUri(result.assets[0].uri);
    }
  };

  const takeSuggestionPhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Нет доступа', 'Разрешите доступ к камере.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.7,
    });
    if (!result.canceled && result.assets.length > 0) {
      setSuggestionPhotoUri(result.assets[0].uri);
    }
  };

  const saveLesson = async () => {
    const selectedSubject =
      draft.subject === CUSTOM_SUBJECT_VALUE ? draft.customSubject.trim() : draft.subject.trim();
    const requiresRoom = draft.type !== 'holiday';
    const roomValue = requiresRoom ? draft.room.trim() : '—';
    const isAllDay = draft.type === 'holiday';

    if (!draft.classId || !selectedSubject || (requiresRoom && !roomValue)) {
      Alert.alert(
        'Незаполненные поля',
        requiresRoom
          ? 'Выберите класс, наименование и кабинет/место.'
          : 'Выберите класс и наименование.',
      );
      return;
    }

    const fallbackDateInput = selectedScheduleDateInput || toJerusalemDateInput(new Date().toISOString());
    const baseDateInput = normalizeDateInput(draft.dateInput, fallbackDateInput);
    const dateInput = normalizeDateInput(
      dateInputForDayInSameWeek(baseDateInput, draft.dayIndex),
      fallbackDateInput,
    );
    const startTime = isAllDay ? '00:00' : draft.startTime;
    const endTime = isAllDay ? '23:59' : draft.endTime;
    let startDatetime = fromJerusalemDateTime(dateInput, startTime);
    let endDatetime = fromJerusalemDateTime(dateInput, endTime);
    if (!startDatetime || !endDatetime) {
      startDatetime = fallbackIsoFromDateTimeInput(dateInput, startTime);
      endDatetime = fallbackIsoFromDateTimeInput(dateInput, endTime);
    }

    if (!startDatetime || !endDatetime) {
      Alert.alert(
        'Некорректное время',
        `Не удалось распознать: ${dateInput}, ${startTime}–${endTime}. Выберите интервал из списка.`,
      );
      return;
    }

    const startMs = new Date(startDatetime).getTime();
    const endMs = new Date(endDatetime).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      Alert.alert('Некорректное время', 'Не удалось распознать время урока. Выберите интервал снова.');
      return;
    }
    if (endMs <= startMs) {
      Alert.alert('Некорректный интервал', 'Время окончания должно быть позже времени начала.');
      return;
    }
    const dayLessons = lessonsByDate.get(dateInput) ?? [];
    const shouldCheckConflict = draft.type !== 'holiday';
    const conflict = shouldCheckConflict
      ? dayLessons.find((lesson) => {
          if (lesson.id === draft.lessonId) {
            return false;
          }
          if (lessonVisualState[lesson.id]?.kind === 'canceled') {
            return false;
          }
          const lessonStart = new Date(lesson.start_datetime).getTime();
          const lessonEnd = new Date(lesson.end_datetime).getTime();
          return startMs < lessonEnd && endMs > lessonStart;
        })
      : undefined;

    const savePayload = async (lessonId?: string) => {
      await onSaveLesson({
        lessonId,
        classId: draft.classId,
        subject: selectedSubject,
        room: roomValue,
        startDatetime,
        endDatetime,
        type: draft.type,
      });
      setAddLessonVisible(false);
      setDraft(emptyLessonDraft(user.class_ids[0] ?? ''));
      queueClassNotifications(
        draft.classId,
        `Изменение в расписании: ${selectedSubject} (${isAllDay ? 'весь день' : draft.startTime}).`,
      );
      Alert.alert('Готово', lessonId || draft.lessonId ? 'Урок обновлён.' : 'Урок добавлен.');
    };

    try {
      if (conflict) {
        Alert.alert(
          'Конфликт по времени',
          `На это время идёт "${conflict.subject}". Заменить на "${selectedSubject}"?`,
          [
            { text: 'Отмена', style: 'cancel' },
            {
              text: 'Заменить',
              style: 'destructive',
              onPress: () => {
                void savePayload(conflict.id);
              },
            },
          ],
        );
        return;
      }

      await savePayload(draft.lessonId);
    } catch (error) {
      Alert.alert('Не удалось сохранить урок', (error as Error).message);
    }
  };

  const setLessonDraftType = (type: LessonType) => {
    setDraft((entry) => {
      if (type === 'holiday') {
        return {
          ...entry,
          type,
          subject: CUSTOM_SUBJECT_VALUE,
          customSubject: entry.customSubject.trim() || 'Выходной',
          room: '—',
          startTime: '00:00',
          endTime: '23:59',
        };
      }
      if (type === 'event') {
        return {
          ...entry,
          type,
          subject: CUSTOM_SUBJECT_VALUE,
          customSubject: entry.customSubject.trim() || 'Мероприятие',
          room: entry.room === '—' ? 'Актовый зал' : entry.room,
          startTime: entry.startTime === '00:00' ? '08:00' : entry.startTime,
          endTime: entry.endTime === '23:59' ? '08:45' : entry.endTime,
        };
      }
      const firstSubject = subjects[0] ?? '';
      return {
        ...entry,
        type,
        subject: entry.subject === CUSTOM_SUBJECT_VALUE ? firstSubject : entry.subject,
        customSubject: entry.subject === CUSTOM_SUBJECT_VALUE ? '' : entry.customSubject,
        room: entry.room === '—' ? 'Кабинет 1' : entry.room,
        startTime: entry.startTime === '00:00' ? '08:00' : entry.startTime,
        endTime: entry.endTime === '23:59' ? '08:45' : entry.endTime,
      };
    });
  };

  const submitSuggestion = async () => {
    if (!suggestionDescription.trim()) {
      Alert.alert('Заполните форму', 'Добавьте текст предложения.');
      return;
    }

    const text = suggestionDescription.trim();
    setSubmittingSuggestion(true);
    try {
      await onCreateFeedback({
        text,
        category: 'equipment',
        visibilityRoles: visibilityRolesForSuggestionAudience(suggestionAudience),
        classId: selectedClassId ?? user.class_ids[0] ?? null,
      });

      Animated.parallel([
        Animated.timing(suggestionFlyY, {
          toValue: -360,
          duration: 360,
          useNativeDriver: true,
        }),
        Animated.timing(suggestionFlyOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setSuggestionSuccessVisible(true);
        Animated.parallel([
          Animated.spring(suggestionSuccessScale, {
            toValue: 1,
            useNativeDriver: true,
            friction: 6,
            tension: 80,
          }),
          Animated.timing(suggestionSuccessOpacity, {
            toValue: 1,
            duration: 260,
            useNativeDriver: true,
          }),
        ]).start();

        closeSuccessTimer.current = setTimeout(() => {
          closeSuggestionForm();
        }, 1400);
      });
    } catch (error) {
      Alert.alert('Не удалось отправить предложение', (error as Error).message);
    } finally {
      setSubmittingSuggestion(false);
    }
  };

  const renderLessonCard = (lesson: Lesson, index: number, withTransferFlag = false) => {
    const numberBg = LESSON_NUMBER_COLORS[index % LESSON_NUMBER_COLORS.length];
    const visualState = lessonVisualState[lesson.id];
    const startLabel = hhmm(lesson.start_datetime);
    const endLabel = hhmm(lesson.end_datetime);
    const now = Date.now();
    const startMs = new Date(lesson.start_datetime).getTime();
    const endMs = new Date(lesson.end_datetime).getTime();
    const isLive = now >= startMs && now <= endMs;
    const isCanceled = visualState?.kind === 'canceled';
    const isReplaced = visualState?.kind === 'replaced';
    const isHolidayType = lesson.type === 'holiday';
    const isEventType = lesson.type === 'event';
    const showTransfer = withTransferFlag && (lesson.status === 'changed' || isReplaced);
    const lessonHomeworkIds = homeworkByLessonId.get(lesson.id) ?? [];
    const latestLessonHomeworkId = lessonHomeworkIds[lessonHomeworkIds.length - 1];
    const hasHomework = lessonHomeworkIds.length > 0;
    return (
      <Pressable key={lesson.id} style={styles.lessonCard} onPress={() => onLessonPress(lesson)}>
        {showTransfer ? <View style={styles.changedAccent} /> : null}

        <View style={[styles.lessonOrderCircle, { backgroundColor: numberBg }]}>
          <Text style={styles.lessonOrderText}>{index + 1}</Text>
        </View>

        <View style={styles.lessonMainInfo}>
          <View style={styles.lessonSubjectRow}>
            <Text style={[styles.lessonSubject, isCanceled && styles.lessonSubjectCanceled]}>
              {isHolidayType ? `🏖️ ${lessonDisplaySubject(lesson)}` : isEventType ? `🎉 ${lessonDisplaySubject(lesson)}` : lessonDisplaySubject(lesson)}
            </Text>
            {isLive ? (
              <View style={styles.liveBadge}>
                <Text style={styles.liveBadgeText}>
                  {t(language, { ru: 'СЕЙЧАС', en: 'LIVE', he: 'חי' })}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.lessonSubMeta}>
            {isHolidayType
              ? t(language, { ru: 'Выходной / каникулы', en: 'Day off / holiday', he: 'יום חופשי / חופשה' })
              : isEventType
                ? `${className(snapshot, lesson.class_id, language)} · ${
                    lesson.room === '—'
                      ? t(language, { ru: 'Мероприятие', en: 'Event', he: 'אירוע' })
                      : localizeLessonRoom(lesson.room, language)
                  }`
                : `${className(snapshot, lesson.class_id, language)} · ${t(language, {
                    ru: 'Каб.',
                    en: 'Room',
                    he: 'חדר',
                  })} ${localizeLessonRoom(lesson.room, language)}`}
          </Text>
          {isCanceled ? (
            <Text style={styles.lessonCanceledText}>
              {t(language, { ru: 'Отмена урока', en: 'Lesson canceled', he: 'השיעור בוטל' })}
            </Text>
          ) : null}
          {showTransfer ? (
            <Text style={styles.changedText}>
              {visualState?.note
                ? visualState.note
                : t(language, {
                    ru: `Замена/перенос на ${startLabel}`,
                    en: `Rescheduled to ${startLabel}`,
                    he: `הועבר לשעה ${startLabel}`,
                  })}
            </Text>
          ) : null}

          {!isHolidayType
            ? hasHomework ? (
                <Pressable
                  style={styles.lessonHomeworkReadyChip}
                  onPress={() => openHomeworkModalForLesson(lesson, latestLessonHomeworkId)}
                >
                  <Text style={styles.lessonHomeworkReady}>
                    {t(language, { ru: 'ДЗ есть • посмотреть', en: 'Homework • view', he: 'יש שיעורי בית • צפייה' })}
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  style={styles.lessonHomeworkEmptyChip}
                  onPress={() => openHomeworkModalForLesson(lesson)}
                >
                  <Text style={styles.lessonHomeworkEmptyText}>
                    {t(language, { ru: 'Нет ДЗ • добавить', en: 'No homework • add', he: 'אין שיעורי בית • הוסף' })}
                  </Text>
                </Pressable>
              )
            : (
                <Text style={styles.lessonHolidayNote}>
                  {t(language, { ru: 'Выходной день', en: 'Day off', he: 'יום חופשי' })}
                </Text>
              )}
        </View>

        {!isHolidayType ? (
          <View style={styles.lessonTimeWrap}>
            <Text style={[styles.lessonTimeRight, isLive && styles.lessonTimeLive]}>{startLabel}</Text>
            <Text style={styles.lessonTimeSeparator}>—</Text>
            <Text style={[styles.lessonTimeRight, isLive && styles.lessonTimeLive]}>{endLabel}</Text>
          </View>
        ) : (
          <View style={styles.lessonTimeWrap}>
            <Text style={styles.lessonHolidayTime}>
              {t(language, { ru: 'весь день', en: 'all day', he: 'כל היום' })}
            </Text>
          </View>
        )}

        {isReplaced ? (
          <View style={styles.replacedBadge}>
            <Text style={styles.replacedBadgeText}>{t(language, { ru: 'Замена', en: 'Replacement', he: 'החלפה' })}</Text>
          </View>
        ) : null}
      </Pressable>
    );
  };

  const renderDashboard = () => (
    <>
      {featuredParentMessage ? (
        <View style={styles.importantCard}>
          <View style={styles.parentMessageHeader}>
            <Text style={styles.parentMessageTitle} numberOfLines={1}>
              {t(language, { ru: 'Родитель', en: 'Parent', he: 'הורה' })}{' '}
              {localizePersonName(featuredParentMessage.senderName, language)}
              {featuredParentMessage.childName
                ? ` (${localizePersonName(featuredParentMessage.childName, language)})`
                : ''}
            </Text>
            {messagesForBadge > 0 ? <View style={styles.importantMessagesDot} /> : null}
          </View>

          <Text style={styles.importantText} numberOfLines={2}>
            {featuredParentMessage.text}
          </Text>

          <View style={styles.parentMessageActions}>
            <Pressable
              style={styles.parentActionButton}
              onPress={() => {
                void markParentMessageRead(featuredParentMessage);
              }}
            >
              <Text style={styles.parentActionText}>{t(language, { ru: 'Прочитано', en: 'Read', he: 'נקרא' })}</Text>
            </Pressable>
            <Pressable style={styles.parentActionButton} onPress={() => openReplyModal(featuredParentMessage)}>
              <Text style={styles.parentActionText}>
                {t(language, { ru: 'Написать ответ', en: 'Reply', he: 'השב/י' })}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.parentActionButton, styles.parentActionGhost]}
              onPress={() => setTab('tasks')}
            >
              <Text style={styles.parentActionGhostText}>
                {t(language, { ru: 'Перейти в сообщения', en: 'Open messages', he: 'מעבר להודעות' })}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.statsGrid}>
        <View style={styles.bigStatCard}>
          <Text style={styles.statLabel}>{t(language, { ru: 'СЕЙЧАС', en: 'NOW', he: 'עכשיו' })}</Text>
          <Text style={styles.statValue}>
            {current
              ? `${lessonDisplaySubject(current)} · ${localizeLessonRoom(current.room, language)}`
              : t(language, { ru: 'Нет урока', en: 'No lesson', he: 'אין שיעור' })}
          </Text>
        </View>

        <View style={styles.bigStatCard}>
          <View style={styles.nextLessonTopRow}>
            <Text style={styles.statLabel}>{t(language, { ru: 'СЛЕДУЮЩИЙ', en: 'NEXT', he: 'הבא' })}</Text>
            <Pressable
              onPress={() => {
                setTab('schedule');
              }}
            >
              <Text style={styles.nextLessonLink}>
                {t(language, { ru: 'Перейти в расписание', en: 'Go to schedule', he: 'מעבר למערכת' })}
              </Text>
            </Pressable>
          </View>
          <Text style={styles.statValue}>
            {nextLesson
              ? `${lessonDisplaySubject(nextLesson)} · ${hhmm(nextLesson.start_datetime)} (${nextLessonWhen})`
              : t(language, { ru: 'Уроков нет', en: 'No lessons', he: 'אין שיעורים' })}
          </Text>
        </View>

        <View style={styles.smallStatsRow}>
          <View style={styles.smallStatCard}>
            <Text style={styles.smallStatLabel}>{t(language, { ru: 'Уроков', en: 'Lessons', he: 'שיעורים' })}</Text>
            <Text style={styles.smallStatValue}>{todayList.length}</Text>
          </View>

          <Pressable style={styles.smallStatCard} onPress={() => setTab('classes')}>
            <Text style={styles.smallStatLabel}>{t(language, { ru: 'Детей', en: 'Students', he: 'תלמידים' })}</Text>
            <Text style={styles.smallStatValue}>{studentUsers.length}</Text>
          </Pressable>

          <View style={styles.smallStatCard}>
            <Text
              style={[styles.smallStatLabel, styles.smallStatLabelCompact]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {t(language, { ru: 'Не будет', en: 'Absent', he: 'ייעדרו' })}
            </Text>
            <Text style={styles.smallStatValue}>{absentCountToday}</Text>
          </View>
        </View>
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>{t(language, { ru: 'Уроки на сегодня', en: 'Today lessons', he: 'שיעורים להיום' })}</Text>
        <Pressable
          onPress={() => {
            const todayInput = toJerusalemDateInput(new Date().toISOString());
            setTab('schedule');
            setSelectedScheduleDateInput(todayInput);
            setScheduleMonthCursor(monthCursorFromDateInput(todayInput));
          }}
        >
          <Text style={styles.sectionAction}>{t(language, { ru: 'Календарь', en: 'Calendar', he: 'לוח שנה' })}</Text>
        </Pressable>
      </View>

      <View style={styles.lessonsListContainer}>
        {todayList.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Ionicons name="moon-outline" size={24} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>{t(language, { ru: 'На сегодня уроков нет', en: 'No lessons today', he: 'אין שיעורים היום' })}</Text>
          </View>
        ) : (
          todayList.map((lesson, index) => renderLessonCard(lesson, index))
        )}
      </View>

      <Pressable
        style={styles.quickHomeworkButton}
        onPress={() => {
          const lesson = homeworkLessonOptions[0];
          if (!lesson) {
            Alert.alert(
              t(language, { ru: 'Нет доступных предметов', en: 'No subjects available', he: 'אין מקצועות זמינים' }),
              t(language, {
                ru: 'Добавьте предмет в профиле и урок в расписании.',
                en: 'Add a subject in profile and a lesson in schedule.',
                he: 'הוסף/י מקצוע בפרופיל ושיעור במערכת.',
              }),
            );
            return;
          }
          openHomeworkModalForLesson(lesson);
        }}
      >
        <Ionicons name="create-outline" size={18} color="#fff" />
        <Text style={styles.quickHomeworkText}>{t(language, { ru: 'Дать задание', en: 'Assign homework', he: 'תן/י משימה' })}</Text>
      </Pressable>

      <Pressable style={styles.suggestionBanner} onPress={() => setSuggestionsVisible(true)}>
        <LinearGradient
          colors={['#EDE9FE', '#D1FAE5']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.suggestionBannerGradient}
        >
          <View style={styles.suggestionBannerIconWrap}>
            <MaterialCommunityIcons name="lightbulb-on-outline" size={20} color={COLORS.violet} />
          </View>
          <View style={styles.suggestionBannerTextWrap}>
            <Text style={styles.suggestionBannerTitle}>
              {t(language, { ru: 'Есть идея или просьба?', en: 'Have an idea or request?', he: 'יש רעיון או בקשה?' })}
            </Text>
            <Text style={styles.suggestionBannerText}>
              {t(language, { ru: 'Напишите администрации', en: 'Write to administration', he: 'כתבו להנהלה' })}
            </Text>
          </View>
          <Feather name="arrow-right" size={18} color={COLORS.violet} />
        </LinearGradient>
      </Pressable>
    </>
  );

  const birthdayRoleText = (entry: User): string => {
    if (entry.role_id === 5) {
      return className(snapshot, entry.class_ids[0] ?? '', language);
    }
    if (entry.role_id === 1) {
      return 'Директор';
    }
    if (entry.role_id === 3) {
      return 'Учитель';
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
      setBirthdayGreetingVisible(false);
      setBirthdayGreetingTarget(null);
      setBirthdayGreetingDraft('');
      Alert.alert('Отправлено', `Поздравление для ${birthdayGreetingTarget.name} отправлено.`);
    } catch (error) {
      Alert.alert('Ошибка', (error as Error).message);
    } finally {
      setBirthdaySendingId(null);
    }
  };

  const renderSchedule = () => (
    <>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Расписание</Text>
        <View style={styles.scheduleHeaderActions}>
          <Pressable style={styles.calendarButton} onPress={openRangePicker}>
            <Ionicons name={calendarExpanded ? 'calendar' : 'calendar-outline'} size={16} color="#fff" />
          </Pressable>
          <Pressable style={styles.addLessonButton} onPress={openNewLessonModal}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.addLessonButtonText}>Добавить запись</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.rangeInfoCard}>
        <Text style={styles.rangeInfoText}>
          Показано: {dateShortLabel(visibleRange.startInput)} — {dateShortLabel(visibleRange.endInput)}
        </Text>
      </View>

      <View style={styles.weekNavigationRow}>
        <Pressable
          style={styles.weekNavButton}
          onPress={() => {
            if (calendarExpanded) {
              navigateMonth(-1);
            } else {
              navigateWeek(-1);
            }
          }}
        >
          <Ionicons name="chevron-back" size={16} color={COLORS.textMain} />
          <Text style={styles.weekNavButtonText}>{calendarExpanded ? 'Месяц назад' : 'Неделя назад'}</Text>
        </Pressable>

        <Text style={styles.weekNavCenterText}>
          {calendarExpanded ? scheduleMonthLabel : `Неделя ${dateInputLabel(visibleRange.startInput)}`}
        </Text>

        <Pressable
          style={styles.weekNavButton}
          onPress={() => {
            if (calendarExpanded) {
              navigateMonth(1);
            } else {
              navigateWeek(1);
            }
          }}
        >
          <Text style={styles.weekNavButtonText}>{calendarExpanded ? 'Вперед' : 'След. неделя'}</Text>
          <Ionicons name="chevron-forward" size={16} color={COLORS.textMain} />
        </Pressable>
      </View>

      {!calendarExpanded ? (
        <View style={styles.daysWeekRow}>
          {fiveDayScheduleInputs.map((dateInput) => {
            const dayIndex = dayIndexFromDateInput(dateInput);
            const selected = dateInput === selectedDayDateInput;
            const hasBirthday = birthdayMarkers.has(dateInput);
            const dayStats = scheduleDayStatsByDate.get(dateInput) ?? { lessons: 0, events: 0, holidays: 0 };
            const hasHoliday = Boolean(customHolidayByDate.get(dateInput) || schoolCalendarRangeForDate(dateInput));
            return (
              <Pressable
                key={`week_chip_${dateInput}`}
                style={[styles.dayChip, styles.dayChipCompact, selected && styles.dayChipActive]}
                onPress={() => {
                  selectScheduleDate(dateInput);
                }}
              >
                <Text
                  style={[
                    styles.dayChipText,
                    styles.dayChipTextCompact,
                    selected && styles.dayChipTextActive,
                  ]}
                >
                  {DAY_CHIPS[dayIndex].label}
                </Text>
                <Text style={[styles.dayChipDateText, selected && styles.dayChipDateTextActive]}>
                  {Number.parseInt(dateInput.slice(8, 10), 10)}
                </Text>
                {hasBirthday ? (
                  <Text style={styles.dayChipEmoji}>🎂</Text>
                ) : hasHoliday ? (
                  <Text style={styles.dayChipEmoji}>🍂</Text>
                ) : dayStats.lessons > 0 ? (
                  <View style={[styles.dayChipLessonDot, selected && styles.dayChipLessonDotActive]} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={styles.monthCalendarCard}>
          <View style={styles.calendarMonthYearRow}>
            <Pressable
              style={styles.calendarMonthYearChip}
              onPress={() => {
                setMonthPickerVisible(true);
              }}
            >
              <Text style={styles.calendarMonthYearChipText}>{scheduleMonthName}</Text>
              <Ionicons name="chevron-down" size={14} color={COLORS.textMain} />
            </Pressable>
            <Pressable
              style={styles.calendarMonthYearChip}
              onPress={() => {
                setYearPickerVisible(true);
              }}
            >
              <Text style={styles.calendarMonthYearChipText}>{scheduleYearValue}</Text>
              <Ionicons name="chevron-down" size={14} color={COLORS.textMain} />
            </Pressable>
          </View>
          <View style={styles.monthCalendarWeekdaysRow}>
            {DAY_CHIPS.map((day) => (
              <Text key={`weekday_${day.index}`} style={styles.monthCalendarWeekdayText}>
                {day.label}
              </Text>
            ))}
          </View>
          <View style={styles.monthCalendarGrid}>
            {scheduleMonthCells.map((dateInput) => {
              const inCurrentMonth = dateInput.startsWith(scheduleMonthCursor);
              const isSelected = dateInput === selectedDayDateInput;
              const isToday = dateInput === todayDateInput;
              const isPast = isBeforeDateInput(dateInput, todayDateInput) && !isToday;
              const dayIndex = dayIndexFromDateInput(dateInput);
              const isWeekend = dayIndex === 5 || dayIndex === 6;
              const hasBirthday = birthdayMarkers.has(dateInput);
              const dayStats = scheduleDayStatsByDate.get(dateInput) ?? {
                lessons: 0,
                events: 0,
                holidays: 0,
              };
              const customHolidayLabel = customHolidayByDate.get(dateInput) ?? null;
              const calendarRange = schoolCalendarRangeForDate(dateInput);
              const markerIcons: string[] = [];
              if (hasBirthday) {
                markerIcons.push('🎂');
              }
              if (customHolidayLabel) {
                markerIcons.push('🏖️');
              } else if (calendarRange) {
                markerIcons.push(calendarRange.icon);
              } else if (dayStats.events > 0) {
                markerIcons.push('🎉');
              }
              const markerText = markerIcons.slice(0, 2).join(' ');
              const lessonCount = dayStats.lessons;
              return (
                <Pressable
                  key={`calendar_day_${dateInput}`}
                  style={[
                    styles.monthCalendarDayCell,
                    !inCurrentMonth && styles.monthCalendarDayCellOut,
                    isWeekend && styles.monthCalendarDayCellWeekend,
                    isPast && styles.monthCalendarDayCellPast,
                    isSelected && styles.monthCalendarDayCellSelected,
                  ]}
                  onPress={() => {
                    selectScheduleDate(dateInput);
                  }}
                >
                  <Text
                    style={[
                      styles.monthCalendarDayText,
                      !inCurrentMonth && styles.monthCalendarDayTextOut,
                      isPast && styles.monthCalendarDayTextPast,
                      isSelected && styles.monthCalendarDayTextSelected,
                    ]}
                  >
                    {Number.parseInt(dateInput.slice(8, 10), 10)}
                  </Text>
                  {markerText ? <Text style={styles.monthCalendarMarker}>{markerText}</Text> : null}
                  {lessonCount > 0 ? (
                    <View style={styles.monthCalendarLessonCountBadge}>
                      <Text style={styles.monthCalendarLessonCountText}>{lessonCount > 9 ? '9+' : lessonCount}</Text>
                    </View>
                  ) : null}
                  {isToday && !isSelected ? <View style={styles.monthCalendarTodayRing} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {calendarExpanded ? (
        <View style={styles.calendarLegendRow}>
          <Text style={styles.calendarLegendItem}>🎂 ДР</Text>
          <Text style={styles.calendarLegendItem}>🍂 Каникулы</Text>
          <Text style={styles.calendarLegendItem}>🏖️ Выходной</Text>
          <Text style={styles.calendarLegendItem}>🔢 Уроки</Text>
        </View>
      ) : null}

      <View style={styles.selectedDayMetaCard}>
        <Text style={styles.selectedDayMetaTitle}>
          {dateShortLabel(selectedDayDateInput)} • {DAY_CHIPS[dayIndexFromDateInput(selectedDayDateInput)].label}
        </Text>
        <Text style={styles.selectedDayMetaText}>
          Уроков: {scheduleDayStatsByDate.get(selectedDayDateInput)?.lessons ?? 0} · Мероприятий:{' '}
          {scheduleDayStatsByDate.get(selectedDayDateInput)?.events ?? 0}
        </Text>
        {customHolidayByDate.get(selectedDayDateInput) ? (
          <Text style={styles.selectedDayHolidayText}>🏖️ {customHolidayByDate.get(selectedDayDateInput)}</Text>
        ) : schoolCalendarRangeForDate(selectedDayDateInput) ? (
          <Text style={styles.selectedDayHolidayText}>
            {schoolCalendarRangeForDate(selectedDayDateInput)?.icon} {schoolCalendarRangeForDate(selectedDayDateInput)?.label}
          </Text>
        ) : null}
      </View>

      {selectedDayBirthdays.length > 0 ? (
        <View style={styles.birthdayPanel}>
          <Text style={styles.birthdayPanelTitle}>Сегодня праздник!</Text>
          {selectedDayBirthdays.map((entry) => {
            const congratulated = birthdayCongratulatedIds.includes(entry.id);
            const sentText = birthdayGreetingByUserId[entry.id];
            return (
              <View key={`teacher_birthday_${entry.id}`} style={styles.birthdayCardRow}>
                <View style={styles.birthdayLeftCol}>
                  {entry.photo_uri ? (
                    <Image source={{ uri: entry.photo_uri }} style={styles.birthdayAvatar} />
                  ) : (
                    <View style={styles.birthdayAvatarFallback}>
                      <Ionicons name="person-outline" size={14} color={COLORS.violet} />
                    </View>
                  )}
                  <View>
                    <Text style={styles.birthdayName}>{entry.name}</Text>
                    <Text style={styles.birthdayMeta}>{birthdayRoleText(entry)}</Text>
                    {congratulated && sentText ? (
                      <Text style={styles.birthdaySentPreview} numberOfLines={1}>
                        {sentText}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <Pressable
                  style={[
                    styles.birthdayActionButton,
                    congratulated && styles.birthdayActionButtonDone,
                    entry.id === user.id && styles.birthdayActionButtonDisabled,
                  ]}
                  disabled={entry.id === user.id || birthdaySendingId === entry.id}
                  onPress={() => openBirthdayGreetingModal(entry)}
                >
                  <Text style={styles.birthdayActionText}>
                    {birthdaySendingId === entry.id
                      ? 'Отправка...'
                      : congratulated
                        ? 'Вы поздравили'
                        : 'Поздравить'}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.lessonsListContainer}>
        {selectedDayLessons.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Ionicons name="calendar-outline" size={24} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>На этот день уроки не запланированы</Text>
          </View>
        ) : (
          selectedDayLessons.map((lesson, index) => renderLessonCard(lesson, index, true))
        )}
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>ДЗ к дате</Text>
      </View>
      <View style={styles.lessonsListContainer}>
        {homeworkDueForSelectedDate.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyText}>Нет дедлайнов на эту дату</Text>
          </View>
        ) : (
          homeworkDueForSelectedDate.map((item) => {
            const lesson = snapshot.lessons.find((entry) => entry.id === item.lesson_id);
            return (
              <Pressable
                key={item.id}
                style={styles.taskCard}
                onPress={() => {
                  if (!lesson) {
                    return;
                  }
                  openHomeworkModalForLesson(lesson, item.id);
                }}
              >
                <Text style={styles.taskTitle}>{lesson?.subject ?? 'Урок'}</Text>
                <Text style={styles.taskMeta}>
                  {t(language, { ru: 'Класс', en: 'Class', he: 'כיתה' })}:{' '}
                  {lesson ? className(snapshot, lesson.class_id, language) : item.class_id}
                </Text>
                <Text style={styles.taskText} numberOfLines={2}>
                  {parseHomeworkText(item.text).body || item.text}
                </Text>
              </Pressable>
            );
          })
        )}
      </View>
    </>
  );

  const renderTasks = () => (
    <>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Сообщения</Text>
        <View style={styles.scheduleHeaderActions}>
          <Text style={styles.sectionHint}>Непрочитанных: {messagesForBadge}</Text>
          <Pressable
            style={styles.addLessonButton}
            onPress={() => {
              setDirectTargetUserId((current) => current || directMessageTargets[0]?.id || '');
              setDirectMessageVisible(true);
            }}
          >
            <Ionicons name="paper-plane-outline" size={14} color="#fff" />
            <Text style={styles.addLessonButtonText}>Написать</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.lessonsListContainer}>
        {parentMessages.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Ionicons name="chatbubble-outline" size={24} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>Новых сообщений от родителей нет</Text>
          </View>
        ) : (
          parentMessages.map((message) => {
            const resolved = message.isRead && !forcedUnreadParentMessageIds.includes(message.id);
            return (
              <View key={message.id} style={styles.taskCard}>
                <Text style={styles.taskTitle}>
                  {t(language, { ru: 'Родитель', en: 'Parent', he: 'הורה' })}{' '}
                  {localizePersonName(message.senderName, language)}
                  {message.childName ? ` (${localizePersonName(message.childName, language)})` : ''}
                </Text>
                <Text style={styles.taskText}>{message.text}</Text>
                <Text style={styles.taskMeta}>{hhmm(message.createdAt)}</Text>
                <View style={styles.messageActionsRow}>
                  {resolved ? (
                    <Pressable
                      style={[styles.parentActionButton, styles.parentActionGhost]}
                      onPress={() => markParentMessageUnread(message.id)}
                    >
                      <Text style={styles.parentActionGhostText}>Поставить не прочитанным</Text>
                    </Pressable>
                  ) : (
                    <>
                      <Pressable
                        style={styles.parentActionButton}
                        onPress={() => {
                          void markParentMessageRead(message);
                        }}
                      >
                        <Text style={styles.parentActionText}>Прочитано</Text>
                      </Pressable>
                      <Pressable style={styles.parentActionButton} onPress={() => openReplyModal(message)}>
                        <Text style={styles.parentActionText}>Написать ответ</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </View>
            );
          })
        )}
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Поздравления</Text>
      </View>
      <View style={styles.lessonsListContainer}>
        {birthdayMessages.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyText}>Поздравлений пока нет</Text>
          </View>
        ) : (
          birthdayMessages.map((message) => (
            <View key={message.id} style={styles.taskCard}>
              <Text style={styles.taskTitle}>
                {message.isIncoming
                  ? t(language, {
                      ru: `Поздравление от ${localizePersonName(message.senderName, language)}`,
                      en: `Greeting from ${localizePersonName(message.senderName, language)}`,
                      he: `ברכה מ-${localizePersonName(message.senderName, language)}`,
                    })
                  : t(language, {
                      ru: `Вы поздравили ${localizePersonName(message.peerName, language)}`,
                      en: `You congratulated ${localizePersonName(message.peerName, language)}`,
                      he: `בירכת את ${localizePersonName(message.peerName, language)}`,
                    })}
              </Text>
              <Text style={styles.taskText}>{message.text}</Text>
              <Text style={styles.taskMeta}>{hhmm(message.createdAt)}</Text>
              <View style={styles.messageActionsRow}>
                {message.isIncoming && !message.isRead ? (
                  <Pressable
                    style={styles.parentActionButton}
                    onPress={() => {
                      void markBirthdayMessageRead(message);
                    }}
                  >
                    <Text style={styles.parentActionText}>Прочитано</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={[styles.parentActionButton, styles.parentActionGhost]}
                  onPress={() => {
                    setDirectTargetUserId(message.peerUserId);
                    setDirectMessageText('');
                    setDirectMessageVisible(true);
                  }}
                >
                  <Text style={styles.parentActionGhostText}>
                    {message.isIncoming ? 'Ответить' : 'Написать еще'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Отправленные</Text>
      </View>
      <View style={styles.lessonsListContainer}>
        {sentMessages.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={styles.emptyText}>Пока нет отправленных сообщений</Text>
          </View>
        ) : (
          sentMessages.slice(0, 30).map((message) => (
            <View key={message.id} style={styles.taskCard}>
              <Text style={styles.taskTitle}>Кому: {message.target}</Text>
              <Text style={styles.taskText}>{message.text}</Text>
              <Text style={styles.taskMeta}>{hhmm(message.createdAt)}</Text>
            </View>
          ))
        )}
      </View>
    </>
  );

  const renderClasses = () => (
    <>
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>Классы</Text>
      </View>

      <View style={styles.lessonsListContainer}>
        {classStats.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Ionicons name="school-outline" size={24} color={COLORS.textMuted} />
            <Text style={styles.emptyText}>Классы не назначены</Text>
          </View>
        ) : (
          classStats.map((entry) => {
            const expanded = expandedClassIds.includes(entry.classId);
            const classHomework = classHomeworkMap.get(entry.classId) ?? [];
            return (
              <View key={entry.classId} style={styles.classCardWrap}>
                <Pressable style={styles.classCard} onPress={() => openStudentsForClass(entry.classId)}>
                  <View style={styles.classBadge}>
                    <Text style={styles.classBadgeText}>{entry.className.replace('Класс ', '')}</Text>
                  </View>

                  <View style={styles.classInfo}>
                    <Text style={styles.classTitle}>{entry.className}</Text>
                    <Text style={styles.classMeta}>{entry.students} учеников</Text>
                    <Text style={styles.classMeta}>Домашние задания: {classHomework.length}</Text>
                  </View>

                  <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
                </Pressable>

                <Pressable
                  style={styles.classHomeworkExpandButton}
                  onPress={() =>
                    setExpandedClassIds((current) =>
                      current.includes(entry.classId)
                        ? current.filter((item) => item !== entry.classId)
                        : [...current, entry.classId],
                    )
                  }
                >
                  <Text style={styles.classHomeworkExpandText}>
                    {expanded ? 'Скрыть домашние задания' : 'Показать домашние задания'}
                  </Text>
                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={COLORS.violet}
                  />
                </Pressable>

                {expanded ? (
                  <View style={styles.classHomeworkInlineList}>
                    {classHomework.length === 0 ? (
                      <Text style={styles.classHomeworkInlineEmpty}>Нет домашних заданий</Text>
                    ) : (
                      classHomework.slice(0, 6).map((item) => {
                        const lesson = snapshot.lessons.find((lessonEntry) => lessonEntry.id === item.lesson_id);
                        return (
                          <Pressable
                            key={item.id}
                            style={styles.classHomeworkInlineRow}
                            onPress={() => {
                              if (!lesson) {
                                return;
                              }
                              openHomeworkModalForLesson(lesson, item.id);
                            }}
                          >
                            <Text style={styles.classHomeworkInlineTitle} numberOfLines={1}>
                              {lesson ? lessonDisplaySubject(lesson) : 'Задание'} · {dateInputLabel(item.due_date)}
                            </Text>
                            <Text style={styles.classHomeworkInlineBody} numberOfLines={2}>
                              {parseHomeworkText(item.text).body || item.text}
                            </Text>
                          </Pressable>
                        );
                      })
                    )}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>
    </>
  );

  const renderProfile = () => (
    <>
      <LinearGradient
        colors={[COLORS.gradientFrom, COLORS.gradientTo]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.profileTopCard}
      >
        <Pressable style={styles.profileAvatar} onPress={() => void pickProfilePhoto()}>
          {user.photo_uri ? (
            <Image source={{ uri: user.photo_uri }} style={styles.profileAvatarImage} />
          ) : (
            <Text style={styles.profileAvatarText}>
              {localizePersonName(user.name, language).charAt(0).toUpperCase()}
            </Text>
          )}
        </Pressable>
        <Text style={styles.profileName}>{localizePersonName(user.name, language)}</Text>
        <Text style={styles.profileSub}>
          {homeroomOptIn
            ? t(language, {
                ru: 'Учитель • Классный руководитель',
                en: 'Teacher • Homeroom',
                he: 'מורה • מחנך/ת כיתה',
              })
            : t(language, { ru: 'Учитель', en: 'Teacher', he: 'מורה' })}
        </Text>
        {user.dob ? <Text style={styles.profileSub}>{user.dob.split('-').reverse().join('.')} 🎂</Text> : null}
      </LinearGradient>

      <View style={styles.profileActionsCard}>
        <Pressable style={styles.profileActionButton} onPress={onToggleOriginal}>
          <Ionicons name={showOriginal ? 'eye-outline' : 'eye-off-outline'} size={18} color={COLORS.textMain} />
          <Text style={styles.profileActionText}>
            {showOriginal
              ? t(language, { ru: 'Оригинал текста: включен', en: 'Original text: on', he: 'טקסט מקור: פעיל' })
              : t(language, { ru: 'Оригинал текста: выключен', en: 'Original text: off', he: 'טקסט מקור: כבוי' })}
          </Text>
        </Pressable>
        <Pressable style={[styles.profileActionButton, styles.logoutActionButton]} onPress={onLogout}>
          <Ionicons name="log-out-outline" size={18} color={COLORS.red} />
          <Text style={styles.logoutActionText}>
            {t(language, { ru: 'Выйти из аккаунта', en: 'Sign out', he: 'התנתקות מהחשבון' })}
          </Text>
        </Pressable>
      </View>

      <View style={styles.profileInfoCard}>
        <Text style={styles.profileInfoTitle}>{t(language, { ru: 'Личное', en: 'Personal', he: 'אישי' })}</Text>
        <TextInput
          value={profileNameDraft}
          onChangeText={setProfileNameDraft}
          placeholder={t(language, { ru: 'Имя и фамилия', en: 'Full name', he: 'שם מלא' })}
          style={styles.profileInput}
          editable={!profileSaving}
        />
        <TextInput
          value={profileEmailDraft}
          onChangeText={setProfileEmailDraft}
          placeholder={t(language, { ru: 'Электронная почта', en: 'Email', he: 'דוא"ל' })}
          keyboardType="email-address"
          autoCapitalize="none"
          style={styles.profileInput}
          editable={!profileSaving}
        />
        <TextInput
          value={profilePhoneDraft}
          onChangeText={setProfilePhoneDraft}
          placeholder={t(language, { ru: 'Номер телефона', en: 'Phone number', he: 'מספר טלפון' })}
          keyboardType="phone-pad"
          style={styles.profileInput}
          editable={!profileSaving}
        />
        <Pressable
          style={[styles.submitPrimaryButton, profileSaving && styles.submitButtonDisabled]}
          disabled={profileSaving}
          onPress={() => void saveProfileInfo()}
        >
          <Text style={styles.submitPrimaryButtonText}>
            {profileSaving
              ? t(language, { ru: 'Сохранение...', en: 'Saving...', he: 'שומר...' })
              : t(language, { ru: 'Сохранить профиль', en: 'Save profile', he: 'שמור פרופיל' })}
          </Text>
        </Pressable>
      </View>

      <BirthdaySettingsCard user={user} onSave={onUpdateBirthdaySettings} />

      <View style={styles.profileInfoCard}>
        <Text style={styles.profileInfoTitle}>{t(language, { ru: 'Предметы', en: 'Subjects', he: 'מקצועות' })}</Text>
        <Text style={styles.profileInfoSub}>
          {t(language, {
            ru: 'Удаление доступно только если нет будущих уроков по предмету.',
            en: 'You can delete a subject only if there are no future lessons for it.',
            he: 'ניתן להסיר מקצוע רק אם אין שיעורים עתידיים למקצוע זה.',
          })}
        </Text>
        {normalizedTeachingDraft.length === 0 ? (
          <Text style={styles.profileInfoSub}>
            {t(language, {
              ru: 'Предметы появятся после добавления уроков.',
              en: 'Subjects will appear after you add lessons.',
              he: 'המקצועות יופיעו לאחר הוספת שיעורים.',
            })}
          </Text>
        ) : (
          <View style={styles.profileChipsWrap}>
            {normalizedTeachingDraft.map((subject) => (
              <View key={subject} style={styles.profileSubjectChipEditable}>
                <Text style={styles.profileSubjectChipText}>{localizeSubjectName(subject)}</Text>
                <Pressable
                  style={styles.profileSubjectRemoveButton}
                  disabled={teachingSubjectsSaving}
                  onPress={() => removeTeachingSubject(subject)}
                >
                  <Ionicons name="close" size={14} color="#334155" />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <Text style={styles.profileInfoSub}>
          {t(language, { ru: 'Список от администратора', en: 'Administrator list', he: 'רשימת מנהל' })}
        </Text>
        <View style={styles.profileChipsWrap}>
          {availableAdminSubjects.map((subject) => {
            const selected = normalizedTeachingDraft.includes(subject);
            return (
              <Pressable
                key={subject}
                style={[styles.profileSubjectSelectChip, selected && styles.profileSubjectSelectChipActive]}
                disabled={teachingSubjectsSaving}
                onPress={() => toggleTeachingSubject(subject)}
              >
                <Text
                  style={[
                    styles.profileSubjectSelectChipText,
                    selected && styles.profileSubjectSelectChipTextActive,
                  ]}
                >
                  {localizeSubjectName(subject)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.profileSubjectEditorRow}>
          <TextInput
            value={subjectOtherInput}
            onChangeText={setSubjectOtherInput}
            placeholder={t(language, {
              ru: 'Другое (свой предмет)',
              en: 'Other (custom subject)',
              he: 'אחר (מקצוע מותאם)',
            })}
            style={styles.profileSubjectInput}
            editable={!teachingSubjectsSaving}
          />
          <Pressable
            style={[
              styles.profileSubjectAddButton,
              (!subjectOtherInput.trim() || teachingSubjectsSaving) && styles.profileSubjectAddButtonDisabled,
            ]}
            disabled={!subjectOtherInput.trim() || teachingSubjectsSaving}
            onPress={addCustomTeachingSubject}
          >
            <Text style={styles.profileSubjectAddText}>
              {t(language, { ru: 'Добавить другое', en: 'Add custom', he: 'הוסף מקצוע מותאם' })}
            </Text>
          </Pressable>
        </View>
        <Pressable
          style={[
            styles.submitPrimaryButton,
            (!teachingSubjectsDirty || teachingSubjectsSaving) && styles.submitButtonDisabled,
          ]}
          disabled={!teachingSubjectsDirty || teachingSubjectsSaving}
          onPress={() => void saveTeachingSubjects()}
        >
          <Text style={styles.submitPrimaryButtonText}>
            {teachingSubjectsSaving
              ? t(language, { ru: 'Сохранение...', en: 'Saving...', he: 'שומר...' })
              : t(language, { ru: 'Сохранить предметы', en: 'Save subjects', he: 'שמור מקצועות' })}
          </Text>
        </Pressable>
      </View>

      <View style={styles.profileInfoCard}>
        <Text style={styles.profileInfoTitle}>{t(language, { ru: 'Класс', en: 'Class', he: 'כיתה' })}</Text>
        <Pressable
          style={[styles.profileHomeroomToggle, homeroomSaving && styles.profileHomeroomToggleDisabled]}
          onPress={toggleHomeroom}
          disabled={homeroomSaving}
        >
          <Ionicons
            name={homeroomOptIn ? 'checkmark-circle' : 'ellipse-outline'}
            size={18}
            color={homeroomOptIn ? '#16A34A' : '#64748B'}
          />
          <Text style={styles.profileHomeroomToggleText}>
            {homeroomOptIn
              ? t(language, { ru: 'Вы классный руководитель', en: 'You are a homeroom teacher', he: 'את/ה מחנך/ת כיתה' })
              : t(language, {
                  ru: 'Стать классным руководителем',
                  en: 'Become a homeroom teacher',
                  he: 'להיות מחנך/ת כיתה',
                })}
          </Text>
        </Pressable>

        {homeroomOptIn ? (
          <>
            <Text style={styles.profileInfoSub}>{t(language, { ru: 'Выберите класс', en: 'Select class', he: 'בחר/י כיתה' })}</Text>
            <View style={styles.profileChipsWrap}>
              {teacherClassModels.map((entry) => {
                const selected = homeroomClassId === entry.id;
                return (
                  <Pressable
                    key={entry.id}
                    style={[styles.profileClassChip, selected && styles.profileClassChipActive]}
                    disabled={homeroomSaving}
                    onPress={() => {
                      void persistHomeroom(true, entry.id);
                    }}
                  >
                    <Text style={[styles.profileClassChipText, selected && styles.profileClassChipTextActive]}>
                      {entry.name_i18n?.[language] ?? entry.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {homeroomClassName ? (
              <Text style={styles.profileInfoSubStrong}>
                {t(language, { ru: 'Текущий класс', en: 'Current class', he: 'כיתה נוכחית' })}: {homeroomClassName}
              </Text>
            ) : null}
            {homeroomSaving ? (
              <Text style={styles.profileInfoSub}>{t(language, { ru: 'Сохранение...', en: 'Saving...', he: 'שומר...' })}</Text>
            ) : null}
          </>
        ) : null}
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
    if (tab === 'tasks') {
      return renderTasks();
    }
    if (tab === 'classes') {
      return renderClasses();
    }
    return renderProfile();
  };

  const stickyHeaderHeight = contentScrollY.interpolate({
    inputRange: [0, 80],
    outputRange: [headerMaxHeight, headerMinHeight],
    extrapolate: 'clamp',
  });
  const stickyNameSize = contentScrollY.interpolate({
    inputRange: [0, 80],
    outputRange: [34, 24],
    extrapolate: 'clamp',
  });
  const stickyMetaOpacity = contentScrollY.interpolate({
    inputRange: [0, 80],
    outputRange: [1, 0.85],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.stickyHeaderWrap, { height: stickyHeaderHeight }]}>
        <LinearGradient
          colors={[COLORS.gradientFrom, COLORS.gradientTo]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.headerGradient, { paddingTop: 10 + headerTopInset }]}
        >
          <View style={styles.headerIdentityRow}>
            <Pressable style={styles.headerAvatarTapArea} onPress={() => void pickProfilePhoto()}>
              {user.photo_uri ? (
                <Image source={{ uri: user.photo_uri }} style={styles.headerAvatarImage} />
              ) : (
                <View style={styles.headerAvatarFallback}>
                  <Text style={styles.headerAvatarFallbackText}>
                    {localizePersonName(user.name, language).charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </Pressable>

            <View style={styles.stickyIdentityTextCol}>
              <Animated.Text style={[styles.headerUserName, { fontSize: stickyNameSize }]}>
                {localizePersonName(user.name, language)}
              </Animated.Text>
              <Animated.View style={[styles.headerRoleBadge, { opacity: stickyMetaOpacity }]}>
                <Text style={styles.headerRoleText}>{t(language, { ru: 'Учитель', en: 'Teacher', he: 'מורה' })}</Text>
              </Animated.View>
            </View>

            <Pressable style={styles.notificationsButton} onPress={() => setTab('tasks')}>
              <Ionicons name="notifications-outline" size={20} color="#FFFFFF" />
              {messagesForBadge > 0 ? (
                <View style={styles.notificationsBadge}>
                  <Text style={styles.notificationsBadgeText}>{messagesForBadge}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
          <BlurView intensity={28} tint="light" style={styles.headerBottomBlur} />
        </LinearGradient>
      </Animated.View>

      <Animated.ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: headerMaxHeight + 8 }]}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: contentScrollY } } }], {
          useNativeDriver: false,
        })}
      >
        {renderContent()}
      </Animated.ScrollView>

      <View style={styles.bottomNavBar}>
        {NAV_ITEMS.map((item) => {
          const active = item.key === tab;
          const showMessagesDot = item.key === 'tasks' && messagesForBadge > 0;
          return (
            <Pressable key={item.key} style={styles.bottomNavItem} onPress={() => setTab(item.key)}>
              <Ionicons
                name={item.icon}
                size={20}
                color={active ? COLORS.violet : '#64748B'}
                style={styles.bottomNavIcon}
              />
              {showMessagesDot ? <View style={styles.navMessageDot} /> : null}
              <Text style={[styles.bottomNavLabel, active && styles.bottomNavLabelActive]}>
                {tabLabel(item.key, language)}
              </Text>
              <View style={[styles.activeDot, active && styles.activeDotVisible]} />
            </Pressable>
          );
        })}
      </View>

      <Modal
        visible={addLessonVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddLessonVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
          keyboardVerticalOffset={20}
        >
          <View style={styles.sheetModal}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>
                {draft.lessonId
                  ? 'Редактировать запись'
                  : draft.type === 'event'
                    ? 'Добавить мероприятие'
                    : draft.type === 'holiday'
                      ? 'Добавить выходной'
                      : 'Добавить урок'}
              </Text>
              <Pressable onPress={() => setAddLessonVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.textMain} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalSectionTitle}>День недели</Text>
              <View style={styles.chipsWrap}>
                {DAY_CHIPS.map((day) => (
                  <Pressable
                    key={`draft_day_${day.index}`}
                    style={[styles.optionChip, draft.dayIndex === day.index && styles.optionChipActive]}
                    onPress={() =>
                      setDraft((entry) => ({
                        ...entry,
                        dayIndex: day.index,
                        dateInput: dateInputForDayInSameWeek(entry.dateInput, day.index),
                      }))
                    }
                  >
                    <Text
                      style={[styles.optionChipText, draft.dayIndex === day.index && styles.optionChipTextActive]}
                    >
                      {day.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.profileInfoSub}>Дата: {dateShortLabel(draft.dateInput)}</Text>

              <Text style={styles.modalSectionTitle}>Тип записи</Text>
              <View style={styles.chipsWrap}>
                <Pressable
                  style={[styles.optionChip, draft.type === 'lesson' && styles.optionChipActive]}
                  onPress={() => setLessonDraftType('lesson')}
                >
                  <Text style={[styles.optionChipText, draft.type === 'lesson' && styles.optionChipTextActive]}>
                    Урок
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.optionChip, draft.type === 'event' && styles.optionChipActive]}
                  onPress={() => setLessonDraftType('event')}
                >
                  <Text style={[styles.optionChipText, draft.type === 'event' && styles.optionChipTextActive]}>
                    Мероприятие
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.optionChip, draft.type === 'holiday' && styles.optionChipActive]}
                  onPress={() => setLessonDraftType('holiday')}
                >
                  <Text style={[styles.optionChipText, draft.type === 'holiday' && styles.optionChipTextActive]}>
                    Выходной
                  </Text>
                </Pressable>
              </View>

              {draft.type !== 'holiday' ? (
                <>
                  <Text style={styles.modalSectionTitle}>Время</Text>
                  <View style={styles.timeSlotsGrid}>
                    {TIME_SLOT_OPTIONS.map((slot) => {
                      const selected = draft.startTime === slot.start && draft.endTime === slot.end;
                      return (
                        <Pressable
                          key={slot.label}
                          style={[styles.timeSlotChip, selected && styles.timeSlotChipActive]}
                          onPress={() =>
                            setDraft((entry) => ({ ...entry, startTime: slot.start, endTime: slot.end }))
                          }
                        >
                          <Text style={[styles.timeSlotText, selected && styles.timeSlotTextActive]}>
                            {slot.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              ) : (
                <Text style={styles.profileInfoSub}>Для выходного день сохраняется как запись на весь день.</Text>
              )}

              {draft.type === 'lesson' ? (
                <>
                  <Text style={styles.modalSectionTitle}>Предмет</Text>
                  <View style={styles.chipsWrap}>
                    {subjects.map((subject) => {
                      const selected = draft.subject === subject;
                      return (
                        <Pressable
                          key={subject}
                          style={[styles.optionChip, selected && styles.optionChipActive]}
                          onPress={() =>
                            setDraft((entry) => ({
                              ...entry,
                              subject,
                            }))
                          }
                        >
                          <Text style={[styles.optionChipText, selected && styles.optionChipTextActive]}>
                            {subject}
                          </Text>
                        </Pressable>
                      );
                    })}
                    <Pressable
                      style={[styles.optionChip, draft.subject === CUSTOM_SUBJECT_VALUE && styles.optionChipActive]}
                      onPress={() =>
                        setDraft((entry) => ({
                          ...entry,
                          subject: CUSTOM_SUBJECT_VALUE,
                          customSubject: entry.customSubject || '',
                        }))
                      }
                    >
                      <Text
                        style={[
                          styles.optionChipText,
                          draft.subject === CUSTOM_SUBJECT_VALUE && styles.optionChipTextActive,
                        ]}
                      >
                        Другое
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : null}

              <Text style={styles.modalSectionTitle}>Класс</Text>
              <View style={styles.chipsWrap}>
                {snapshot.classes
                  .filter((entry) => user.class_ids.includes(entry.id))
                  .map((classModel) => {
                    const selected = draft.classId === classModel.id;
                    return (
                      <Pressable
                        key={classModel.id}
                        style={[styles.optionChip, selected && styles.optionChipGreenActive]}
                        onPress={() => setDraft((entry) => ({ ...entry, classId: classModel.id }))}
                      >
                        <Text
                          style={[
                            styles.optionChipText,
                            selected && styles.optionChipGreenTextActive,
                          ]}
                        >
                          {classModel.name}
                        </Text>
                      </Pressable>
                    );
                  })}
              </View>

              <View style={styles.inputStack}>
                {draft.type !== 'lesson' || draft.subject === CUSTOM_SUBJECT_VALUE ? (
                  <TextInput
                    value={draft.customSubject}
                    onChangeText={(value) => setDraft((entry) => ({ ...entry, customSubject: value }))}
                    placeholder={draft.type === 'holiday' ? 'Название выходного/каникул' : 'Введите наименование'}
                    style={styles.modalInput}
                  />
                ) : null}
                {draft.type !== 'holiday' ? (
                  <TextInput
                    value={draft.room}
                    onChangeText={(value) => setDraft((entry) => ({ ...entry, room: value }))}
                    placeholder={draft.type === 'event' ? 'Место проведения' : 'Кабинет (по умолчанию Кабинет 1)'}
                    style={styles.modalInput}
                  />
                ) : null}
              </View>
            </ScrollView>

            <Pressable style={styles.submitPrimaryButton} onPress={() => void saveLesson()}>
              <Text style={styles.submitPrimaryButtonText}>
                {draft.lessonId
                  ? 'Сохранить запись'
                  : draft.type === 'event'
                    ? 'Добавить мероприятие'
                    : draft.type === 'holiday'
                      ? 'Добавить выходной'
                      : 'Добавить урок'}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={lessonActionsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLessonActionsVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.actionsModal}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Управление уроком</Text>
              <Pressable onPress={() => setLessonActionsVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.textMain} />
              </Pressable>
            </View>

            {selectedLesson ? (
              <>
                <View style={styles.infoBlocksRow}>
                  <View style={styles.infoBlock}>
                    <Text style={styles.infoBlockLabel}>Предмет</Text>
                    <Text style={styles.infoBlockValue}>{selectedLesson.subject}</Text>
                  </View>
                  <View style={styles.infoBlock}>
                    <Text style={styles.infoBlockLabel}>Класс</Text>
                    <Text style={styles.infoBlockValue}>{className(snapshot, selectedLesson.class_id, language)}</Text>
                  </View>
                  <View style={styles.infoBlock}>
                    <Text style={styles.infoBlockLabel}>Кабинет</Text>
                    <Text style={styles.infoBlockValue}>{selectedLesson.room}</Text>
                  </View>
                </View>

                <Pressable
                  style={({ pressed }) => [styles.actionButtonEdit, pressed && styles.actionButtonEditPressed]}
                  onPress={() => {
                    const lesson = selectedLesson;
                    setLessonActionsVisible(false);
                    if (lesson) {
                      openEditLessonModal(lesson);
                    }
                  }}
                >
                  <Feather name="edit-2" size={16} color="#2563EB" />
                  <Text style={styles.actionButtonEditText}>Редактировать урок</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.actionButtonRow, pressed && styles.actionButtonRowPressed]}
                  onPress={() => {
                    if (!selectedLesson) {
                      return;
                    }
                    openHomeworkModalForLesson(
                      selectedLesson,
                      selectedLessonHasHomework ? selectedLessonHomeworkId : undefined,
                    );
                  }}
                >
                  <Ionicons
                    name={selectedLessonHasHomework ? 'document-text-outline' : 'create-outline'}
                    size={18}
                    color="#0F766E"
                  />
                  <Text style={[styles.actionButtonText, styles.homeworkActionText]}>
                    {selectedLessonHasHomework ? 'Посмотреть задание' : 'Добавить задание'}
                  </Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.actionButtonRow, pressed && styles.actionButtonRowPressed]}
                  onPress={() => {
                    if (!selectedLesson) {
                      return;
                    }
                    openAbsenceModalForLesson(selectedLesson);
                  }}
                >
                  <Ionicons name="people-outline" size={18} color={COLORS.textMain} />
                  <Text style={styles.actionButtonText}>Пометить отсутствующих</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [styles.actionButtonRow, pressed && styles.actionButtonRowPressed]}
                  onPress={() => {
                    if (!selectedLesson) {
                      return;
                    }
                    openLessonSummaryModal(selectedLesson);
                  }}
                >
                  <Ionicons name="document-text-outline" size={18} color={COLORS.textMain} />
                  <Text style={styles.actionButtonText}>Описание урока</Text>
                </Pressable>

                {lessonVisualState[selectedLesson.id] ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionButtonRow,
                      styles.actionButtonInfo,
                      pressed && styles.actionButtonInfoPressed,
                    ]}
                    onPress={() => {
                      revertLessonVisualState(selectedLesson);
                    }}
                  >
                    <Ionicons name="refresh-outline" size={18} color={COLORS.textMain} />
                    <Text style={styles.actionButtonText}>
                      {lessonVisualState[selectedLesson.id]?.kind === 'canceled'
                        ? 'Возобновить урок'
                        : 'Вернуть урок'}
                    </Text>
                  </Pressable>
                ) : null}

                {lessonVisualState[selectedLesson.id]?.kind !== 'canceled' ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.actionButtonRow,
                      styles.actionButtonDanger,
                      pressed && styles.actionButtonDangerPressed,
                    ]}
                    onPress={() => {
                      if (!selectedLesson) {
                        return;
                      }
                      markLessonCanceled(selectedLesson);
                    }}
                  >
                    <Ionicons name="close-circle-outline" size={18} color={COLORS.red} />
                    <Text style={styles.actionButtonDangerText}>Отменить урок</Text>
                  </Pressable>
                ) : null}

                {lessonVisualState[selectedLesson.id]?.kind !== 'replaced' ? (
                  <Pressable
                    style={({ pressed }) => [styles.actionButtonRow, pressed && styles.actionButtonRowPressed]}
                    onPress={() => {
                      if (!selectedLesson) {
                        return;
                      }
                      openReplacementPicker(selectedLesson);
                    }}
                  >
                    <Ionicons name="sync-outline" size={18} color={COLORS.textMain} />
                    <Text style={styles.actionButtonText}>Назначить замену</Text>
                  </Pressable>
                ) : null}

                <Pressable
                  style={({ pressed }) => [
                    styles.actionButtonRow,
                    styles.actionButtonInfo,
                    pressed && styles.actionButtonInfoPressed,
                  ]}
                  onPress={() => {
                    if (!selectedLesson) {
                      return;
                    }
                    const lesson = selectedLesson;
                    setLessonActionsVisible(false);
                    openEditLessonModal(lesson);
                  }}
                >
                  <Ionicons name="time-outline" size={18} color={COLORS.textMain} />
                  <Text style={styles.actionButtonText}>Перенести урок</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.actionButtonRow,
                    styles.actionButtonDanger,
                    lessonDeleting && styles.submitButtonDisabled,
                    pressed && styles.actionButtonDangerPressed,
                  ]}
                  disabled={lessonDeleting}
                  onPress={() => {
                    if (!selectedLesson) {
                      return;
                    }
                    const lesson = selectedLesson;
                    Alert.alert(
                      'Удалить урок?',
                      'Вы точно хотите удалить урок? Можно выбрать "Отменить".',
                      [
                        { text: 'Отменить', style: 'cancel' },
                        {
                          text: 'Удалить урок',
                          style: 'destructive',
                          onPress: () => {
                            void deleteLessonFromSchedule(lesson);
                          },
                        },
                      ],
                    );
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color={COLORS.red} />
                  <Text style={styles.actionButtonDangerText}>
                    {lessonDeleting ? 'Удаляем...' : 'Удалить урок'}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={homeworkFormVisible}
        transparent
        animationType="none"
        onRequestClose={closeHomeworkFormSheet}
      >
        <View style={styles.modalBackdrop}>
          <Animated.View
            style={[styles.sheetModal, styles.homeworkSheetModal, { transform: [{ translateY: homeworkSheetTranslateY }] }]}
          >
              <View style={styles.sheetTopCloseArea} {...homeworkSheetPanResponder.panHandlers}>
                <Pressable
                  style={styles.sheetTopHandleTapZone}
                  onPress={closeHomeworkFormSheet}
                >
                  <View style={styles.sheetTopHandle} />
                </Pressable>
              </View>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>{t(language, { ru: 'Добавить задание', en: 'Add homework', he: 'הוספת משימה' })}</Text>
              </View>

                  <View style={styles.homeworkScrollArea}>
                    <ScrollView
                      ref={homeworkScrollRef}
                      keyboardShouldPersistTaps="handled"
                      keyboardDismissMode="on-drag"
                      onScrollBeginDrag={Keyboard.dismiss}
                      onTouchStart={() => {
                        if (homeworkInputFocused) {
                          Keyboard.dismiss();
                        }
                      }}
                      onScroll={(event) => {
                        homeworkScrollOffsetYRef.current = event.nativeEvent.contentOffset.y;
                      }}
                      onScrollEndDrag={(event) => {
                        const offsetY = event.nativeEvent.contentOffset.y;
                        if (offsetY <= -28) {
                          closeHomeworkFormSheet();
                        }
                      }}
                      scrollEventThrottle={16}
                      contentContainerStyle={[
                        styles.homeworkFormContent,
                        {
                          paddingBottom:
                            HOMEWORK_BOTTOM_ACTIONS_RESERVED +
                            (homeworkInputFocused ? homeworkKeyboardInset : 0) +
                            12,
                        },
                      ]}
                      showsVerticalScrollIndicator={false}
                    >
                    <Text style={styles.modalSectionTitle}>
                      {t(language, { ru: 'Выбор урока', en: 'Lesson selection', he: 'בחירת שיעור' })}
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daysRow}>
                      {homeworkSubjectOptions.map((subject) => {
                        const selected =
                          !homeworkClassTaskMode &&
                          homeworkSubjectDraft.trim().toLowerCase() === subject.trim().toLowerCase();
                        return (
                          <Pressable
                            key={subject}
                            style={[styles.optionChip, selected && styles.optionChipActive]}
                            onPress={() => onHomeworkSubjectChange(subject)}
                          >
                            <Text style={[styles.optionChipText, selected && styles.optionChipTextActive]}>
                              {localizeSubjectName(subject)}
                            </Text>
                          </Pressable>
                        );
                      })}
                      <Pressable
                        style={[styles.optionChip, homeworkClassTaskMode && styles.optionChipActive]}
                        onPress={() => openHomeworkModalForClassTask(homeworkClassId || '')}
                      >
                        <Text style={[styles.optionChipText, homeworkClassTaskMode && styles.optionChipTextActive]}>
                          {t(language, { ru: 'Другое задание', en: 'Custom task', he: 'משימה אחרת' })}
                        </Text>
                      </Pressable>
                    </ScrollView>

                    <Text style={styles.modalSectionTitle}>{t(language, { ru: 'Класс', en: 'Class', he: 'כיתה' })}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daysRow}>
                      {teacherClassModels.map((classModel) => {
                        const selected = homeworkClassId === classModel.id;
                        return (
                          <Pressable
                            key={classModel.id}
                            style={[styles.optionChip, selected && styles.optionChipGreenActive]}
                            onPress={() => onHomeworkClassChange(classModel.id)}
                          >
                            <Text style={[styles.optionChipText, selected && styles.optionChipGreenTextActive]}>
                              {className(snapshot, classModel.id, language)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>

                    <View style={styles.lessonSummaryCard}>
                      <Text style={styles.lessonSummaryTitle}>
                        {homeworkClassTaskMode
                          ? t(language, { ru: 'Задание для класса', en: 'Class homework', he: 'משימה לכיתה' })
                          : homeworkSubjectDraft
                            ? localizeSubjectName(homeworkSubjectDraft)
                            : selectedLesson
                              ? lessonDisplaySubject(selectedLesson)
                              : t(language, { ru: 'Выберите урок', en: 'Select lesson', he: 'בחר/י שיעור' })}
                      </Text>
                      <Text style={styles.lessonSummaryMeta}>
                        {homeworkClassId
                          ? className(snapshot, homeworkClassId, language)
                          : t(language, { ru: 'Класс не выбран', en: 'Class not selected', he: 'לא נבחרה כיתה' })}
                      </Text>
                    </View>

                    <View style={styles.homeworkDateCard}>
                      <View style={styles.homeworkDatesMainRow}>
                        <Pressable
                          style={[
                            styles.homeworkIssuedField,
                            homeworkDuePickerVisible &&
                              homeworkCalendarTarget === 'given' &&
                              styles.homeworkDeadlineFieldActive,
                          ]}
                          onPress={() => openHomeworkDuePicker('given')}
                        >
                          <Text style={styles.homeworkIssuedText}>
                            📅 {t(language, { ru: 'Выдано', en: 'Assigned', he: 'ניתן' })}:{' '}
                            {dateShortLabel(homeworkGivenDate, uiLocale)}
                          </Text>
                        </Pressable>
                        <Ionicons name="arrow-forward" size={14} color="#94A3B8" />
                        <Pressable
                          style={[
                            styles.homeworkDeadlineField,
                            homeworkDuePickerVisible &&
                              homeworkCalendarTarget === 'due' &&
                              styles.homeworkDeadlineFieldActive,
                          ]}
                          onPress={() => openHomeworkDuePicker('due')}
                        >
                          <Text style={styles.homeworkDeadlineText}>
                            🏁 {t(language, { ru: 'Срок', en: 'Due', he: 'תאריך יעד' })}:{' '}
                            {dateShortLabel(homeworkDueDate, uiLocale)}
                          </Text>
                        </Pressable>
                      </View>
                      <View style={styles.homeworkQuickDatesRow}>
                        <Pressable
                          style={styles.homeworkQuickDateChip}
                          onPress={() => {
                            const nextDate = maxDateInput(addDaysToDateInput(homeworkDueDate, 1), minHomeworkDueDateInput);
                            setHomeworkDueDate(nextDate);
                            setHomeworkDueMonthCursor(monthCursorFromDateInput(nextDate));
                            setHomeworkDuePickerVisible(false);
                          }}
                        >
                          <Text style={styles.homeworkQuickDateChipText}>
                            {t(language, { ru: '+1 день', en: '+1 day', he: '+יום 1' })}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={styles.homeworkQuickDateChip}
                          onPress={() => {
                            const nextDate = maxDateInput(addDaysToDateInput(homeworkDueDate, 2), minHomeworkDueDateInput);
                            setHomeworkDueDate(nextDate);
                            setHomeworkDueMonthCursor(monthCursorFromDateInput(nextDate));
                            setHomeworkDuePickerVisible(false);
                          }}
                        >
                          <Text style={styles.homeworkQuickDateChipText}>
                            {t(language, { ru: '+2 дня', en: '+2 days', he: '+2 ימים' })}
                          </Text>
                        </Pressable>
                        <Pressable
                          style={styles.homeworkQuickDateChip}
                          onPress={() => {
                            setHomeworkDueDate(nextLessonDuePreset);
                            setHomeworkDueMonthCursor(monthCursorFromDateInput(nextLessonDuePreset));
                            setHomeworkDuePickerVisible(false);
                          }}
                        >
                          <Text style={styles.homeworkQuickDateChipText}>
                            {t(language, { ru: 'На след. урок', en: 'Next lesson', he: 'לשיעור הבא' })}
                          </Text>
                        </Pressable>
                      </View>

                      {homeworkDuePickerVisible ? (
                        <View style={styles.compactCalendarWrap}>
                          <View style={styles.compactCalendarMonthRow}>
                            <Pressable
                              style={styles.compactCalendarNavButton}
                              onPress={() => setHomeworkDueMonthCursor((current) => shiftMonthCursor(current, -1))}
                            >
                              <Ionicons name="chevron-back" size={16} color={COLORS.textMain} />
                            </Pressable>
                            <Text style={styles.compactCalendarMonthLabel}>{homeworkDueMonthLabel}</Text>
                            <Pressable
                              style={styles.compactCalendarNavButton}
                              onPress={() => setHomeworkDueMonthCursor((current) => shiftMonthCursor(current, 1))}
                            >
                              <Ionicons name="chevron-forward" size={16} color={COLORS.textMain} />
                            </Pressable>
                          </View>

                          <View style={styles.compactCalendarWeekdaysRow}>
                            {weekdayShortLabels.map((day) => (
                              <Text key={day} style={styles.compactCalendarWeekdayText}>
                                {day}
                              </Text>
                            ))}
                          </View>

                          <View style={styles.compactCalendarGrid}>
                            {homeworkDueCalendarCells.map((dateInput) => {
                              const selected =
                                homeworkCalendarTarget === 'given'
                                  ? dateInput === homeworkGivenDate
                                  : dateInput === homeworkDueDate;
                              const disabled =
                                homeworkCalendarTarget === 'due' &&
                                isBeforeDateInput(dateInput, minHomeworkDueDateInput);
                              const inCurrentMonth = dateInput.startsWith(homeworkDueMonthCursor);
                              const dayLabel = `${Number.parseInt(dateInput.slice(8, 10), 10)}`;
                              return (
                                <Pressable
                                  key={dateInput}
                                  disabled={disabled}
                                  style={[
                                    styles.compactCalendarDayCell,
                                    !inCurrentMonth && styles.compactCalendarDayCellOut,
                                    selected && styles.compactCalendarDayCellSelected,
                                    disabled && styles.compactCalendarDayCellDisabled,
                                  ]}
                                  onPress={() => {
                                    if (homeworkCalendarTarget === 'given') {
                                      setHomeworkGivenDate(dateInput);
                                      const nextMinimum = maxDateInput(dateInput, toJerusalemDateInput(new Date().toISOString()));
                                      if (isBeforeDateInput(homeworkDueDate, nextMinimum)) {
                                        setHomeworkDueDate(nextMinimum);
                                      }
                                    } else {
                                      setHomeworkDueDate(dateInput);
                                    }
                                    setHomeworkDuePickerVisible(false);
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.compactCalendarDayText,
                                      !inCurrentMonth && styles.compactCalendarDayTextOut,
                                      selected && styles.compactCalendarDayTextSelected,
                                      disabled && styles.compactCalendarDayTextDisabled,
                                    ]}
                                  >
                                    {dayLabel}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      ) : null}
                    </View>

                    <Text style={styles.modalSectionTitle}>
                      {t(language, { ru: 'Текст задания', en: 'Homework text', he: 'טקסט המשימה' })}
                    </Text>
                    <View
                      onLayout={(event) => {
                        homeworkInputAnchorYRef.current = event.nativeEvent.layout.y;
                      }}
                    >
                      <TextInput
                        value={homeworkDraftText}
                        onChangeText={onHomeworkDraftTextChange}
                        placeholder={t(language, {
                          ru: 'Опишите задание...',
                          en: 'Describe the homework...',
                          he: 'תאר/י את המשימה...',
                        })}
                        placeholderTextColor={COLORS.textMuted}
                        style={[styles.modalInput, styles.multilineInput, { height: homeworkInputHeight }]}
                        multiline
                        scrollEnabled={homeworkInputHeight >= HOMEWORK_INPUT_MAX_HEIGHT}
                        textAlignVertical="top"
                        onFocus={() => {
                          setHomeworkInputFocused(true);
                          setHomeworkDuePickerVisible(false);
                          setTimeout(() => {
                            scrollHomeworkInputIntoView();
                          }, 40);
                        }}
                        onBlur={() => setHomeworkInputFocused(false)}
                        onContentSizeChange={(event) => {
                          if (!homeworkInputAutoGrowEnabled) {
                            return;
                          }
                          const nextHeight = Math.max(
                            HOMEWORK_INPUT_MIN_HEIGHT,
                            Math.min(HOMEWORK_INPUT_MAX_HEIGHT, event.nativeEvent.contentSize.height + 24),
                          );
                          setHomeworkInputHeight((current) => (Math.abs(current - nextHeight) < 1 ? current : nextHeight));
                        }}
                        inputAccessoryViewID={Platform.OS === 'ios' ? HOMEWORK_INPUT_ACCESSORY_ID : undefined}
                      />
                    </View>

                    <Pressable
                      style={[styles.attachButton, homeworkPhotoBusy && styles.attachButtonActive]}
                      onPress={() => void pickHomeworkPhotoFromCamera()}
                      disabled={homeworkPhotoBusy || homeworkSubmitting}
                    >
                      <Ionicons name="camera-outline" size={18} color={COLORS.violet} />
                      <Text style={[styles.attachButtonText, homeworkPhotoBusy && styles.attachButtonTextActive]}>
                        {homeworkPhotoBusy
                          ? t(language, { ru: 'Открываем камеру...', en: 'Opening camera...', he: 'פותח מצלמה...' })
                          : t(language, {
                              ru: 'Снять фото и прикрепить',
                              en: 'Take photo and attach',
                              he: 'צלם/י וצרף/י',
                            })}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[
                        styles.attachButton,
                        (homeworkSpeechRecording || homeworkSpeechBusy) && styles.attachButtonActive,
                      ]}
                      disabled={homeworkSpeechBusy || homeworkSubmitting}
                      onPress={async () => {
                        if (homeworkSpeechBusy || homeworkSubmitting) {
                          return;
                        }
                        setHomeworkSpeechBusy(true);
                        if (homeworkSpeechRecording) {
                          try {
                            await stopHomeworkSpeech();
                          } finally {
                            setHomeworkSpeechBusy(false);
                          }
                        } else {
                          try {
                            await startHomeworkSpeech();
                          } finally {
                            setHomeworkSpeechBusy(false);
                          }
                        }
                      }}
                    >
                      <Ionicons
                        name={homeworkSpeechRecording ? 'stop-circle-outline' : 'mic-outline'}
                        size={18}
                        color={homeworkSpeechRecording ? COLORS.red : COLORS.violet}
                      />
                      <Text
                        style={[
                          styles.attachButtonText,
                          (homeworkSpeechRecording || homeworkSpeechBusy) && styles.attachButtonTextActive,
                        ]}
                      >
                        {homeworkSpeechBusy
                          ? t(language, { ru: 'Подождите...', en: 'Please wait...', he: 'נא להמתין...' })
                          : homeworkSpeechRecording
                            ? t(language, { ru: 'Остановить запись', en: 'Stop recording', he: 'עצור הקלטה' })
                            : t(language, { ru: 'Записать задание', en: 'Record homework', he: 'הקלט/י משימה' })}
                      </Text>
                    </Pressable>
                    {homeworkPhotoUri ? (
                      <Image source={{ uri: homeworkPhotoUri }} style={styles.suggestionPhotoPreviewLarge} />
                    ) : null}
                    {homeworkAudioUri ? (
                      <View style={styles.audioPreviewCard}>
                        <Pressable style={styles.audioPreviewPlayButton} onPress={() => void toggleHomeworkAudioPlayback()}>
                          <Ionicons
                            name={homeworkAudioPlaying ? 'pause' : 'play'}
                            size={16}
                            color="#1E3A8A"
                          />
                        </Pressable>
                        <View style={styles.audioPreviewBody}>
                          <Text style={styles.audioPreviewTitle}>
                            {t(language, { ru: 'Аудио прикреплено', en: 'Audio attached', he: 'אודיו צורף' })}
                          </Text>
                          <Text style={styles.audioPreviewText} numberOfLines={1}>
                            {homeworkAudioUri}
                          </Text>
                        </View>
                        <Pressable
                          style={styles.audioPreviewDeleteButton}
                          onPress={() => {
                            void stopHomeworkAudioPlayback();
                            setHomeworkAudioUri(null);
                            setHomeworkAudioTranscript('');
                          }}
                        >
                          <Ionicons name="trash-outline" size={16} color={COLORS.red} />
                        </Pressable>
                      </View>
                    ) : null}
                    </ScrollView>
                  </View>

                  <View
                    style={[
                      styles.homeworkBottomActions,
                      homeworkInputFocused && homeworkKeyboardInset > 0
                        ? { marginBottom: homeworkKeyboardInset }
                        : null,
                    ]}
                  >
                    <Pressable
                      style={[
                        styles.submitPrimaryButton,
                        styles.homeworkSubmitButton,
                        (homeworkSubmitting || homeworkSubmitSuccess) && styles.submitButtonDisabled,
                      ]}
                      disabled={homeworkSubmitting || homeworkSubmitSuccess}
                      onPress={() => void submitHomeworkForLesson()}
                    >
                      <Text style={styles.submitPrimaryButtonText}>
                        {homeworkSubmitSuccess
                          ? t(language, { ru: '✅ Отправлено', en: '✅ Sent', he: '✅ נשלח' })
                          : t(language, { ru: 'Сохранить', en: 'Save', he: 'שמור' })}
                      </Text>
                    </Pressable>
                    {editingHomeworkId ? (
                      <Pressable
                        style={styles.homeworkDeleteLink}
                        onPress={() =>
                          Alert.alert(
                            t(language, { ru: 'Удалить задание?', en: 'Delete homework?', he: 'למחוק את המשימה?' }),
                            t(language, {
                              ru: 'Это действие нельзя отменить.',
                              en: 'This action cannot be undone.',
                              he: 'לא ניתן לבטל פעולה זו.',
                            }),
                            [
                              { text: t(language, { ru: 'Отмена', en: 'Cancel', he: 'ביטול' }), style: 'cancel' },
                            {
                              text: t(language, { ru: 'Удалить', en: 'Delete', he: 'מחק' }),
                              style: 'destructive',
                              onPress: () => {
                                void deleteHomeworkEntry();
                              },
                            },
                            ],
                          )
                        }
                      >
                        <Text style={styles.homeworkDeleteLinkText}>
                          {t(language, { ru: 'Удалить задание', en: 'Delete homework', he: 'מחק משימה' })}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
          </Animated.View>
          {Platform.OS === 'ios' ? (
            <InputAccessoryView nativeID={HOMEWORK_INPUT_ACCESSORY_ID}>
              <View style={styles.keyboardAccessoryBar}>
                <Pressable style={styles.keyboardAccessoryDoneButton} onPress={Keyboard.dismiss}>
                  <Text style={styles.keyboardAccessoryDoneText}>
                    {t(language, { ru: 'Готово', en: 'Done', he: 'סיום' })}
                  </Text>
                </Pressable>
              </View>
            </InputAccessoryView>
          ) : null}
        </View>
      </Modal>

      <Modal
        visible={studentsVisible}
        animationType="slide"
        onRequestClose={() => {
          reopenStudentsAfterCardRef.current = false;
          setStudentsVisible(false);
        }}
      >
        <View style={styles.studentsScreen}>
          <View style={styles.studentsHeader}>
            <Pressable
              style={styles.suggestionsBackButton}
              onPress={() => {
                reopenStudentsAfterCardRef.current = false;
                setStudentsVisible(false);
              }}
            >
              <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
              <Text style={styles.suggestionsBackText}>Назад</Text>
            </Pressable>
            <Text style={styles.studentsTitle}>{selectedClassName}</Text>
            <View style={styles.studentsHeaderSpacer} />
          </View>

          <ScrollView contentContainerStyle={styles.studentsContent}>
            {selectedClassHomework ? (
              <View style={styles.homeworkTrackerCard}>
                <Text style={styles.homeworkTrackerTitle}>
                  Контроль ДЗ: {dateInputLabel(selectedClassHomework.assigned_date)} →{' '}
                  {dateInputLabel(selectedClassHomework.due_date)}
                </Text>
                <Text style={styles.homeworkTrackerMeta} numberOfLines={2}>
                  {parseHomeworkText(selectedClassHomework.text).body || selectedClassHomework.text}
                </Text>
              </View>
            ) : null}

            {selectedClassStudents.map((student) => {
              const isAbsent = absentStudentsInSelectedClass.has(student.id);
              const studentDone = selectedClassHomework
                ? selectedClassHomework.student_confirmed_ids.includes(student.id)
                : false;
              const parentDone = selectedClassHomework
                ? (parentIdsByChild.get(student.id) ?? []).some((parentId) =>
                    selectedClassHomework.parent_confirmed_ids.includes(parentId),
                  )
                : false;
              return (
                <Pressable
                  key={student.id}
                  style={({ pressed }) => [styles.studentRow, pressed && styles.studentRowPressed]}
                  onPress={() => {
                    void openStudentCard(student.id);
                  }}
                >
                  {student.photo_uri ? (
                    <Image source={{ uri: student.photo_uri }} style={styles.studentAvatar} />
                  ) : (
                    <View style={styles.studentAvatarFallback}>
                      <Text style={styles.studentAvatarFallbackText}>
                        {student.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}

                  <View style={styles.studentMain}>
                    <Text style={styles.studentName}>{student.name}</Text>
                    {selectedClassHomework ? (
                      <View style={styles.studentHomeworkChecksRow}>
                        <View style={styles.studentHomeworkCheckItem}>
                          <View
                            style={[
                              styles.studentHomeworkCheckBox,
                              studentDone
                                ? styles.studentHomeworkCheckBoxStudentDone
                                : styles.studentHomeworkCheckBoxIdle,
                            ]}
                          >
                            <Text style={styles.studentHomeworkCheckMark}>{studentDone ? '✓' : ''}</Text>
                          </View>
                          <Text style={styles.studentHomeworkCheckLabel}>Ученик</Text>
                        </View>

                        <View style={styles.studentHomeworkCheckItem}>
                          <View
                            style={[
                              styles.studentHomeworkCheckBox,
                              parentDone
                                ? styles.studentHomeworkCheckBoxParentDone
                                : styles.studentHomeworkCheckBoxIdle,
                            ]}
                          >
                            <Text style={styles.studentHomeworkCheckMark}>{parentDone ? '✓' : ''}</Text>
                          </View>
                          <Text style={styles.studentHomeworkCheckLabel}>Родитель</Text>
                        </View>
                      </View>
                    ) : null}
                  </View>

                  <View
                    style={[
                      styles.studentStatusBadge,
                      isAbsent ? styles.studentStatusAbsent : styles.studentStatusPresent,
                    ]}
                  >
                    <Text
                      style={[
                        styles.studentStatusText,
                        isAbsent ? styles.studentStatusAbsentText : styles.studentStatusPresentText,
                      ]}
                    >
                      {isAbsent ? 'Отсутствует' : 'Присутствует'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#94A3B8" />
                </Pressable>
              );
            })}

            <View style={styles.classHomeworkSection}>
              <Text style={styles.classHomeworkTitle}>Домашние задания класса</Text>
              {(classHomeworkMap.get(selectedClassId ?? '') ?? []).map((item) => {
                const lesson = snapshot.lessons.find((entry) => entry.id === item.lesson_id);
                const parsed = parseHomeworkText(item.text);
                const dueInput = item.due_date || parsed.due;
                const overdue = dueInput ? diffDays(dueInput, todayDateInput) < 0 : false;
                const selected = selectedClassHomework?.id === item.id;
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.classHomeworkRow,
                      overdue && styles.classHomeworkRowOverdue,
                      selected && styles.classHomeworkRowSelected,
                    ]}
                  >
                    <Pressable style={styles.classHomeworkInfoPress} onPress={() => setSelectedClassHomeworkId(item.id)}>
                      <Text style={[styles.classHomeworkText, overdue && styles.classHomeworkTextOverdue]}>
                        {lesson?.subject ?? 'Урок'} · {parsed.body || item.text}
                      </Text>
                      <Text style={styles.classHomeworkDates}>
                        Дано: {dateInputLabel(item.assigned_date)} | Сдать до: {dateInputLabel(item.due_date)}
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.classHomeworkManageButton}
                      onPress={() => {
                        if (!lesson) {
                          return;
                        }
                        openHomeworkModalForLesson(lesson, item.id);
                      }}
                    >
                      <Text style={styles.classHomeworkManage}>Управление</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={studentCardVisible}
        transparent
        animationType="fade"
        onRequestClose={closeStudentCard}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeStudentCard} />
          <Animated.View
            style={[
              styles.sheetModal,
              styles.studentCardSheetModal,
              { transform: [{ translateY: studentCardTranslateY }] },
            ]}
            {...studentCardPanResponder.panHandlers}
          >
            <View style={styles.sheetTopCloseArea}>
              <View style={styles.sheetTopHandle} />
            </View>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>
                {t(language, { ru: 'Карточка ученика', en: 'Student card', he: 'כרטיס תלמיד' })}
              </Text>
              <Pressable onPress={closeStudentCard}>
                <Ionicons name="close" size={24} color={COLORS.textMain} />
              </Pressable>
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={styles.studentCardContent}
              showsVerticalScrollIndicator={false}
            >
              {studentCardLoading ? (
                <View style={styles.emptyBlock}>
                  <Text style={styles.emptyText}>
                    {t(language, {
                      ru: 'Загружаем карточку ученика...',
                      en: 'Loading student card...',
                      he: 'טוען כרטיס תלמיד...',
                    })}
                  </Text>
                </View>
              ) : null}

              {!studentCardLoading && studentCardError ? (
                <View style={styles.emptyBlock}>
                  <Text style={styles.emptyText}>{studentCardError}</Text>
                </View>
              ) : null}

              {!studentCardLoading && !studentCardError && studentCardDetails ? (
                <>
                  <View style={styles.studentCardIdentity}>
                    {studentCardDetails.student.photo_uri ? (
                      <Image source={{ uri: studentCardDetails.student.photo_uri }} style={styles.studentCardAvatar} />
                    ) : (
                      <View style={styles.studentCardAvatarFallback}>
                        <Text style={styles.studentCardAvatarFallbackText}>
                          {localizePersonName(studentCardDetails.student.name, language).charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}

                    <View style={styles.studentCardIdentityMain}>
                      <View style={styles.studentCardNameRow}>
                        <Text style={styles.studentCardName}>
                          {localizePersonName(studentCardDetails.student.name, language)}
                        </Text>
                        {studentCardDetails.student.is_birthday_today ? (
                          <Text style={styles.studentCardBirthday}>🎂</Text>
                        ) : null}
                      </View>
                      <Text style={styles.studentCardMeta}>
                        {studentCardDetails.student.class_name}
                        {studentCardDetails.student.dob
                          ? ` • ${t(language, { ru: 'ДР', en: 'DOB', he: 'ת״ל' })}: ${dateInputLabel(studentCardDetails.student.dob)}`
                          : ''}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.studentStatusBadge,
                        studentCardDetails.student.status === 'absent'
                          ? styles.studentStatusAbsent
                          : styles.studentStatusPresent,
                      ]}
                    >
                      <Text
                        style={[
                          styles.studentStatusText,
                          studentCardDetails.student.status === 'absent'
                            ? styles.studentStatusAbsentText
                            : styles.studentStatusPresentText,
                        ]}
                      >
                        {studentCardDetails.student.status === 'absent'
                          ? t(language, { ru: 'Отсутствует', en: 'Absent', he: 'נעדר/ת' })
                          : t(language, { ru: 'В школе', en: 'At school', he: 'בבית הספר' })}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.studentCardSection}>
                    <Text style={styles.studentCardSectionTitle}>
                      {t(language, { ru: 'Родители / Опекуны', en: 'Parents / Guardians', he: 'הורים / אפוטרופוסים' })}
                    </Text>
                    {studentCardDetails.parents.length === 0 ? (
                      <Text style={styles.studentCardEmptyText}>
                        {t(language, {
                          ru: 'Связанные родители не найдены.',
                          en: 'No linked parents found.',
                          he: 'לא נמצאו הורים מקושרים.',
                        })}
                      </Text>
                    ) : (
                      studentCardDetails.parents.map((parent) => (
                        <View key={parent.user_id} style={styles.studentCardParentRow}>
                          {parent.photo_uri ? (
                            <Image source={{ uri: parent.photo_uri }} style={styles.studentCardParentAvatar} />
                          ) : (
                            <View style={styles.studentCardParentAvatarFallback}>
                              <Ionicons name="person-outline" size={15} color="#475569" />
                            </View>
                          )}

                          <View style={styles.studentCardParentMain}>
                            <Text style={styles.studentCardParentName}>
                              {localizePersonName(parent.name, language)}
                            </Text>
                            <Text style={styles.studentCardParentMeta}>
                              {parentRelationLabel(parent.relation, language)}
                              {parent.phone ? ` • ${parent.phone}` : ''}
                            </Text>
                          </View>

                          <View style={styles.studentCardParentActions}>
                            <Pressable
                              style={styles.studentCardParentActionButton}
                              onPress={() => {
                                void callParentFromCard(parent.phone);
                              }}
                            >
                              <Ionicons name="call-outline" size={17} color="#0F766E" />
                            </Pressable>
                            <Pressable
                              style={styles.studentCardParentActionButton}
                              onPress={() => {
                                void writeToParentFromCard(parent.user_id);
                              }}
                            >
                              <Ionicons name="chatbubble-ellipses-outline" size={17} color="#4338CA" />
                            </Pressable>
                          </View>
                        </View>
                      ))
                    )}
                  </View>

                  <View style={styles.studentCardSection}>
                    <Text style={styles.studentCardSectionTitle}>
                      {t(language, { ru: 'Учебная сводка', en: 'Academic summary', he: 'סיכום לימודי' })}
                    </Text>
                    <View style={styles.studentCardSummaryRow}>
                      <Text style={styles.studentCardSummaryLabel}>
                        {t(language, { ru: 'Последняя оценка', en: 'Latest grade', he: 'ציון אחרון' })}
                      </Text>
                      <Text style={styles.studentCardSummaryValue}>
                        {studentCardDetails.summary.latest_grade ??
                          t(language, { ru: 'Нет данных', en: 'No data', he: 'אין נתונים' })}
                      </Text>
                    </View>
                    <View style={styles.studentCardSummaryRow}>
                      <Text style={styles.studentCardSummaryLabel}>
                        {t(language, { ru: 'Всего ДЗ по классу', en: 'Total homework', he: 'סה״כ שיעורי בית' })}
                      </Text>
                      <Text style={styles.studentCardSummaryValue}>{studentCardDetails.summary.homework_total}</Text>
                    </View>
                    <View style={styles.studentCardSummaryRow}>
                      <Text style={styles.studentCardSummaryLabel}>
                        {t(language, { ru: 'Просрочено', en: 'Overdue', he: 'באיחור' })}
                      </Text>
                      <Text style={styles.studentCardSummaryValue}>{studentCardDetails.summary.homework_overdue}</Text>
                    </View>
                    <View style={styles.studentCardSummaryRow}>
                      <Text style={styles.studentCardSummaryLabel}>
                        {t(language, {
                          ru: 'Без отметки ученика',
                          en: 'Without student mark',
                          he: 'ללא סימון תלמיד',
                        })}
                      </Text>
                      <Text style={styles.studentCardSummaryValue}>
                        {studentCardDetails.summary.homework_unconfirmed}
                      </Text>
                    </View>
                  </View>
                </>
              ) : null}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      <Modal
        visible={monthPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setMonthPickerVisible(false)}
      >
        <View style={styles.modalBackdropCentered}>
          <View style={styles.rangeModal}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Выберите месяц</Text>
              <Pressable onPress={() => setMonthPickerVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.textMain} />
              </Pressable>
            </View>
            <ScrollView style={styles.datePickerScroll} showsVerticalScrollIndicator={false}>
              {Array.from({ length: 12 }, (_, index) => {
                const monthValue = index + 1;
                const monthText = monthNameFromCursor(
                  `${String(scheduleYearValue).padStart(4, '0')}-${String(monthValue).padStart(2, '0')}`,
                );
                const active = scheduleMonthCursor.endsWith(`-${String(monthValue).padStart(2, '0')}`);
                return (
                  <Pressable
                    key={`month_select_${monthValue}`}
                    style={[styles.weekOptionCard, active && styles.weekOptionCardActive]}
                    onPress={() => {
                      selectScheduleMonth(monthValue);
                    }}
                  >
                    <Text style={[styles.weekOptionTitle, active && styles.weekOptionTitleActive]}>
                      {monthText}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={yearPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setYearPickerVisible(false)}
      >
        <View style={styles.modalBackdropCentered}>
          <View style={styles.rangeModal}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Выберите год</Text>
              <Pressable onPress={() => setYearPickerVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.textMain} />
              </Pressable>
            </View>
            <ScrollView style={styles.datePickerScroll} showsVerticalScrollIndicator={false}>
              {scheduleYearOptions.map((yearOption) => {
                const active = yearOption === scheduleYearValue;
                return (
                  <Pressable
                    key={`year_select_${yearOption}`}
                    style={[styles.weekOptionCard, active && styles.weekOptionCardActive]}
                    onPress={() => {
                      selectScheduleYear(yearOption);
                    }}
                  >
                    <Text style={[styles.weekOptionTitle, active && styles.weekOptionTitleActive]}>
                      {yearOption}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={birthdayGreetingVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setBirthdayGreetingVisible(false);
          setBirthdayGreetingTarget(null);
          setBirthdayGreetingDraft('');
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
          keyboardVerticalOffset={18}
        >
          <View style={styles.sheetModal}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Поздравление</Text>
              <Pressable
                onPress={() => {
                  setBirthdayGreetingVisible(false);
                  setBirthdayGreetingTarget(null);
                  setBirthdayGreetingDraft('');
                }}
              >
                <Ionicons name="close" size={24} color={COLORS.textMain} />
              </Pressable>
            </View>

            {birthdayGreetingTarget ? (
              <>
                <Text style={styles.replyToText}>Кому: {birthdayGreetingTarget.name}</Text>
                <TextInput
                  value={birthdayGreetingDraft}
                  onChangeText={setBirthdayGreetingDraft}
                  placeholder={birthdaySuggestedGreeting(birthdayGreetingTarget)}
                  style={[styles.modalInput, styles.multilineInput]}
                  multiline
                  textAlignVertical="top"
                />
                <Pressable
                  style={[styles.submitPrimaryButton, birthdaySendingId && styles.submitButtonDisabled]}
                  disabled={Boolean(birthdaySendingId)}
                  onPress={() => void submitBirthdayGreeting()}
                >
                  <Text style={styles.submitPrimaryButtonText}>
                    {birthdaySendingId === birthdayGreetingTarget.id
                      ? 'Отправка...'
                      : birthdayCongratulatedIds.includes(birthdayGreetingTarget.id)
                        ? 'Сохранить изменения'
                        : 'Поздравить'}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={replyModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setReplyModalVisible(false);
          setSelectedParentMessage(null);
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
          keyboardVerticalOffset={18}
        >
          <View style={styles.sheetModal}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>
                {t(language, { ru: 'Ответ родителю', en: 'Reply to parent', he: 'תגובה להורה' })}
              </Text>
              <Pressable
                onPress={() => {
                  setReplyModalVisible(false);
                  setSelectedParentMessage(null);
                }}
              >
                <Ionicons name="close" size={24} color={COLORS.textMain} />
              </Pressable>
            </View>

            {selectedParentMessage ? (
              <>
                <Text style={styles.replyToText}>
                  {t(language, { ru: 'Кому', en: 'To', he: 'למי' })}:{' '}
                  {localizePersonName(selectedParentMessage.senderName, language)}
                  {selectedParentMessage.childName
                    ? ` (${localizePersonName(selectedParentMessage.childName, language)})`
                    : ''}
                </Text>
                <TextInput
                  value={replyText}
                  onChangeText={setReplyText}
                  placeholder={t(language, { ru: 'Введите ответ', en: 'Type a reply', he: 'הקלד תגובה' })}
                  style={[styles.modalInput, styles.multilineInput]}
                  multiline
                  textAlignVertical="top"
                />
                <Pressable style={styles.submitPrimaryButton} onPress={() => void sendReplyToParent()}>
                  <Text style={styles.submitPrimaryButtonText}>
                    {t(language, { ru: 'Отправить', en: 'Send', he: 'שלח' })}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={directMessageVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDirectMessageVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
          keyboardVerticalOffset={18}
        >
          <View style={styles.sheetModal}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Новое сообщение</Text>
              <Pressable onPress={() => setDirectMessageVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.textMain} />
              </Pressable>
            </View>

            <Text style={styles.modalSectionTitle}>Кому</Text>
            <View style={styles.chipsWrap}>
              {directMessageTargets.slice(0, 20).map((target) => {
                const selected = target.id === directTargetUserId;
                return (
                  <Pressable
                    key={target.id}
                    style={[styles.optionChip, selected && styles.optionChipActive]}
                    onPress={() => setDirectTargetUserId(target.id)}
                  >
                    <Text style={[styles.optionChipText, selected && styles.optionChipTextActive]}>
                      {target.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.modalSectionTitle}>Сообщение</Text>
            <TextInput
              value={directMessageText}
              onChangeText={setDirectMessageText}
              placeholder="Введите сообщение"
              style={[styles.modalInput, styles.multilineInput]}
              multiline
              textAlignVertical="top"
            />

            <Pressable style={styles.submitPrimaryButton} onPress={() => void sendDirectMessage()}>
              <Text style={styles.submitPrimaryButtonText}>Отправить</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={absenceModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAbsenceModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.sheetModal}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Отметить отсутствующих</Text>
              <Pressable onPress={() => setAbsenceModalVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.textMain} />
              </Pressable>
            </View>

            <ScrollView contentContainerStyle={styles.studentsContent}>
              {selectedLesson
                ? snapshot.users
                    .filter((entry) => entry.role_id === 5 && entry.class_ids.includes(selectedLesson.class_id))
                    .map((student) => {
                      const absent = Boolean(absenceDraft[student.id]);
                      return (
                        <Pressable
                          key={student.id}
                          style={[styles.studentRow, absent && styles.studentRowAbsent]}
                          onPress={() =>
                            setAbsenceDraft((current) => ({
                              ...current,
                              [student.id]: !current[student.id],
                            }))
                          }
                        >
                          <Text style={styles.studentName}>{student.name}</Text>
                          <Text style={styles.studentStatusText}>{absent ? 'Отсутствует' : 'Присутствует'}</Text>
                        </Pressable>
                      );
                    })
                : null}
            </ScrollView>

            <Pressable style={styles.submitPrimaryButton} onPress={() => void saveAbsenceMarks()}>
              <Text style={styles.submitPrimaryButtonText}>Сохранить</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={lessonSummaryVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setLessonSummaryVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
          keyboardVerticalOffset={18}
        >
          <View style={styles.sheetModal}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Описание урока</Text>
              <Pressable onPress={() => setLessonSummaryVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.textMain} />
              </Pressable>
            </View>

            <TextInput
              value={lessonSummaryDraft}
              onChangeText={setLessonSummaryDraft}
              placeholder="Что сделали на уроке, важные заметки..."
              style={[styles.modalInput, styles.multilineInput]}
              multiline
              textAlignVertical="top"
            />

            <Pressable
              style={[styles.submitPrimaryButton, lessonSummarySaving && styles.submitButtonDisabled]}
              onPress={() => void saveLessonSummary()}
              disabled={lessonSummarySaving}
            >
              <Text style={styles.submitPrimaryButtonText}>
                {lessonSummarySaving ? 'Сохраняем...' : 'Сохранить описание'}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={replacementPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setReplacementPickerVisible(false)}
      >
        <View style={styles.modalBackdropCentered}>
          <View style={styles.rangeModal}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Выбрать урок для замены</Text>
              <Pressable onPress={() => setReplacementPickerVisible(false)}>
                <Ionicons name="close" size={24} color={COLORS.textMain} />
              </Pressable>
            </View>

            <ScrollView style={styles.datePickerScroll} showsVerticalScrollIndicator={false}>
              {(selectedLesson
                ? (lessonsByDate.get(toJerusalemDateInput(selectedLesson.start_datetime)) ?? []).filter(
                    (entry) => entry.id !== selectedLesson.id,
                  )
                : []
              ).map((entry) => (
                <Pressable
                  key={entry.id}
                  style={styles.dateOptionRow}
                  onPress={() => {
                    applyReplacement(entry);
                  }}
                >
                  <Text style={styles.dateOptionText}>
                    {entry.subject} · {hhmm(entry.start_datetime)}–{hhmm(entry.end_datetime)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={suggestionsVisible}
        animationType="slide"
        onRequestClose={() => setSuggestionsVisible(false)}
      >
        <View style={styles.suggestionsScreen}>
          <View style={styles.suggestionsHeader}>
            <Pressable style={styles.suggestionsBackButton} onPress={() => setSuggestionsVisible(false)}>
              <Ionicons name="arrow-back" size={20} color={COLORS.textMain} />
              <Text style={styles.suggestionsBackText}>Назад</Text>
            </Pressable>
            <Text style={styles.suggestionsTitle}>Школьные предложения</Text>
            <View style={styles.suggestionsHeaderActions}>
              <Pressable
                style={styles.newSuggestionButton}
                onPress={() => {
                  setSuggestionsVisible(false);
                  setTimeout(() => {
                    setSuggestionFormVisible(true);
                  }, 30);
                }}
              >
                <Ionicons name="add" size={16} color="#FFFFFF" />
                <Text style={styles.newSuggestionButtonText}>+ Новое</Text>
              </Pressable>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.suggestionsContent}>
            {orderedSuggestions.map((entry) => {
              const category = suggestionCategoryView(entry.category);
              const status = suggestionStatusView(entry.status);
              const rejected = entry.status === 'rejected';
              const ownSuggestion = entry.authorId === user.id;
              const canDelete = ownSuggestion && entry.archived;
              const linkedFeedback = feedbackById.get(entry.id);
              const localizedFeedbackText = linkedFeedback
                ? getLocalizedText(
                    linkedFeedback.text_original,
                    ensureTranslationMap(
                      linkedFeedback.text_original,
                      linkedFeedback.lang_original,
                      linkedFeedback.translations,
                    ),
                    language,
                    showOriginal,
                  )
                : null;
              const feedbackLines = localizedFeedbackText
                ? localizedFeedbackText
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                : [];
              const displayTitle = feedbackLines[0] ?? entry.title;
              const displayDescription = feedbackLines.slice(1).join(' ') || localizedFeedbackText || entry.description;
              const suggestionCard = (
                <View style={styles.suggestionCard}>
                  <View
                    style={[
                      styles.suggestionCategoryIconWrap,
                      { backgroundColor: `${(rejected ? '#94A3B8' : category.color)}22` },
                    ]}
                  >
                    {rejected ? (
                      <Ionicons name="close-circle-outline" size={18} color="#64748B" />
                    ) : (
                      <MaterialCommunityIcons name={category.icon} size={18} color={category.color} />
                    )}
                  </View>

                  <View style={styles.suggestionBody}>
                    <Text style={styles.suggestionCardTitle}>{displayTitle}</Text>
                    <Text style={styles.suggestionCardDescription}>{displayDescription}</Text>
                    {entry.photoUri ? (
                      <Image source={{ uri: entry.photoUri }} style={styles.suggestionPhotoPreview} />
                    ) : null}
                    {entry.archived ? <Text style={styles.suggestionArchivedNote}>В архиве</Text> : null}
                  </View>

                  <View style={[styles.suggestionStatusBadge, { backgroundColor: status.bg }]}>
                    <Text style={[styles.suggestionStatusText, { color: status.text }]}>{status.label}</Text>
                  </View>
                </View>
              );

              if (!ownSuggestion) {
                return <View key={entry.id}>{suggestionCard}</View>;
              }

              return (
                <ScrollView
                  key={entry.id}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.suggestionSwipeRow}
                >
                  {suggestionCard}
                  <View style={styles.suggestionActionWrap}>
                    <Pressable
                      style={[
                        styles.suggestionActionButton,
                        canDelete ? styles.suggestionActionDeleteButton : styles.suggestionActionArchiveButton,
                      ]}
                      onPress={() => {
                        if (canDelete) {
                          setSuggestions((current) => current.filter((item) => item.id !== entry.id));
                          return;
                        }
                        setSuggestions((current) =>
                          current.map((item) =>
                            item.id === entry.id
                              ? {
                                  ...item,
                                  archived: true,
                                }
                              : item,
                          ),
                        );
                      }}
                    >
                      <Ionicons
                        name={canDelete ? 'trash-outline' : 'archive-outline'}
                        size={18}
                        color="#FFFFFF"
                      />
                      <Text style={styles.suggestionActionButtonText}>{canDelete ? 'Удалить' : 'Архив'}</Text>
                    </Pressable>
                  </View>
                </ScrollView>
              );
            })}
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={suggestionFormVisible}
        animationType="slide"
        transparent
        onRequestClose={closeSuggestionForm}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
          keyboardVerticalOffset={18}
        >
          <Pressable style={styles.modalBackdrop} onPress={Keyboard.dismiss}>
            <View style={styles.suggestionFormModal}>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                showsVerticalScrollIndicator={false}
              >
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>Новое предложение</Text>
              <Pressable style={styles.modalBackInlineButton} onPress={closeSuggestionForm}>
                <Ionicons name="arrow-back" size={18} color={COLORS.textMain} />
                <Text style={styles.modalBackInlineText}>Назад</Text>
              </Pressable>
            </View>

            <Animated.View
              style={[
                styles.suggestionAnimatedForm,
                {
                  transform: [{ translateY: suggestionFlyY }],
                  opacity: suggestionFlyOpacity,
                },
              ]}
            >
              <TextInput
                style={[styles.modalInput, styles.multilineInput]}
                placeholder="Текст предложения"
                value={suggestionDescription}
                onChangeText={setSuggestionDescription}
                multiline
                textAlignVertical="top"
              />

              <View style={styles.suggestionAudienceGroup}>
                <Text style={styles.suggestionAudienceLabel}>Кому показывать</Text>
                <View style={styles.suggestionAudienceRow}>
                  {([
                    { key: 'all', label: 'Всем' },
                    { key: 'no_students', label: 'Всем кроме детей' },
                    { key: 'director_only', label: 'Только директору' },
                  ] as Array<{ key: SuggestionAudience; label: string }>).map((entry) => {
                    const active = suggestionAudience === entry.key;
                    return (
                      <Pressable
                        key={entry.key}
                        style={[
                          styles.suggestionAudienceButton,
                          active && styles.suggestionAudienceButtonActive,
                        ]}
                        onPress={() => setSuggestionAudience(entry.key)}
                      >
                        <Text
                          style={[
                            styles.suggestionAudienceButtonText,
                            active && styles.suggestionAudienceButtonTextActive,
                          ]}
                        >
                          {entry.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.suggestionMediaActions}>
                <Pressable style={styles.attachButton} onPress={() => void pickSuggestionMedia()}>
                  <Ionicons name="images-outline" size={18} color={COLORS.violet} />
                  <Text style={styles.attachButtonText}>Из галереи</Text>
                </Pressable>
                <Pressable style={styles.attachButton} onPress={() => void takeSuggestionPhoto()}>
                  <Ionicons name="camera-outline" size={18} color={COLORS.violet} />
                  <Text style={styles.attachButtonText}>Сделать фото</Text>
                </Pressable>
              </View>

              {suggestionPhotoUri ? (
                <Image source={{ uri: suggestionPhotoUri }} style={styles.suggestionPhotoPreviewLarge} />
              ) : null}

              <Pressable
                style={[styles.submitPrimaryButton, submittingSuggestion && styles.submitButtonDisabled]}
                disabled={submittingSuggestion}
                onPress={submitSuggestion}
              >
                <Text style={styles.submitPrimaryButtonText}>Отправить</Text>
              </Pressable>
            </Animated.View>

            {suggestionSuccessVisible ? (
              <Animated.View
                style={[
                  styles.suggestionSuccessWrap,
                  {
                    opacity: suggestionSuccessOpacity,
                    transform: [{ scale: suggestionSuccessScale }],
                  },
                ]}
              >
                <View style={styles.successIconCircle}>
                  <Ionicons name="checkmark-done" size={38} color="#16A34A" />
                </View>
                <Text style={styles.successTitle}>Принято</Text>
                <Text style={styles.successText}>Заявка отправлена администрации</Text>
              </Animated.View>
            ) : null}
              </ScrollView>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.pageBg,
  },
  scrollContent: {
    paddingBottom: 104,
  },
  stickyHeaderWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
  },
  headerGradient: {
    flex: 1,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerUserName: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 34,
    flexShrink: 1,
  },
  headerIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flex: 1,
  },
  headerAvatarTapArea: {
    borderRadius: 999,
  },
  stickyIdentityTextCol: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  headerRoleBadge: {
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  headerRoleText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  headerAvatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  headerAvatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  headerAvatarFallbackText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
  },
  notificationsButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationsBadge: {
    position: 'absolute',
    top: -4,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notificationsBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  headerBottomBlur: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -2,
    height: 12,
  },
  importantCard: {
    marginTop: 12,
    marginHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
    gap: 8,
  },
  parentMessageHeader: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  parentMessageTitle: {
    flex: 1,
    color: '#B91C1C',
    fontSize: 14,
    fontWeight: '800',
  },
  importantText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '500',
  },
  parentMessageActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  parentActionButton: {
    backgroundColor: '#F8FAFC',
    borderColor: '#D1D5DB',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  parentActionText: {
    color: '#4F46E5',
    fontSize: 12,
    fontWeight: '700',
  },
  parentActionGhost: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  parentActionGhostText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  importantMessagesDot: {
    position: 'absolute',
    top: -2,
    right: 0,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  statsGrid: {
    marginTop: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  bigStatCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 24,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 15,
    elevation: 3,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  statValue: {
    fontSize: 19,
    fontWeight: '800',
    color: COLORS.textMain,
  },
  nextLessonTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nextLessonLink: {
    color: COLORS.violet,
    fontSize: 12,
    fontWeight: '700',
  },
  smallStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  smallStatCard: {
    flex: 1,
    backgroundColor: COLORS.cardBg,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 15,
    elevation: 2,
  },
  smallStatLabel: {
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
    marginBottom: 6,
  },
  smallStatLabelCompact: {
    fontSize: 11,
  },
  smallStatValue: {
    fontSize: 22,
    color: COLORS.textMain,
    fontWeight: '800',
  },
  sectionHeaderRow: {
    marginTop: 18,
    marginBottom: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textMain,
  },
  sectionAction: {
    fontSize: 14,
    color: COLORS.violet,
    fontWeight: '700',
  },
  sectionHint: {
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  lessonsListContainer: {
    paddingHorizontal: 16,
    gap: 10,
  },
  lessonCard: {
    position: 'relative',
    backgroundColor: COLORS.cardBg,
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 15,
    elevation: 2,
  },
  changedAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    borderTopLeftRadius: 24,
    borderBottomLeftRadius: 24,
    backgroundColor: '#F59E0B',
  },
  lessonOrderCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lessonOrderText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 16,
  },
  lessonMainInfo: {
    flex: 1,
  },
  lessonSubjectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lessonSubject: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textMain,
  },
  lessonSubjectCanceled: {
    textDecorationLine: 'line-through',
    color: '#7F1D1D',
  },
  liveBadge: {
    backgroundColor: '#DCFCE7',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  liveBadgeText: {
    color: '#15803D',
    fontSize: 10,
    fontWeight: '800',
  },
  lessonSubMeta: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  changedText: {
    marginTop: 5,
    fontSize: 12,
    color: '#C2410C',
    fontWeight: '700',
  },
  lessonHomeworkReady: {
    color: '#16A34A',
    fontSize: 12,
    fontWeight: '700',
  },
  lessonHomeworkReadyChip: {
    marginTop: 6,
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#86EFAC',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  lessonHomeworkEmptyChip: {
    marginTop: 6,
    alignSelf: 'flex-start',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  lessonHomeworkEmptyText: {
    color: '#4338CA',
    fontSize: 11,
    fontWeight: '700',
  },
  lessonCanceledText: {
    marginTop: 5,
    fontSize: 12,
    color: '#B91C1C',
    fontWeight: '800',
  },
  lessonHolidayNote: {
    marginTop: 6,
    color: '#B45309',
    fontSize: 12,
    fontWeight: '700',
  },
  lessonTimeWrap: {
    alignItems: 'flex-end',
  },
  lessonTimeRight: {
    fontSize: 16,
    lineHeight: 20,
    color: COLORS.textMain,
    fontWeight: '800',
    textAlign: 'right',
  },
  lessonTimeSeparator: {
    color: '#94A3B8',
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
  },
  lessonTimeLive: {
    color: '#16A34A',
  },
  lessonHolidayTime: {
    color: '#B45309',
    fontSize: 12,
    fontWeight: '700',
  },
  replacedBadge: {
    position: 'absolute',
    right: 10,
    top: 10,
    borderRadius: 999,
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  replacedBadgeText: {
    color: '#1D4ED8',
    fontSize: 10,
    fontWeight: '700',
  },
  emptyBlock: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    gap: 6,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  suggestionBanner: {
    marginTop: 14,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  quickHomeworkButton: {
    marginTop: 10,
    marginHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#0F766E',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  quickHomeworkText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  suggestionBannerGradient: {
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  suggestionBannerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionBannerTextWrap: {
    flex: 1,
  },
  suggestionBannerTitle: {
    color: COLORS.textMain,
    fontWeight: '800',
    fontSize: 15,
  },
  suggestionBannerText: {
    marginTop: 2,
    color: COLORS.textMuted,
    fontWeight: '500',
    fontSize: 13,
  },
  addLessonButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.violet,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  addLessonButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  scheduleHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  calendarButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4F46E5',
  },
  rangeInfoCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: '#EEF2FF',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  rangeInfoText: {
    color: '#4338CA',
    fontSize: 13,
    fontWeight: '700',
  },
  weekNavigationRow: {
    marginHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekNavButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#FFFFFF',
  },
  weekNavButtonText: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
  weekNavCenterText: {
    color: COLORS.textMuted,
    fontSize: 14,
    fontWeight: '800',
  },
  monthCalendarCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  calendarMonthYearRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  calendarMonthYearChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  calendarMonthYearChipText: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
  monthCalendarWeekdaysRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  monthCalendarWeekdayText: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  monthCalendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  monthCalendarDayCell: {
    position: 'relative',
    width: `${100 / 7}%`,
    aspectRatio: 1,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#FFFFFF',
  },
  monthCalendarDayCellOut: {
    opacity: 0.58,
  },
  monthCalendarDayCellWeekend: {
    backgroundColor: '#F8FAFC',
  },
  monthCalendarDayCellPast: {
    backgroundColor: '#F1F5F9',
  },
  monthCalendarDayCellSelected: {
    borderColor: '#6366F1',
    backgroundColor: '#EEF2FF',
  },
  monthCalendarDayText: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
  monthCalendarDayTextOut: {
    color: '#94A3B8',
  },
  monthCalendarDayTextPast: {
    color: '#94A3B8',
  },
  monthCalendarDayTextSelected: {
    color: '#4338CA',
    fontWeight: '800',
  },
  monthCalendarMarker: {
    marginTop: 2,
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'center',
  },
  monthCalendarLessonCountBadge: {
    position: 'absolute',
    top: 3,
    right: 3,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthCalendarLessonCountText: {
    color: '#475569',
    fontSize: 9,
    fontWeight: '800',
  },
  monthCalendarTodayRing: {
    position: 'absolute',
    top: 3,
    right: 3,
    bottom: 3,
    left: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#22C55E',
  },
  calendarLegendRow: {
    marginHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  calendarLegendItem: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  selectedDayMetaCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  selectedDayMetaTitle: {
    color: COLORS.textMain,
    fontSize: 14,
    fontWeight: '800',
  },
  selectedDayMetaText: {
    marginTop: 2,
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  selectedDayHolidayText: {
    marginTop: 2,
    color: '#B45309',
    fontSize: 12,
    fontWeight: '700',
  },
  daysRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 8,
  },
  daysWeekRow: {
    marginHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    gap: 4,
  },
  dayChip: {
    minWidth: 50,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
  },
  dayChipCompact: {
    flex: 1,
    minWidth: 0,
    height: 38,
    borderRadius: 12,
    paddingHorizontal: 0,
  },
  dayChipActive: {
    backgroundColor: COLORS.violet,
    borderColor: COLORS.violet,
  },
  dayChipText: {
    fontWeight: '700',
    color: COLORS.textMuted,
  },
  dayChipTextCompact: {
    fontSize: 12,
  },
  dayChipDateText: {
    marginTop: 2,
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
  },
  dayChipDateTextActive: {
    color: '#FFFFFF',
  },
  dayChipTextActive: {
    color: '#FFFFFF',
  },
  dayChipEmoji: {
    marginTop: 2,
    fontSize: 10,
  },
  dayChipLessonDot: {
    marginTop: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#94A3B8',
  },
  dayChipLessonDotActive: {
    backgroundColor: '#E9D5FF',
  },
  birthdayDot: {
    marginTop: 4,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#EC4899',
  },
  birthdayDotActive: {
    backgroundColor: '#FBCFE8',
  },
  dayChipDot: {
    marginTop: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F97316',
  },
  birthdayPanel: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F9A8D4',
    backgroundColor: '#FDF2F8',
    padding: 10,
    gap: 8,
  },
  birthdayPanelTitle: {
    color: '#9D174D',
    fontSize: 15,
    fontWeight: '800',
  },
  birthdayCardRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FBCFE8',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 9,
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
    borderWidth: 1,
    borderColor: '#DDD6FE',
    backgroundColor: '#F5F3FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  birthdayName: {
    color: COLORS.textMain,
    fontWeight: '700',
    fontSize: 13,
  },
  birthdayMeta: {
    color: COLORS.textMuted,
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
    paddingVertical: 7,
  },
  birthdayActionButtonDone: {
    backgroundColor: '#9333EA',
  },
  birthdayActionButtonDisabled: {
    opacity: 0.55,
  },
  birthdayActionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  taskCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 24,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 15,
    elevation: 2,
  },
  taskTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.textMain,
  },
  taskMeta: {
    marginTop: 3,
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  taskText: {
    marginTop: 10,
    fontSize: 14,
    color: COLORS.textMain,
    fontWeight: '500',
    lineHeight: 20,
  },
  messageActionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  classCard: {
    backgroundColor: COLORS.cardBg,
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 15,
    elevation: 2,
  },
  classCardWrap: {
    gap: 8,
  },
  classHomeworkExpandButton: {
    alignSelf: 'flex-start',
    marginLeft: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  classHomeworkExpandText: {
    color: '#4F46E5',
    fontSize: 12,
    fontWeight: '700',
  },
  classHomeworkInlineList: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  classHomeworkInlineEmpty: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  classHomeworkInlineRow: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  classHomeworkInlineTitle: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
  classHomeworkInlineBody: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 16,
  },
  classBadge: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  classBadgeText: {
    color: '#4F46E5',
    fontWeight: '800',
  },
  classInfo: {
    flex: 1,
  },
  classTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textMain,
  },
  classMeta: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  profileTopCard: {
    marginTop: 14,
    marginHorizontal: 16,
    borderRadius: 28,
    paddingVertical: 24,
    alignItems: 'center',
  },
  profileAvatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  profileAvatarImage: {
    width: 78,
    height: 78,
    borderRadius: 39,
  },
  profileAvatarText: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
  },
  profileName: {
    marginTop: 10,
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 24,
  },
  profileSub: {
    marginTop: 2,
    color: '#E2E8F0',
    fontWeight: '600',
  },
  profileActionsCard: {
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: COLORS.cardBg,
    borderRadius: 24,
    padding: 12,
    gap: 8,
  },
  profileActionButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileActionText: {
    color: COLORS.textMain,
    fontWeight: '600',
  },
  logoutActionButton: {
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
  },
  logoutActionText: {
    color: COLORS.red,
    fontWeight: '700',
  },
  profileInfoCard: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: COLORS.cardBg,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  profileInfoTitle: {
    color: COLORS.textMain,
    fontSize: 16,
    fontWeight: '800',
  },
  profileInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.textMain,
  },
  profileInfoSub: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  profileInfoSubStrong: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  profileChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  profileSubjectChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  profileSubjectChipEditable: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  profileSubjectRemoveButton: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileSubjectChipText: {
    color: '#4338CA',
    fontSize: 12,
    fontWeight: '700',
  },
  profileSubjectSelectChip: {
    borderRadius: 999,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  profileSubjectSelectChipActive: {
    backgroundColor: '#E0E7FF',
  },
  profileSubjectSelectChipText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
  },
  profileSubjectSelectChipTextActive: {
    color: '#4338CA',
    fontWeight: '700',
  },
  profileSubjectEditorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileSubjectInput: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    fontWeight: '500',
    color: COLORS.textMain,
  },
  profileSubjectAddButton: {
    borderRadius: 12,
    backgroundColor: COLORS.violet,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  profileSubjectAddButtonDisabled: {
    opacity: 0.5,
  },
  profileSubjectAddText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  profileLessonList: {
    marginTop: 2,
    gap: 8,
  },
  profileLessonRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileLessonText: {
    flex: 1,
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
  profileLessonEditButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#93C5FD',
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  profileLessonEditText: {
    color: '#1D4ED8',
    fontSize: 11,
    fontWeight: '700',
  },
  profileHomeroomToggle: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileHomeroomToggleDisabled: {
    opacity: 0.6,
  },
  profileHomeroomToggleText: {
    color: COLORS.textMain,
    fontSize: 13,
    fontWeight: '700',
  },
  profileClassChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  profileClassChipActive: {
    borderColor: '#22C55E',
    backgroundColor: '#DCFCE7',
  },
  profileClassChipText: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
  profileClassChipTextActive: {
    color: '#166534',
  },
  bottomNavBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    flexDirection: 'row',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 10,
  },
  bottomNavItem: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  bottomNavIcon: {
    marginBottom: 1,
  },
  bottomNavLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  bottomNavLabelActive: {
    color: COLORS.violet,
    fontWeight: '700',
  },
  activeDot: {
    marginTop: 2,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'transparent',
  },
  activeDotVisible: {
    backgroundColor: COLORS.violet,
  },
  navMessageDot: {
    position: 'absolute',
    top: 0,
    right: '30%',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.35)',
    justifyContent: 'flex-end',
  },
  modalBackdropCentered: {
    flex: 1,
    backgroundColor: 'rgba(2,6,23,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  sheetModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    maxHeight: '92%',
  },
  homeworkSheetModal: {
    height: '86%',
  },
  sheetTopCloseArea: {
    alignItems: 'center',
    paddingTop: 2,
    paddingBottom: 12,
    minHeight: 34,
  },
  sheetTopHandleTapZone: {
    width: 140,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  sheetTopHandle: {
    width: 56,
    height: 6,
    borderRadius: 4,
    backgroundColor: '#CBD5E1',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  modalBackInlineButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  modalBackInlineText: {
    color: COLORS.textMain,
    fontSize: 14,
    fontWeight: '700',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.textMain,
  },
  modalSectionTitle: {
    marginTop: 8,
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.textMain,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.chipBorder,
    backgroundColor: COLORS.chipBg,
  },
  optionChipActive: {
    backgroundColor: COLORS.violet,
    borderColor: COLORS.violet,
  },
  optionChipGreenActive: {
    backgroundColor: '#10B981',
    borderColor: '#10B981',
  },
  optionChipText: {
    color: '#475569',
    fontWeight: '600',
    fontSize: 13,
  },
  optionChipTextActive: {
    color: '#FFFFFF',
  },
  optionChipGreenTextActive: {
    color: '#FFFFFF',
  },
  timeSlotsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  timeSlotChip: {
    width: '48%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
    alignItems: 'center',
  },
  timeSlotChipActive: {
    backgroundColor: COLORS.violet,
    borderColor: COLORS.violet,
  },
  timeSlotText: {
    fontSize: 12,
    color: COLORS.textMain,
    fontWeight: '600',
  },
  timeSlotTextActive: {
    color: '#FFFFFF',
  },
  inputStack: {
    marginTop: 14,
    gap: 8,
    marginBottom: 8,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    color: COLORS.textMain,
    backgroundColor: '#FFFFFF',
    fontWeight: '500',
  },
  lessonSummaryCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  lessonSummaryTitle: {
    color: COLORS.textMain,
    fontSize: 16,
    fontWeight: '800',
  },
  lessonSummaryMeta: {
    marginTop: 2,
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  homeworkScrollArea: {
    flex: 1,
  },
  homeworkFormContent: {
    paddingBottom: 10,
  },
  homeworkDateCard: {
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 6,
  },
  homeworkDatesMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  homeworkIssuedField: {
    flexShrink: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  homeworkIssuedText: {
    flexShrink: 1,
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
  },
  homeworkDeadlineField: {
    flex: 1,
    minHeight: 34,
    borderRadius: 10,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  homeworkDeadlineFieldActive: {
    backgroundColor: '#EAF2FF',
  },
  homeworkDeadlineText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '600',
  },
  homeworkQuickDatesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  homeworkQuickDateChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  homeworkQuickDateChipText: {
    color: '#334155',
    fontSize: 10,
    fontWeight: '600',
  },
  homeworkBottomActions: {
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: '#FFFFFF',
  },
  keyboardAccessoryBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'flex-end',
  },
  keyboardAccessoryDoneButton: {
    borderRadius: 10,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  keyboardAccessoryDoneText: {
    color: COLORS.violet,
    fontSize: 14,
    fontWeight: '700',
  },
  homeworkSubmitButton: {
    marginTop: 0,
  },
  homeworkDeleteLink: {
    marginTop: 10,
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  homeworkDeleteLinkText: {
    color: COLORS.red,
    fontSize: 14,
    fontWeight: '700',
  },
  homeworkDateLine: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
  },
  homeworkDatePickerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 10,
    backgroundColor: 'transparent',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  homeworkDatePickerText: {
    color: COLORS.textMain,
    fontSize: 13,
    fontWeight: '600',
  },
  dateFieldsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  dateFieldColumn: {
    flex: 1,
  },
  rangeModal: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  datePickerScroll: {
    maxHeight: 320,
  },
  dateOptionRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  dateOptionRowSelected: {
    borderColor: '#6366F1',
    backgroundColor: '#EEF2FF',
  },
  dateOptionText: {
    color: COLORS.textMain,
    fontSize: 14,
    fontWeight: '700',
  },
  dateOptionTextSelected: {
    color: '#4338CA',
  },
  compactCalendarWrap: {
    borderRadius: 14,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  compactCalendarMonthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  compactCalendarNavButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  compactCalendarMonthLabel: {
    color: COLORS.textMain,
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  compactCalendarWeekdaysRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  compactCalendarWeekdayText: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  compactCalendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  compactCalendarDayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    marginBottom: 2,
  },
  compactCalendarDayCellOut: {
    opacity: 0.65,
  },
  compactCalendarDayCellSelected: {
    backgroundColor: '#EAF2FF',
  },
  compactCalendarDayCellDisabled: {
    opacity: 0.35,
  },
  compactCalendarDayText: {
    color: COLORS.textMain,
    fontSize: 13,
    fontWeight: '600',
  },
  compactCalendarDayTextOut: {
    color: '#64748B',
  },
  compactCalendarDayTextSelected: {
    color: '#1D4ED8',
    fontWeight: '700',
  },
  compactCalendarDayTextDisabled: {
    color: '#94A3B8',
  },
  weekOptionCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  weekOptionCardActive: {
    borderColor: '#6366F1',
    backgroundColor: '#EEF2FF',
  },
  weekOptionTitle: {
    color: COLORS.textMain,
    fontSize: 14,
    fontWeight: '800',
  },
  weekOptionTitleActive: {
    color: '#4338CA',
  },
  weekOptionDays: {
    marginTop: 4,
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  weekOptionDaysActive: {
    color: '#4F46E5',
  },
  submitPrimaryButton: {
    marginTop: 14,
    backgroundColor: COLORS.violet,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitPrimaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  actionsModal: {
    marginHorizontal: 16,
    marginBottom: 42,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 8,
  },
  infoBlocksRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  infoBlock: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  infoBlockLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
    fontWeight: '600',
  },
  infoBlockValue: {
    marginTop: 2,
    fontSize: 13,
    color: COLORS.textMain,
    fontWeight: '700',
  },
  actionButtonEdit: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#93C5FD',
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButtonEditPressed: {
    backgroundColor: '#EFF6FF',
  },
  actionButtonEditText: {
    fontSize: 14,
    color: '#2563EB',
    fontWeight: '700',
  },
  actionButtonRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButtonRowPressed: {
    backgroundColor: '#F8FAFC',
  },
  actionButtonDanger: {
    borderColor: '#FECACA',
  },
  actionButtonDangerPressed: {
    backgroundColor: '#FEF2F2',
  },
  actionButtonInfo: {
    borderColor: '#BFDBFE',
  },
  actionButtonInfoPressed: {
    backgroundColor: '#EFF6FF',
  },
  actionButtonText: {
    fontSize: 14,
    color: COLORS.textMain,
    fontWeight: '600',
  },
  homeworkActionText: {
    color: '#0F766E',
    fontWeight: '700',
  },
  replyToText: {
    marginBottom: 8,
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  actionButtonDangerText: {
    fontSize: 14,
    color: COLORS.red,
    fontWeight: '700',
  },
  suggestionsScreen: {
    flex: 1,
    backgroundColor: COLORS.pageBg,
  },
  suggestionsHeader: {
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  suggestionsBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    minWidth: 72,
  },
  suggestionsBackText: {
    color: COLORS.textMain,
    fontSize: 15,
    fontWeight: '700',
  },
  suggestionsTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    color: COLORS.textMain,
    fontWeight: '800',
  },
  suggestionsHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  newSuggestionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.violet,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  newSuggestionButtonText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  studentsScreen: {
    flex: 1,
    backgroundColor: COLORS.pageBg,
  },
  studentsHeader: {
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
  },
  studentsHeaderSpacer: {
    width: 72,
  },
  studentsTitle: {
    flex: 1,
    textAlign: 'center',
    color: COLORS.textMain,
    fontSize: 22,
    fontWeight: '800',
  },
  studentsContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  studentRow: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  studentRowPressed: {
    opacity: 0.85,
  },
  studentRowAbsent: {
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  studentAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  studentAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E2E8F0',
  },
  studentAvatarFallbackText: {
    color: '#334155',
    fontWeight: '800',
    fontSize: 14,
  },
  studentMain: {
    flex: 1,
    gap: 6,
  },
  studentName: {
    color: COLORS.textMain,
    fontSize: 15,
    fontWeight: '700',
  },
  studentHomeworkChecksRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  studentHomeworkCheckItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  studentHomeworkCheckBox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  studentHomeworkCheckBoxIdle: {
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
  },
  studentHomeworkCheckBoxStudentDone: {
    borderColor: '#7C3AED',
    backgroundColor: '#7C3AED',
  },
  studentHomeworkCheckBoxParentDone: {
    borderColor: '#16A34A',
    backgroundColor: '#16A34A',
  },
  studentHomeworkCheckMark: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 12,
  },
  studentHomeworkCheckLabel: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
  },
  studentStatusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  studentStatusPresent: {
    backgroundColor: '#DCFCE7',
  },
  studentStatusAbsent: {
    backgroundColor: '#FEE2E2',
  },
  studentStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  studentStatusPresentText: {
    color: '#166534',
  },
  studentStatusAbsentText: {
    color: '#B91C1C',
  },
  classHomeworkSection: {
    marginTop: 12,
    gap: 8,
  },
  homeworkTrackerCard: {
    borderWidth: 1,
    borderColor: '#DBEAFE',
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  homeworkTrackerTitle: {
    color: '#1E3A8A',
    fontWeight: '800',
    fontSize: 13,
  },
  homeworkTrackerMeta: {
    color: '#334155',
    fontSize: 12,
  },
  classHomeworkTitle: {
    color: COLORS.textMain,
    fontSize: 16,
    fontWeight: '800',
  },
  classHomeworkRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 6,
  },
  classHomeworkRowSelected: {
    borderColor: '#6366F1',
    backgroundColor: '#EEF2FF',
  },
  classHomeworkRowOverdue: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  classHomeworkInfoPress: {
    gap: 4,
  },
  classHomeworkText: {
    color: COLORS.textMain,
    fontSize: 13,
    fontWeight: '600',
  },
  classHomeworkDates: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  classHomeworkTextOverdue: {
    color: '#64748B',
  },
  classHomeworkManageButton: {
    alignSelf: 'flex-start',
    marginTop: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  classHomeworkManage: {
    color: '#4F46E5',
    fontSize: 12,
    fontWeight: '700',
  },
  studentCardSheetModal: {
    width: '100%',
    maxHeight: '86%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    alignSelf: 'flex-end',
  },
  studentCardContent: {
    gap: 10,
    paddingBottom: 8,
  },
  studentCardIdentity: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  studentCardAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  studentCardAvatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E2E8F0',
  },
  studentCardAvatarFallbackText: {
    color: '#334155',
    fontWeight: '800',
    fontSize: 18,
  },
  studentCardIdentityMain: {
    flex: 1,
    gap: 2,
  },
  studentCardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  studentCardName: {
    color: COLORS.textMain,
    fontSize: 18,
    fontWeight: '800',
  },
  studentCardBirthday: {
    fontSize: 18,
  },
  studentCardMeta: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  studentCardSection: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  studentCardSectionTitle: {
    color: COLORS.textMain,
    fontSize: 15,
    fontWeight: '800',
  },
  studentCardEmptyText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  studentCardParentRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  studentCardParentAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  studentCardParentAvatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E2E8F0',
  },
  studentCardParentMain: {
    flex: 1,
    gap: 2,
  },
  studentCardParentName: {
    color: COLORS.textMain,
    fontSize: 14,
    fontWeight: '700',
  },
  studentCardParentMeta: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  studentCardParentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  studentCardParentActionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  studentCardSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  studentCardSummaryLabel: {
    flex: 1,
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
  },
  studentCardSummaryValue: {
    color: COLORS.textMain,
    fontSize: 13,
    fontWeight: '800',
  },
  suggestionsContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 10,
  },
  suggestionSwipeRow: {
    width: '100%',
    alignItems: 'stretch',
  },
  suggestionCard: {
    position: 'relative',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 14,
    flexDirection: 'row',
    gap: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 15,
    elevation: 2,
    width: 320,
  },
  suggestionActionWrap: {
    width: 92,
    borderRadius: 18,
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionActionButton: {
    width: '100%',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
  },
  suggestionActionArchiveButton: {
    backgroundColor: '#475569',
  },
  suggestionActionDeleteButton: {
    backgroundColor: '#DC2626',
  },
  suggestionActionButtonText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  suggestionCategoryIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionBody: {
    flex: 1,
    paddingRight: 92,
  },
  suggestionCardTitle: {
    fontSize: 15,
    color: COLORS.textMain,
    fontWeight: '800',
  },
  suggestionCardDescription: {
    marginTop: 4,
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
    lineHeight: 18,
  },
  suggestionArchivedNote: {
    marginTop: 5,
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
  },
  suggestionStatusBadge: {
    position: 'absolute',
    right: 12,
    top: 12,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  suggestionStatusText: {
    fontSize: 11,
    fontWeight: '700',
  },
  suggestionPhotoPreview: {
    width: 78,
    height: 56,
    borderRadius: 10,
    marginTop: 8,
  },
  suggestionFormModal: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 20,
    maxHeight: '93%',
    minHeight: '75%',
  },
  suggestionAnimatedForm: {
    gap: 10,
  },
  suggestionAudienceGroup: {
    gap: 6,
  },
  suggestionAudienceLabel: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  suggestionAudienceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionAudienceButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  suggestionAudienceButtonActive: {
    borderColor: '#4F46E5',
    backgroundColor: '#EEF2FF',
  },
  suggestionAudienceButtonText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  suggestionAudienceButtonTextActive: {
    color: '#3730A3',
  },
  suggestionMediaActions: {
    flexDirection: 'row',
    gap: 8,
  },
  multilineInput: {
    minHeight: HOMEWORK_INPUT_MIN_HEIGHT,
    maxHeight: HOMEWORK_INPUT_MAX_HEIGHT,
  },
  attachButton: {
    marginTop: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    backgroundColor: '#EEF2FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  attachButtonActive: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  attachButtonText: {
    color: '#4F46E5',
    fontWeight: '700',
  },
  attachButtonTextActive: {
    color: '#B91C1C',
  },
  suggestionPhotoPreviewLarge: {
    width: '100%',
    height: 180,
    borderRadius: 14,
    marginTop: 4,
  },
  audioPreviewCard: {
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  audioPreviewPlayButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioPreviewBody: {
    flex: 1,
  },
  audioPreviewTitle: {
    color: '#1E40AF',
    fontSize: 12,
    fontWeight: '800',
  },
  audioPreviewText: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  audioPreviewDeleteButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  suggestionSuccessWrap: {
    position: 'absolute',
    top: '36%',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  successIconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#DCFCE7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#166534',
  },
  successText: {
    marginTop: 6,
    fontSize: 14,
    color: '#166534',
    fontWeight: '600',
  },
});
