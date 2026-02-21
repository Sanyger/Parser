import { createSeedDatabase } from '../data/seed';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createJwtToken, hashPassword, parseJwtToken } from '../lib/auth';
import { persistMediaUri, persistMediaUris } from '../lib/mediaStore';
import { toJerusalemDateInput } from '../lib/time';
import { buildTranslations, detectLanguage, ensureTranslationMap, getLocalizedText } from '../lib/translation';
import {
  ApplicationStatus,
  ApplicationType,
  AppLanguage,
  DeviceBinding,
  ClassModel,
  DatabaseSnapshot,
  FeedbackCategory,
  Feedback,
  Homework,
  Lesson,
  LessonType,
  LoginResponse,
  SubjectDeletionMode,
  TranslationMap,
  ParentRegistrationData,
  ParentStudentRelationRequest,
  RegistrationApplication,
  RoleId,
  Session,
  StaffRegistrationData,
  StudentDetailsResponse,
  Thread,
  UploadedFile,
  User,
} from '../types/models';

const DB_STORAGE_KEY = 'school_israel_mock_db_v1';
const REMOTE_API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? '').trim().replace(/\/+$/, '');
const REMOTE_SNAPSHOT_URL = REMOTE_API_BASE ? `${REMOTE_API_BASE}/state/snapshot` : '';

let database = createSeedDatabase();
let databaseInitialized = false;
let databaseInitPromise: Promise<void> | null = null;
let persistQueue: Promise<void> = Promise.resolve();
let lastLocalSnapshot = '';
let lastRemoteSnapshot = '';

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 2500,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function looksLikeSnapshot(value: unknown): value is DatabaseSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<DatabaseSnapshot>;
  return (
    Array.isArray(candidate.users) &&
    Array.isArray(candidate.classes) &&
    Array.isArray(candidate.subjects) &&
    Array.isArray(candidate.lessons)
  );
}

function ensureDatabaseShape(): void {
  const snapshot = database as DatabaseSnapshot & {
    parent_student_relations?: unknown;
  };
  if (!Array.isArray(snapshot.parent_student_relations)) {
    snapshot.parent_student_relations = [];
  }

  if (!database.users.some((entry) => entry.id === 'user_student_2')) {
    database.users.push({
      id: 'user_student_2',
      name: 'Ева Аракчеева',
      photo_uri: 'https://api.dicebear.com/9.x/adventurer/png?seed=EvaStudent',
      login: 'student52',
      password_hash: hashPassword('123456'),
      role_id: 5,
      preferred_language: 'ru',
      is_homeroom: false,
      class_ids: ['class_g1'],
      child_ids: [],
      is_active: true,
      dob: '2016-04-09',
      show_birthday_in_calendar: true,
      phone: '+972500000052',
      email: 'student52@school.local',
      document_type: 'passport',
      document_number: 'S-500052',
      initial_password: '123456',
      is_blocked: false,
      block_reason: null,
      known_languages: ['ru'],
    });
  }

  const demoParent = database.users.find((entry) => entry.id === 'user_parent_1');
  if (demoParent && demoParent.name === 'Аракчеев Александр') {
    demoParent.name = 'Александр Аракчеев';
  }

  const classThread = database.threads.find((entry) => entry.id === 'thread_class_announcement_1');
  if (classThread && !classThread.participants.includes('user_student_2')) {
    classThread.participants.push('user_student_2');
  }

  const schoolThread = database.threads.find((entry) => entry.id === 'thread_director_all');
  if (schoolThread && !schoolThread.participants.includes('user_student_2')) {
    schoolThread.participants.push('user_student_2');
  }

  database.users.forEach((entry) => {
    if (entry.role_id !== 5) {
      return;
    }
    if (!Array.isArray(entry.known_languages) || entry.known_languages.length === 0) {
      entry.known_languages = [entry.preferred_language];
      return;
    }
    entry.known_languages = Array.from(new Set(entry.known_languages));
  });

  database.messages = database.messages.map((entry) => {
    const textOriginal = (entry.text_original ?? '').trim();
    const langOriginal = entry.lang_original ?? detectLanguage(textOriginal);
    return {
      ...entry,
      text_original: textOriginal,
      lang_original: langOriginal,
      translations: ensureTranslationMap(textOriginal, langOriginal, entry.translations),
    };
  });

  database.homework = database.homework.map((entry) => {
    const textOriginal = (entry.text_original ?? entry.text ?? '').trim();
    const langOriginal = entry.lang_original ?? detectLanguage(textOriginal);
    return {
      ...entry,
      text: textOriginal,
      text_original: textOriginal,
      lang_original: langOriginal,
      translations: ensureTranslationMap(textOriginal, langOriginal, entry.translations),
    };
  });

  database.feedback = database.feedback.map((entry) => {
    const textOriginal = (entry.text_original ?? '').trim();
    const langOriginal = entry.lang_original ?? detectLanguage(textOriginal);
    const author = database.users.find((candidate) => candidate.id === entry.author_id);
    const classId = typeof entry.class_id !== 'undefined' ? entry.class_id : author?.class_ids[0] ?? null;
    return {
      ...entry,
      class_id: classId,
      text_original: textOriginal,
      lang_original: langOriginal,
      translations: ensureTranslationMap(textOriginal, langOriginal, entry.translations),
    };
  });
}

export async function initDatabase(): Promise<void> {
  if (databaseInitialized) {
    return;
  }
  if (!databaseInitPromise) {
    databaseInitPromise = (async () => {
      try {
        const stored = await AsyncStorage.getItem(DB_STORAGE_KEY);
        if (!stored) {
          lastLocalSnapshot = '';
        } else {
          const parsed: unknown = JSON.parse(stored);
          if (looksLikeSnapshot(parsed)) {
            database = parsed;
            ensureDatabaseShape();
            lastLocalSnapshot = JSON.stringify(database);
          }
        }

        const remote = await pullRemoteSnapshot();
        if (remote) {
          database = remote;
          ensureDatabaseShape();
          const serialized = JSON.stringify(database);
          lastLocalSnapshot = serialized;
          lastRemoteSnapshot = serialized;
          await AsyncStorage.setItem(DB_STORAGE_KEY, serialized);
        }
      } catch {
        // Ignore invalid cache and continue with seed data.
      } finally {
        databaseInitialized = true;
      }
    })();
  }
  await databaseInitPromise;
}

async function persistDatabase(): Promise<void> {
  databaseInitialized = true;
  const serialized = JSON.stringify(database);
  persistQueue = persistQueue
    .then(async () => {
      if (serialized !== lastLocalSnapshot) {
        try {
          await AsyncStorage.setItem(DB_STORAGE_KEY, serialized);
          lastLocalSnapshot = serialized;
        } catch {
          // Ignore local persistence errors in unsupported environments.
        }
      }

      if (REMOTE_SNAPSHOT_URL && serialized !== lastRemoteSnapshot) {
        const pushed = await pushRemoteSnapshot(serialized);
        if (pushed) {
          lastRemoteSnapshot = serialized;
        }
      }
    })
    .catch(() => {
      // Keep queue alive after a failure.
    });
  await persistQueue;
}

async function pullRemoteSnapshot(): Promise<DatabaseSnapshot | null> {
  if (!REMOTE_SNAPSHOT_URL) {
    return null;
  }
  try {
    const response = await fetchWithTimeout(REMOTE_SNAPSHOT_URL, { method: 'GET' }, 2500);
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { ok?: boolean; snapshot?: unknown };
    if (!payload?.ok || !looksLikeSnapshot(payload.snapshot)) {
      return null;
    }
    return payload.snapshot;
  } catch {
    return null;
  }
}

async function pushRemoteSnapshot(serializedSnapshot: string): Promise<boolean> {
  if (!REMOTE_SNAPSHOT_URL) {
    return false;
  }
  try {
    const response = await fetchWithTimeout(
      REMOTE_SNAPSHOT_URL,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot: JSON.parse(serializedSnapshot) }),
      },
      2500,
    );
    return response.ok;
  } catch {
    return false;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function persistUploadedFile(file: UploadedFile, prefix: string): Promise<UploadedFile> {
  return {
    ...file,
    uri: (await persistMediaUri(file.uri, prefix)) ?? file.uri,
  };
}

async function persistUploadedFiles(files: UploadedFile[], prefix: string): Promise<UploadedFile[]> {
  const result: UploadedFile[] = [];
  for (const file of files) {
    result.push(await persistUploadedFile(file, prefix));
  }
  return result;
}

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}_${Date.now().toString(36)}`;
}

function unauthorized(message = 'Unauthorized'): never {
  throw new Error(message);
}

function getUserById(userId: string): User {
  const user = database.users.find((entry) => entry.id === userId && entry.is_active);
  if (!user) {
    unauthorized('User not found');
  }
  return user;
}

function requireAuth(token: string): User {
  const payload = parseJwtToken(token);
  if (!payload) {
    unauthorized('Invalid token');
  }
  return getUserById(payload.sub);
}

function isAdministrator(user: User): boolean {
  return user.role_id === 1 || user.role_id === 7;
}

function isDirector(user: User): boolean {
  return user.role_id === 1;
}

function directorUsers(): User[] {
  return database.users.filter((entry) => entry.is_active && entry.role_id === 1);
}

function administratorUsers(): User[] {
  return database.users.filter((entry) => entry.is_active && entry.role_id === 7);
}

function ensureAdminDirectorThread(): void {
  const directors = directorUsers();
  const admins = administratorUsers();
  if (directors.length === 0 || admins.length === 0) {
    return;
  }

  const director = directors[0];
  admins.forEach((admin, index) => {
    const existing = database.threads.find((entry) => {
      if (entry.type !== 'direct') {
        return false;
      }
      if (entry.participants.length !== 2) {
        return false;
      }
      return entry.participants.includes(director.id) && entry.participants.includes(admin.id);
    });
    if (existing) {
      return;
    }

    database.threads.push({
      id: index === 0 ? 'thread_admin_director' : id('thread_admin_director'),
      type: 'direct',
      participants: [director.id, admin.id],
      class_id: sharedClassId(director, admin),
    });
  });
}

function sanitizeAdminThreads(): void {
  const adminIds = new Set(administratorUsers().map((entry) => entry.id));
  if (adminIds.size > 0) {
    database.threads = database.threads.map((thread) => {
      if (thread.type === 'direct') {
        return thread;
      }
      const nextParticipants = thread.participants.filter((participant) => !adminIds.has(participant));
      if (nextParticipants.length === thread.participants.length) {
        return thread;
      }
      return {
        ...thread,
        participants: nextParticipants,
      };
    });
  }

  ensureAdminDirectorThread();
}

function nowIso(): string {
  return new Date().toISOString();
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

function monthDayFromDob(value?: string | null): string | null {
  const parsed = parseDateInput(value);
  if (!parsed) {
    return null;
  }
  return parsed.toISOString().slice(5, 10);
}

function ageAtDate(dobInput: string, dateInput: string): number {
  const dob = parseDateInput(dobInput);
  const at = parseDateInput(dateInput);
  if (!dob || !at) {
    return 0;
  }
  return Math.max(0, at.getUTCFullYear() - dob.getUTCFullYear());
}

function localizeTextForUser(user: User | undefined, text: string): string {
  const value = text.trim();
  if (!value) {
    return '';
  }
  if (!user) {
    return value;
  }
  const original = detectLanguage(value);
  return getLocalizedText(value, buildTranslations(value, original), user.preferred_language, false);
}

function pushNotification(userId: string, title: string, body: string): void {
  const recipient = database.users.find((entry) => entry.id === userId);
  database.notifications.unshift({
    id: id('notification'),
    user_id: userId,
    title: localizeTextForUser(recipient, title),
    body: localizeTextForUser(recipient, body),
    created_at: nowIso(),
    is_read: false,
  });
}

function adminLog(
  actor: User,
  action: string,
  entityType: string,
  entityId: string,
  details?: string,
): void {
  database.admin_logs.unshift({
    id: id('admin_log'),
    actor_user_id: actor.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    created_at: nowIso(),
    details: details ?? null,
  });
}

function classIdsForUser(user: User): string[] {
  if (user.role_id === 1 || user.role_id === 7) {
    return database.classes.map((entry) => entry.id);
  }

  if (user.role_id === 4) {
    const children = database.users.filter((entry) => user.child_ids.includes(entry.id));
    return Array.from(new Set(children.flatMap((entry) => entry.class_ids)));
  }

  return user.class_ids;
}

function visibleUsersFor(user: User): User[] {
  if (isAdministrator(user)) {
    return database.users;
  }

  if (user.role_id === 5) {
    return database.users.filter((entry) => {
      if (entry.id === user.id) {
        return true;
      }
      if (entry.role_id === 5 && entry.class_ids.some((classId) => user.class_ids.includes(classId))) {
        return true;
      }
      if (entry.role_id === 3 && entry.class_ids.some((classId) => user.class_ids.includes(classId))) {
        return true;
      }
      if (entry.role_id === 1 || entry.role_id === 6) {
        return true;
      }
      return false;
    });
  }

  if (user.role_id === 3) {
    return database.users.filter((entry) => {
      if (entry.id === user.id) {
        return true;
      }
      if (entry.role_id === 5 && entry.class_ids.some((classId) => user.class_ids.includes(classId))) {
        return true;
      }
      if (
        entry.role_id === 4 &&
        database.users.some(
          (student) =>
            student.role_id === 5 &&
            entry.child_ids.includes(student.id) &&
            student.class_ids.some((classId) => user.class_ids.includes(classId)),
        )
      ) {
        return true;
      }
      if (entry.role_id === 3 || entry.role_id === 1 || entry.role_id === 6) {
        return true;
      }
      return false;
    });
  }

  if (user.role_id === 6) {
    return database.users.filter((entry) => {
      if (entry.id === user.id) {
        return true;
      }
      return entry.role_id === 3 || entry.role_id === 1 || entry.role_id === 5;
    });
  }

  const classIds = classIdsForUser(user);
  return database.users.filter((entry) => {
    if (entry.id === user.id) {
      return true;
    }
    if (user.role_id === 4 && user.child_ids.includes(entry.id)) {
      return true;
    }
    if (entry.class_ids.some((classId) => classIds.includes(classId))) {
      return true;
    }
    if (user.role_id === 4 && (entry.role_id === 1 || entry.role_id === 6)) {
      return true;
    }
    return false;
  });
}

function visibleThreadsFor(user: User): Thread[] {
  if (user.role_id === 1) {
    return database.threads;
  }

  if (user.role_id === 7) {
    const directorIdSet = new Set(directorUsers().map((entry) => entry.id));
    return database.threads.filter((thread) => {
      if (thread.type !== 'direct') {
        return false;
      }
      if (!thread.participants.includes(user.id)) {
        return false;
      }
      return thread.participants.some((participant) => directorIdSet.has(participant));
    });
  }

  if (user.role_id === 5) {
    return database.threads.filter(
      (thread) => thread.type !== 'parent_teacher' && thread.participants.includes(user.id),
    );
  }

  return database.threads.filter((thread) => thread.participants.includes(user.id));
}

function feedbackMatchesStudentClass(feedback: Feedback, student: User): boolean {
  if (feedback.class_id) {
    return student.class_ids.includes(feedback.class_id);
  }
  const author = database.users.find((entry) => entry.id === feedback.author_id);
  if (!author) {
    return false;
  }
  return author.class_ids.some((classId) => student.class_ids.includes(classId));
}

function visibleFeedbackFor(user: User): Feedback[] {
  if (user.role_id === 1) {
    return database.feedback;
  }

  if (user.role_id === 7) {
    return [];
  }

  if (user.role_id === 4) {
    return database.feedback.filter((item) => item.author_id === user.id);
  }

  if (user.role_id === 5) {
    return database.feedback.filter((item) => {
      if (item.author_id === user.id) {
        return true;
      }
      if (item.is_private_to_author || !item.visibility_roles.includes(5)) {
        return false;
      }
      const author = database.users.find((entry) => entry.id === item.author_id);
      if (!author) {
        return false;
      }
      if (author.role_id !== 3 && author.role_id !== 5) {
        return false;
      }
      return feedbackMatchesStudentClass(item, user);
    });
  }

  if (user.role_id === 6) {
    return database.feedback.filter((item) => item.author_id === user.id);
  }

  if (user.role_id === 3) {
    return database.feedback.filter(
      (item) => item.author_id === user.id || (!item.is_private_to_author && item.visibility_roles.includes(3)),
    );
  }

  return [];
}

function visibleSnapshotFor(user: User): DatabaseSnapshot {
  sanitizeAdminThreads();
  ensureDatabaseShape();

  const isAdmin = isAdministrator(user);
  const classIds = classIdsForUser(user);
  const classes = database.classes.filter((entry) => classIds.includes(entry.id));
  const subjects = database.subjects.filter((entry) => !entry.is_archived || isAdmin);
  const lessons = database.lessons.filter((entry) => classIds.includes(entry.class_id));
  const lessonIds = new Set(lessons.map((entry) => entry.id));
  const homework = database.homework.filter((entry) => classIds.includes(entry.class_id));
  const threads = visibleThreadsFor(user);
  const threadIds = new Set(threads.map((thread) => thread.id));
  const messages = database.messages.filter((entry) => threadIds.has(entry.thread_id));
  const users = visibleUsersFor(user);
  const feedback = visibleFeedbackFor(user);
  const lessonReports = database.lesson_reports.filter((entry) => lessonIds.has(entry.lesson_id));
  const studentLessonRecords = database.student_lesson_records.filter((entry) =>
    lessonIds.has(entry.lesson_id),
  );
  const applications = isAdmin ? database.applications : [];
  const staffSchedules = isAdmin
    ? database.staff_schedules
    : database.staff_schedules.filter((entry) => entry.staff_user_id === user.id);
  const staffScheduleExceptions = isAdmin
    ? database.staff_schedule_exceptions
    : database.staff_schedule_exceptions.filter((entry) =>
        staffSchedules.some((schedule) => schedule.id === entry.schedule_id),
      );
  const devices = isAdmin ? database.devices : database.devices.filter((entry) => entry.user_id === user.id);
  const adminLogs = isAdmin ? database.admin_logs : [];
  const notifications = database.notifications.filter((entry) => entry.user_id === user.id);
  const parentStudentRelations = isAdmin
    ? database.parent_student_relations
    : user.role_id === 4
      ? database.parent_student_relations.filter((entry) => entry.parent_id === user.id)
      : [];

  return {
    school: clone(database.school),
    users: clone(users),
    classes: clone(classes),
    subjects: clone(subjects),
    lessons: clone(lessons),
    homework: clone(homework),
    threads: clone(threads),
    messages: clone(messages),
    feedback: clone(feedback),
    absence: clone(database.absence),
    lesson_reports: clone(lessonReports),
    student_lesson_records: clone(studentLessonRecords),
    extra_classes: clone(database.extra_classes),
    signups: clone(database.signups),
    applications: clone(applications),
    staff_schedules: clone(staffSchedules),
    staff_schedule_exceptions: clone(staffScheduleExceptions),
    devices: clone(devices),
    admin_logs: clone(adminLogs),
    notifications: clone(notifications),
    parent_student_relations: clone(parentStudentRelations),
  };
}

function sessionForUser(user: User): Session {
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 8);
  const token = createJwtToken({
    sub: user.id,
    role_id: user.is_homeroom ? 2 : user.role_id,
    exp: Math.floor(expiresAt.getTime() / 1000),
  });

  return {
    token,
    user_id: user.id,
    role_id: user.is_homeroom ? 2 : user.role_id,
    expires_at: expiresAt.toISOString(),
  };
}

function ensureAdministrator(user: User): void {
  if (!isAdministrator(user)) {
    unauthorized('Administrator role required');
  }
}

function ensureTeacher(user: User): void {
  if (user.role_id !== 3) {
    unauthorized('Teacher role required');
  }
}

function ensureParent(user: User): void {
  if (user.role_id !== 4) {
    unauthorized('Parent role required');
  }
}

function ensureTeacherOrDirector(user: User): void {
  if (!(isAdministrator(user) || user.role_id === 3)) {
    unauthorized('Teacher or administrator role required');
  }
}

function ensureClassAccess(user: User, classId: string): void {
  if (isAdministrator(user)) {
    return;
  }
  if (user.role_id === 3 && user.class_ids.includes(classId)) {
    return;
  }
  unauthorized('Class access denied');
}

function canAccessStudentDetails(viewer: User, student: User): boolean {
  if (isAdministrator(viewer)) {
    return true;
  }
  if (viewer.role_id === 6) {
    return true;
  }
  if (viewer.role_id === 3) {
    return student.class_ids.some((classId) => viewer.class_ids.includes(classId));
  }
  return false;
}

function ensureStudentDetailsAccess(viewer: User, student: User): void {
  if (!canAccessStudentDetails(viewer, student)) {
    unauthorized('Student details access denied');
  }
}

function sharedClassId(firstUser: User, secondUser: User): string | null {
  const match = firstUser.class_ids.find((classId) => secondUser.class_ids.includes(classId));
  return match ?? null;
}

function applyRole(user: User, nextRole: RoleId): void {
  if (nextRole === 2) {
    user.role_id = 3;
    user.is_homeroom = true;
    return;
  }

  user.role_id = nextRole;
  if (nextRole !== 3) {
    user.is_homeroom = false;
  }
}

function normalizeLoginBase(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 10);
  return normalized || 'user';
}

function uniqueLogin(base: string): string {
  let counter = 0;
  let candidate = base;
  while (database.users.some((entry) => entry.login === candidate)) {
    counter += 1;
    candidate = `${base}${counter}`;
  }
  return candidate;
}

function generateInitialPassword(): string {
  return Math.random().toString(36).slice(2, 10);
}

function normalizeTeachingSubjects(subjects: string[]): string[] {
  const normalized: string[] = [];
  for (const raw of subjects) {
    const value = raw.trim();
    if (!value) {
      continue;
    }
    if (!normalized.includes(value)) {
      normalized.push(value);
    }
  }
  return normalized;
}

export async function login(input: {
  login: string;
  password: string;
  preferred_language: AppLanguage;
}): Promise<LoginResponse> {
  await initDatabase();
  sanitizeAdminThreads();

  const found = database.users.find((entry) => entry.login === input.login && entry.is_active);

  if (!found || found.password_hash !== hashPassword(input.password)) {
    throw new Error('Invalid login or password');
  }
  if (found.is_blocked) {
    throw new Error('User is blocked');
  }

  found.preferred_language = input.preferred_language;
  await persistDatabase();

  return {
    session: sessionForUser(found),
    user: clone(found),
    snapshot: visibleSnapshotFor(found),
  };
}

export async function bootstrap(token: string): Promise<LoginResponse> {
  await initDatabase();
  sanitizeAdminThreads();

  const user = requireAuth(token);
  await persistDatabase();
  return {
    session: sessionForUser(user),
    user: clone(user),
    snapshot: visibleSnapshotFor(user),
  };
}

export async function setUserLanguage(token: string, language: AppLanguage): Promise<LoginResponse> {
  sanitizeAdminThreads();

  const user = requireAuth(token);
  user.preferred_language = language;
  await persistDatabase();
  return {
    session: sessionForUser(user),
    user: clone(user),
    snapshot: visibleSnapshotFor(user),
  };
}

export async function getBirthdays(
  token: string,
  input?: { date?: string },
): Promise<{
  date: string;
  birthdays: Array<{
    user_id: string;
    name: string;
    role_id: RoleId;
    dob: string;
    class_label: string | null;
    photo_uri: string | null;
    age: number;
    is_staff_anniversary: boolean;
  }>;
}> {
  sanitizeAdminThreads();

  const viewer = requireAuth(token);
  const dateInput = input?.date?.trim() || toJerusalemDateInput(new Date().toISOString());
  if (!parseDateInput(dateInput)) {
    throw new Error('Invalid date format. Use YYYY-MM-DD');
  }

  const monthDay = dateInput.slice(5, 10);
  const visibleUsers = visibleUsersFor(viewer);
  const birthdays = visibleUsers
    .filter((entry) => Boolean(entry.dob))
    .filter((entry) => entry.id === viewer.id || entry.show_birthday_in_calendar !== false)
    .filter((entry) => monthDayFromDob(entry.dob) === monthDay)
    .map((entry) => {
      const className = entry.role_id === 5
        ? database.classes.find((classModel) => entry.class_ids.includes(classModel.id))?.name ?? null
        : null;
      const age = ageAtDate(entry.dob ?? dateInput, dateInput);
      return {
        user_id: entry.id,
        name: entry.name,
        role_id: entry.role_id,
        dob: entry.dob ?? dateInput,
        class_label: className,
        photo_uri: entry.photo_uri ?? null,
        age,
        is_staff_anniversary: entry.role_id === 6 && age > 0 && age % 10 === 0,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    date: dateInput,
    birthdays,
  };
}

export async function getStudentDetails(
  token: string,
  input: { student_id: string },
): Promise<StudentDetailsResponse> {
  sanitizeAdminThreads();

  const viewer = requireAuth(token);
  const student = database.users.find(
    (entry) => entry.id === input.student_id && entry.role_id === 5 && entry.is_active,
  );
  if (!student) {
    throw new Error('Student not found');
  }
  ensureStudentDetailsAccess(viewer, student);

  const classId = student.class_ids[0] ?? '';
  const className = classId
    ? database.classes.find((entry) => entry.id === classId)?.name ?? classId
    : 'Без класса';

  const todayInput = toJerusalemDateInput(new Date().toISOString());
  const todayLessonIds = new Set(
    database.lessons
      .filter((lesson) => lesson.class_id === classId)
      .filter((lesson) => toJerusalemDateInput(lesson.start_datetime) === todayInput)
      .map((lesson) => lesson.id),
  );
  const isAbsentToday = database.absence.some(
    (entry) => entry.student_id === student.id && todayLessonIds.has(entry.lesson_id),
  );

  const parents = database.users
    .filter((entry) => entry.role_id === 4 && entry.is_active && entry.child_ids.includes(student.id))
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'))
    .map((entry, index) => {
      let relation: 'mother' | 'father' | 'guardian' = 'guardian';
      if (index === 0) {
        relation = 'mother';
      } else if (index === 1) {
        relation = 'father';
      }
      return {
        user_id: entry.id,
        name: entry.name,
        photo_uri: entry.photo_uri ?? null,
        phone: entry.phone ?? null,
        relation,
      };
    });

  const studentRecords = database.student_lesson_records
    .filter((entry) => entry.student_id === student.id && Boolean(entry.grade))
    .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
  const latestGrade = studentRecords[0]?.grade ?? null;

  const classHomework = database.homework.filter((entry) => entry.class_id === classId);
  const homeworkOverdue = classHomework.filter((entry) => entry.due_date < todayInput).length;
  const homeworkUnconfirmed = classHomework.filter(
    (entry) => !entry.student_confirmed_ids.includes(student.id),
  ).length;

  return {
    student: {
      id: student.id,
      name: student.name,
      photo_uri: student.photo_uri ?? null,
      class_id: classId,
      class_name: className,
      dob: student.dob ?? null,
      is_birthday_today: monthDayFromDob(student.dob) === todayInput.slice(5, 10),
      status: isAbsentToday ? 'absent' : 'present',
    },
    parents,
    summary: {
      latest_grade: latestGrade,
      homework_total: classHomework.length,
      homework_overdue: homeworkOverdue,
      homework_unconfirmed: homeworkUnconfirmed,
    },
  };
}

export async function get_student_details(
  token: string,
  input: { student_id: string },
): Promise<StudentDetailsResponse> {
  return getStudentDetails(token, input);
}

export async function assignHomeroomTeacher(
  token: string,
  input: { teacher_id: string; class_id: string; is_homeroom: boolean },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  const canAdminister = actor.role_id === 1 || actor.role_id === 7;
  const canSelfManage = actor.role_id === 3 && actor.id === input.teacher_id;
  if (!canAdminister && !canSelfManage) {
    unauthorized('Only administrator or the teacher can update homeroom state');
  }

  const teacher = getUserById(input.teacher_id);
  ensureTeacher(teacher);
  if (canSelfManage && !teacher.class_ids.includes(input.class_id)) {
    unauthorized('Teacher can only assign homeroom for own class');
  }

  const classModel = database.classes.find((entry) => entry.id === input.class_id);
  if (!classModel) {
    throw new Error('Class not found');
  }

  teacher.is_homeroom = input.is_homeroom;
  if (input.is_homeroom) {
    for (const entry of database.classes) {
      if (entry.homeroom_teacher_id === teacher.id) {
        entry.homeroom_teacher_id = null;
      }
    }
    classModel.homeroom_teacher_id = teacher.id;
  } else if (classModel.homeroom_teacher_id === teacher.id) {
    classModel.homeroom_teacher_id = null;
  }

  return bootstrap(token);
}

export async function updateTeacherSubjects(
  token: string,
  input: { teacher_id: string; teaching_subjects: string[] },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  const canAdminister = isAdministrator(actor);
  const canSelfManage = actor.role_id === 3 && actor.id === input.teacher_id;
  if (!canAdminister && !canSelfManage) {
    unauthorized('Only administrator or the teacher can update teaching subjects');
  }

  const teacher = getUserById(input.teacher_id);
  ensureTeacher(teacher);
  const normalizedSubjects = normalizeTeachingSubjects(input.teaching_subjects ?? []);
  if (normalizedSubjects.length === 0) {
    throw new Error('Добавьте хотя бы один предмет.');
  }

  const allowed = new Set(normalizedSubjects);
  const nowMs = Date.now();
  const blockedFutureLessons = database.lessons
    .filter((lesson) => lesson.teacher_id === teacher.id)
    .filter((lesson) => lesson.status !== 'canceled')
    .filter((lesson) => new Date(lesson.start_datetime).getTime() > nowMs)
    .filter((lesson) => !allowed.has(lesson.subject.trim()));

  if (blockedFutureLessons.length > 0) {
    const preview = blockedFutureLessons
      .slice(0, 6)
      .map((lesson) => `${lesson.subject} (${toJerusalemDateInput(lesson.start_datetime)})`)
      .join(', ');
    throw new Error(
      `Сначала уберите из расписания будущие уроки по этим предметам: ${preview}${
        blockedFutureLessons.length > 6 ? ', ...' : ''
      }`,
    );
  }

  teacher.teaching_subjects = normalizedSubjects;
  return bootstrap(token);
}

export async function updateUserRole(
  token: string,
  input: { user_id: string; role_id: RoleId },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureAdministrator(actor);

  const user = getUserById(input.user_id);
  applyRole(user, input.role_id);

  return bootstrap(token);
}

export async function upsertHomework(
  token: string,
  input: {
    homework_id?: string;
    lesson_id: string;
    text: string;
    assigned_date?: string;
    due_date?: string;
    attachments: string[];
    source: 'manual' | 'photo_ocr';
    ocr_raw_text: string | null;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureTeacher(actor);
  const attachments = await persistMediaUris(input.attachments, 'homework');

  const lesson = database.lessons.find((entry) => entry.id === input.lesson_id);
  if (!lesson) {
    throw new Error('Lesson not found');
  }

  const textOriginal = input.text.trim();
  if (!textOriginal) {
    throw new Error('Homework text is required');
  }
  const originalLanguage = detectLanguage(textOriginal);
  const translations = buildTranslations(textOriginal, originalLanguage);

  const now = new Date().toISOString();
  const fallbackAssignedDate = lesson.start_datetime.slice(0, 10);
  const fallbackDueDate = input.assigned_date ?? fallbackAssignedDate;

  if (input.homework_id) {
    const existing = database.homework.find((entry) => entry.id === input.homework_id);
    if (!existing) {
      throw new Error('Homework not found');
    }

    existing.text = textOriginal;
    existing.text_original = textOriginal;
    existing.lang_original = originalLanguage;
    existing.translations = translations;
    existing.assigned_date = input.assigned_date ?? existing.assigned_date;
    existing.due_date = input.due_date ?? existing.due_date;
    existing.attachments = attachments;
    existing.source = input.source;
    existing.ocr_raw_text = input.ocr_raw_text;
    existing.updated_at = now;
  } else {
    database.homework.push({
      id: id('hw'),
      lesson_id: lesson.id,
      class_id: lesson.class_id,
      teacher_id: actor.id,
      text: textOriginal,
      text_original: textOriginal,
      lang_original: originalLanguage,
      translations,
      assigned_date: input.assigned_date ?? fallbackAssignedDate,
      due_date: input.due_date ?? fallbackDueDate,
      attachments,
      student_confirmed_ids: [],
      parent_confirmed_ids: [],
      source: input.source,
      ocr_raw_text: input.ocr_raw_text,
      created_at: now,
      updated_at: now,
    });
  }

  return bootstrap(token);
}

export async function deleteHomework(
  token: string,
  input: {
    homework_id: string;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureTeacher(actor);

  const existing = database.homework.find((entry) => entry.id === input.homework_id);
  if (!existing) {
    throw new Error('Homework not found');
  }
  if (existing.teacher_id !== actor.id) {
    unauthorized('Teacher can delete only own homework');
  }

  database.homework = database.homework.filter((entry) => entry.id !== input.homework_id);
  return bootstrap(token);
}

export async function setStudentHomeworkDone(
  token: string,
  input: {
    homework_id: string;
    done: boolean;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  if (actor.role_id !== 5) {
    unauthorized('Only students can mark homework done');
  }

  const homework = database.homework.find((entry) => entry.id === input.homework_id);
  if (!homework) {
    throw new Error('Homework not found');
  }
  if (!actor.class_ids.includes(homework.class_id)) {
    unauthorized('Homework class access denied');
  }

  if (input.done) {
    if (!homework.student_confirmed_ids.includes(actor.id)) {
      homework.student_confirmed_ids.push(actor.id);
    }
  } else {
    homework.student_confirmed_ids = homework.student_confirmed_ids.filter((entry) => entry !== actor.id);
  }
  homework.updated_at = nowIso();

  return bootstrap(token);
}

export async function setParentHomeworkChecked(
  token: string,
  input: {
    homework_id: string;
    student_id: string;
    checked: boolean;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureParent(actor);

  if (!actor.child_ids.includes(input.student_id)) {
    unauthorized('Parent can check only linked child homework');
  }

  const homework = database.homework.find((entry) => entry.id === input.homework_id);
  if (!homework) {
    throw new Error('Homework not found');
  }

  const student = database.users.find((entry) => entry.id === input.student_id && entry.role_id === 5);
  if (!student) {
    throw new Error('Student not found');
  }
  if (!student.class_ids.includes(homework.class_id)) {
    unauthorized('Homework does not belong to selected child class');
  }

  if (input.checked) {
    if (!homework.parent_confirmed_ids.includes(actor.id)) {
      homework.parent_confirmed_ids.push(actor.id);
    }
  } else {
    homework.parent_confirmed_ids = homework.parent_confirmed_ids.filter((entry) => entry !== actor.id);
  }
  homework.updated_at = nowIso();

  return bootstrap(token);
}

export async function createParentStudentRelationRequest(
  token: string,
  input: {
    student_id: string;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureParent(actor);
  ensureDatabaseShape();

  const student = database.users.find(
    (entry) => entry.id === input.student_id && entry.role_id === 5 && entry.is_active,
  );
  if (!student) {
    throw new Error('Student not found');
  }

  if (actor.child_ids.includes(student.id)) {
    throw new Error('Ребёнок уже привязан к вашему профилю.');
  }

  const hasPending = database.parent_student_relations.some(
    (entry) =>
      entry.parent_id === actor.id &&
      entry.student_id === student.id &&
      entry.status === 'pending',
  );
  if (hasPending) {
    throw new Error('Запрос уже отправлен и ожидает подтверждения.');
  }

  const request: ParentStudentRelationRequest = {
    id: id('parent_student_rel'),
    parent_id: actor.id,
    student_id: student.id,
    status: 'pending',
    created_at: nowIso(),
    updated_at: nowIso(),
    reviewed_by_user_id: null,
    comment: null,
  };
  database.parent_student_relations.unshift(request);

  administratorUsers().forEach((admin) => {
    pushNotification(
      admin.id,
      'Новый запрос на привязку ребёнка',
      `${actor.name} запрашивает привязку ученика ${student.name}.`,
    );
  });
  directorUsers().forEach((director) => {
    pushNotification(
      director.id,
      'Запрос родителя на привязку',
      `${actor.name} запрашивает привязку ученика ${student.name}.`,
    );
  });

  return bootstrap(token);
}

export async function reviewParentStudentRelationRequest(
  token: string,
  input: {
    request_id: string;
    status: 'approved' | 'rejected';
    comment?: string;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureAdministrator(actor);
  ensureDatabaseShape();

  const request = database.parent_student_relations.find((entry) => entry.id === input.request_id);
  if (!request) {
    throw new Error('Relation request not found');
  }
  if (request.status !== 'pending') {
    throw new Error('Request already processed');
  }

  const parent = database.users.find((entry) => entry.id === request.parent_id && entry.role_id === 4);
  const student = database.users.find((entry) => entry.id === request.student_id && entry.role_id === 5);
  if (!parent || !student) {
    throw new Error('Parent or student not found');
  }

  request.status = input.status;
  request.updated_at = nowIso();
  request.reviewed_by_user_id = actor.id;
  request.comment = input.comment?.trim() || null;

  if (input.status === 'approved') {
    if (!parent.child_ids.includes(student.id)) {
      parent.child_ids.push(student.id);
    }
    attachParentToStudentScope(parent, student);
    pushNotification(
      parent.id,
      'Запрос подтверждён',
      `${student.name} добавлен в ваш список детей.`,
    );
    adminLog(actor, 'PARENT_STUDENT_LINK_APPROVED', 'parent_student_relation', request.id, `${parent.id}:${student.id}`);
  } else {
    pushNotification(
      parent.id,
      'Запрос отклонён',
      request.comment ?? 'Администратор отклонил привязку ребёнка. Свяжитесь со школой.',
    );
    adminLog(actor, 'PARENT_STUDENT_LINK_REJECTED', 'parent_student_relation', request.id, `${parent.id}:${student.id}`);
  }

  return bootstrap(token);
}

export async function sendMessage(
  token: string,
  input: {
    thread_id: string;
    text_original: string;
    attachments: string[];
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  const attachments = await persistMediaUris(input.attachments, 'message');

  if (actor.role_id === 5) {
    unauthorized('Students cannot send messages in MVP');
  }

  const thread = database.threads.find((entry) => entry.id === input.thread_id);
  if (!thread) {
    throw new Error('Thread not found');
  }

  if (!thread.participants.includes(actor.id)) {
    unauthorized('Thread access denied');
  }

  const textOriginal = input.text_original.trim();
  if (!textOriginal) {
    throw new Error('Message text is required');
  }
  const originalLanguage = detectLanguage(textOriginal);

  database.messages.push({
    id: id('msg'),
    thread_id: thread.id,
    sender_id: actor.id,
    text_original: textOriginal,
    lang_original: originalLanguage,
    translations: buildTranslations(textOriginal, originalLanguage),
    attachments,
    created_at: new Date().toISOString(),
    read_by: [actor.id],
  });

  return bootstrap(token);
}

function classParticipants(classId: string): string[] {
  return database.users
    .filter(
      (entry) => entry.class_ids.includes(classId) || entry.role_id === 1 || entry.role_id === 6,
    )
    .map((entry) => entry.id);
}

function findOrCreateClassThread(classId: string): Thread {
  const found = database.threads.find((entry) => entry.type === 'class' && entry.class_id === classId);
  if (found) {
    return found;
  }

  const created: Thread = {
    id: id('thread_class'),
    type: 'class',
    participants: classParticipants(classId),
    class_id: classId,
  };
  database.threads.push(created);
  return created;
}

function findOrCreateDirectThread(firstUser: User, secondUser: User): Thread {
  const found = database.threads.find((entry) => {
    if (entry.type !== 'direct') {
      return false;
    }
    if (entry.participants.length !== 2) {
      return false;
    }
    return entry.participants.includes(firstUser.id) && entry.participants.includes(secondUser.id);
  });
  if (found) {
    return found;
  }

  const created: Thread = {
    id: id('thread_direct'),
    type: 'direct',
    participants: [firstUser.id, secondUser.id],
    class_id: sharedClassId(firstUser, secondUser),
  };
  database.threads.push(created);
  return created;
}

function ensureDirectMessageAccess(actor: User, target: User): void {
  if (target.role_id === 7 && !isDirector(actor)) {
    unauthorized('Only director can message administrator');
  }
  if (actor.role_id === 7 && !isDirector(target)) {
    unauthorized('Administrator can message only director');
  }

  if (actor.role_id === 5) {
    const sharedClass = actor.class_ids.some((classId) => target.class_ids.includes(classId));
    const allowedRoleTarget =
      target.role_id === 1 || target.role_id === 3 || target.role_id === 6 || target.role_id === 5;
    const requiresSharedClass = target.role_id === 3 || target.role_id === 5;
    if (!allowedRoleTarget || (requiresSharedClass && !sharedClass)) {
      unauthorized('Student can message only classmates, own teachers, director or staff');
    }
  }

  if (actor.role_id === 3) {
    const hasCommonClass = actor.class_ids.some((classId) => target.class_ids.includes(classId));
    const isParentOfClassStudent =
      target.role_id === 4 &&
      database.users.some(
        (entry) =>
          target.child_ids.includes(entry.id) &&
          entry.role_id === 5 &&
          entry.class_ids.some((classId) => actor.class_ids.includes(classId)),
      );
    if (!hasCommonClass && !isParentOfClassStudent) {
      unauthorized('Teacher can message only related student or parent');
    }
  }
}

function findOrCreateParentTeacherThread(parent: User, teacher: User, classId: string | null): Thread {
  const found = database.threads.find((entry) => {
    if (entry.type !== 'parent_teacher') {
      return false;
    }
    return entry.participants.includes(parent.id) && entry.participants.includes(teacher.id);
  });
  if (found) {
    return found;
  }

  const created: Thread = {
    id: id('thread_parent_teacher'),
    type: 'parent_teacher',
    participants: [teacher.id, parent.id],
    class_id: classId,
  };
  database.threads.push(created);
  return created;
}

function attachParentToStudentScope(parent: User, student: User): void {
  const classIdSet = new Set(student.class_ids);

  for (const classId of classIdSet) {
    const classThread = findOrCreateClassThread(classId);
    if (!classThread.participants.includes(parent.id)) {
      classThread.participants.push(parent.id);
    }
  }

  const teachers = database.users.filter(
    (entry) =>
      entry.role_id === 3 &&
      entry.is_active &&
      entry.class_ids.some((classId) => classIdSet.has(classId)),
  );

  teachers.forEach((teacher) => {
    const threadClassId = teacher.class_ids.find((classId) => classIdSet.has(classId)) ?? student.class_ids[0] ?? null;
    findOrCreateParentTeacherThread(parent, teacher, threadClassId);
  });
}

export async function publishAnnouncement(
  token: string,
  input: {
    text_original: string;
    class_id?: string;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);

  const canPublishGlobal = isAdministrator(actor);
  const canPublishClass = isAdministrator(actor) || (actor.role_id === 3 && actor.is_homeroom);

  if (input.class_id && !canPublishClass) {
    unauthorized('Class announcement requires homeroom or administrator role');
  }

  if (!input.class_id && !canPublishGlobal) {
    unauthorized('Global announcement requires administrator role');
  }

  const thread = input.class_id
    ? findOrCreateClassThread(input.class_id)
    : database.threads.find((entry) => entry.id === 'thread_director_all');

  if (!thread) {
    throw new Error('Announcement thread not found');
  }

  const textOriginal = input.text_original.trim();
  if (!textOriginal) {
    throw new Error('Announcement text is required');
  }
  const originalLanguage = detectLanguage(textOriginal);

  database.messages.push({
    id: id('msg_ann'),
    thread_id: thread.id,
    sender_id: actor.id,
    text_original: textOriginal,
    lang_original: originalLanguage,
    translations: buildTranslations(textOriginal, originalLanguage),
    attachments: [],
    created_at: new Date().toISOString(),
    read_by: [actor.id],
  });

  return bootstrap(token);
}

export async function updateUserPhoto(
  token: string,
  input: {
    photo_uri: string | null;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  actor.photo_uri = await persistMediaUri(input.photo_uri, 'avatar');
  return bootstrap(token);
}

export async function updateOwnProfile(
  token: string,
  input: {
    name?: string;
    email?: string | null;
    phone?: string | null;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  if (typeof input.name !== 'undefined') {
    const normalized = input.name.trim();
    if (!normalized) {
      throw new Error('Name is required');
    }
    actor.name = normalized;
  }
  if (typeof input.email !== 'undefined') {
    actor.email = input.email ? input.email.trim() : null;
  }
  if (typeof input.phone !== 'undefined') {
    actor.phone = input.phone ? input.phone.trim() : null;
  }
  return bootstrap(token);
}

export async function updateChildProfileByParent(
  token: string,
  input: {
    child_id: string;
    phone?: string | null;
    known_languages?: AppLanguage[];
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureParent(actor);

  if (!actor.child_ids.includes(input.child_id)) {
    unauthorized('Parent can update only linked children');
  }

  const child = database.users.find((entry) => entry.id === input.child_id && entry.role_id === 5 && entry.is_active);
  if (!child) {
    throw new Error('Child not found');
  }

  if (typeof input.phone !== 'undefined') {
    child.phone = input.phone ? input.phone.trim() : null;
  }

  if (typeof input.known_languages !== 'undefined') {
    const normalized = Array.from(
      new Set(input.known_languages.filter((entry): entry is AppLanguage => ['ru', 'en', 'he'].includes(entry))),
    );
    child.known_languages = normalized.length > 0 ? normalized : [child.preferred_language];
  }

  return bootstrap(token);
}

export async function updateOwnBirthdaySettings(
  token: string,
  input: {
    dob: string;
    show_birthday_in_calendar: boolean;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  const dob = input.dob.trim();
  if (!parseDateInput(dob)) {
    throw new Error('Неверный формат даты. Используйте YYYY-MM-DD.');
  }
  actor.dob = dob;
  actor.show_birthday_in_calendar = input.show_birthday_in_calendar;
  return bootstrap(token);
}

export async function upsertLesson(
  token: string,
  input: {
    lesson_id?: string;
    class_id: string;
    subject: string;
    room: string;
    start_datetime: string;
    end_datetime: string;
    type: LessonType;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureTeacherOrDirector(actor);

  const classModel = database.classes.find((entry) => entry.id === input.class_id);
  if (!classModel) {
    throw new Error('Class not found');
  }
  ensureClassAccess(actor, classModel.id);

  if (input.lesson_id) {
    const lesson = database.lessons.find((entry) => entry.id === input.lesson_id);
    if (!lesson) {
      throw new Error('Lesson not found');
    }
    ensureClassAccess(actor, lesson.class_id);

    lesson.class_id = input.class_id;
    lesson.subject = input.subject;
    lesson.room = input.room;
    lesson.start_datetime = input.start_datetime;
    lesson.end_datetime = input.end_datetime;
    lesson.type = input.type;
    lesson.status = 'normal';
    lesson.original_reference_id = null;
    lesson.change_reason = null;
  } else {
    database.lessons.push({
      id: id('lesson'),
      class_id: input.class_id,
      teacher_id:
        actor.role_id === 3 ? actor.id : database.users.find((entry) => entry.role_id === 3)?.id ?? actor.id,
      subject: input.subject,
      room: input.room,
      start_datetime: input.start_datetime,
      end_datetime: input.end_datetime,
      type: input.type,
      status: 'normal',
      original_reference_id: null,
      change_reason: null,
    });
  }

  return bootstrap(token);
}

export async function deleteLesson(
  token: string,
  input: {
    lesson_id: string;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureTeacherOrDirector(actor);

  const lessonIndex = database.lessons.findIndex((entry) => entry.id === input.lesson_id);
  if (lessonIndex < 0) {
    throw new Error('Lesson not found');
  }

  const lesson = database.lessons[lessonIndex];
  ensureClassAccess(actor, lesson.class_id);

  database.lessons.splice(lessonIndex, 1);
  database.homework = database.homework.filter((entry) => entry.lesson_id !== lesson.id);
  database.lesson_reports = database.lesson_reports.filter((entry) => entry.lesson_id !== lesson.id);
  database.student_lesson_records = database.student_lesson_records.filter((entry) => entry.lesson_id !== lesson.id);
  database.absence = database.absence.filter((entry) => entry.lesson_id !== lesson.id);

  return bootstrap(token);
}

export async function swapLessons(
  token: string,
  input: {
    first_lesson_id: string;
    second_lesson_id: string;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureTeacherOrDirector(actor);

  const first = database.lessons.find((entry) => entry.id === input.first_lesson_id);
  const second = database.lessons.find((entry) => entry.id === input.second_lesson_id);
  if (!first || !second) {
    throw new Error('Lesson not found');
  }

  ensureClassAccess(actor, first.class_id);
  ensureClassAccess(actor, second.class_id);

  const firstStart = first.start_datetime;
  const firstEnd = first.end_datetime;
  first.start_datetime = second.start_datetime;
  first.end_datetime = second.end_datetime;
  second.start_datetime = firstStart;
  second.end_datetime = firstEnd;

  return bootstrap(token);
}

export async function upsertLessonReport(
  token: string,
  input: {
    lesson_id: string;
    summary_text: string;
    audio_transcript: string | null;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureTeacher(actor);

  const lesson = database.lessons.find((entry) => entry.id === input.lesson_id);
  if (!lesson) {
    throw new Error('Lesson not found');
  }
  ensureClassAccess(actor, lesson.class_id);

  const now = new Date().toISOString();
  const existing = database.lesson_reports.find(
    (entry) => entry.lesson_id === lesson.id && entry.teacher_id === actor.id,
  );
  if (existing) {
    existing.summary_text = input.summary_text;
    existing.audio_transcript = input.audio_transcript;
    existing.updated_at = now;
  } else {
    database.lesson_reports.push({
      id: id('lesson_report'),
      lesson_id: lesson.id,
      teacher_id: actor.id,
      summary_text: input.summary_text,
      audio_transcript: input.audio_transcript,
      updated_at: now,
    });
  }

  return bootstrap(token);
}

export async function upsertStudentLessonRecord(
  token: string,
  input: {
    lesson_id: string;
    student_id: string;
    absent: boolean;
    remark: string | null;
    grade: string | null;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureTeacher(actor);

  const lesson = database.lessons.find((entry) => entry.id === input.lesson_id);
  if (!lesson) {
    throw new Error('Lesson not found');
  }
  ensureClassAccess(actor, lesson.class_id);

  const student = database.users.find((entry) => entry.id === input.student_id && entry.role_id === 5);
  if (!student) {
    throw new Error('Student not found');
  }
  if (!student.class_ids.includes(lesson.class_id)) {
    unauthorized('Student does not belong to lesson class');
  }

  const now = new Date().toISOString();
  const existing = database.student_lesson_records.find(
    (entry) =>
      entry.lesson_id === lesson.id && entry.student_id === student.id && entry.teacher_id === actor.id,
  );
  if (existing) {
    existing.absent = input.absent;
    existing.remark = input.remark;
    existing.grade = input.grade;
    existing.updated_at = now;
  } else {
    database.student_lesson_records.push({
      id: id('lesson_record'),
      lesson_id: lesson.id,
      student_id: student.id,
      teacher_id: actor.id,
      absent: input.absent,
      remark: input.remark,
      grade: input.grade,
      updated_at: now,
    });
  }

  return bootstrap(token);
}

export async function sendDirectMessage(
  token: string,
  input: {
    target_user_id: string;
    text_original: string;
    attachments: string[];
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  const attachments = await persistMediaUris(input.attachments, 'direct_message');

  const target = getUserById(input.target_user_id);
  if (target.id === actor.id) {
    throw new Error('Target user is invalid');
  }
  ensureDirectMessageAccess(actor, target);

  const textOriginal = input.text_original.trim();
  if (!textOriginal) {
    throw new Error('Message text is required');
  }
  const originalLanguage = detectLanguage(textOriginal);

  const thread = findOrCreateDirectThread(actor, target);
  database.messages.push({
    id: id('msg_direct'),
    thread_id: thread.id,
    sender_id: actor.id,
    text_original: textOriginal,
    lang_original: originalLanguage,
    translations: buildTranslations(textOriginal, originalLanguage),
    attachments,
    created_at: new Date().toISOString(),
    read_by: [actor.id],
  });

  return bootstrap(token);
}

export async function ensureDirectThread(
  token: string,
  input: {
    target_user_id: string;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  const target = getUserById(input.target_user_id);
  if (target.id === actor.id) {
    throw new Error('Target user is invalid');
  }
  ensureDirectMessageAccess(actor, target);
  findOrCreateDirectThread(actor, target);
  return bootstrap(token);
}

export async function createAbsence(
  token: string,
  input: {
    student_id: string;
    lesson_id: string;
    note_from_parent: string;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureParent(actor);

  if (!actor.child_ids.includes(input.student_id)) {
    unauthorized('You can create absence only for linked children');
  }

  const lesson = database.lessons.find((entry) => entry.id === input.lesson_id);
  if (!lesson) {
    throw new Error('Lesson not found');
  }

  database.absence.push({
    id: id('abs'),
    student_id: input.student_id,
    lesson_id: lesson.id,
    note_from_parent: input.note_from_parent,
    status: 'new',
  });

  return bootstrap(token);
}

export async function markThreadRead(token: string, threadId: string): Promise<LoginResponse> {
  const actor = requireAuth(token);

  const thread = database.threads.find((entry) => entry.id === threadId);
  if (!thread || !thread.participants.includes(actor.id)) {
    unauthorized('Thread not available');
  }

  database.messages = database.messages.map((message) => {
    if (message.thread_id !== threadId || message.read_by.includes(actor.id)) {
      return message;
    }
    return {
      ...message,
      read_by: [...message.read_by, actor.id],
    };
  });

  return bootstrap(token);
}

export async function updateFeedback(
  token: string,
  input: { feedback_id: string; status?: Feedback['status']; visibility_roles?: RoleId[] },
): Promise<LoginResponse> {
  const actor = requireAuth(token);

  const feedback = database.feedback.find((entry) => entry.id === input.feedback_id);
  if (!feedback) {
    throw new Error('Feedback not found');
  }

  const canManageVisibility = isAdministrator(actor);
  const canApprove = isAdministrator(actor) || (actor.role_id === 3 && actor.is_homeroom);

  if (input.visibility_roles && !canManageVisibility) {
    unauthorized('Only administrator can manage visibility');
  }

  if (input.status && !canApprove) {
    unauthorized('Only administrator or homeroom teacher can update feedback status');
  }

  if (input.visibility_roles) {
    feedback.visibility_roles = [...input.visibility_roles];
  }
  if (input.status) {
    feedback.status = input.status;
  }

  return bootstrap(token);
}

export async function createFeedback(
  token: string,
  input: {
    text_original: string;
    category: FeedbackCategory;
    is_private_to_author?: boolean;
    visibility_roles?: RoleId[];
    class_id?: string | null;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);

  const text = input.text_original.trim();
  if (!text) {
    throw new Error('Feedback text is required');
  }

  const canSetVisibility = isAdministrator(actor) || actor.role_id === 3;
  const requestedVisibility = Array.from(
    new Set((input.visibility_roles ?? []).filter((role): role is RoleId => Number.isInteger(role) && role >= 1 && role <= 7)),
  );

  if (requestedVisibility.length > 0 && !canSetVisibility) {
    unauthorized('Only administrator or teacher can set feedback visibility');
  }

  let classId: string | null = null;
  if (typeof input.class_id !== 'undefined') {
    const normalizedClassId = (input.class_id ?? '').trim();
    if (normalizedClassId) {
      if (!isAdministrator(actor) && !actor.class_ids.includes(normalizedClassId)) {
        unauthorized('Class access denied for feedback');
      }
      classId = normalizedClassId;
    }
  } else if (actor.role_id === 3 || actor.role_id === 5) {
    classId = actor.class_ids[0] ?? null;
  }

  const defaultVisibility: RoleId[] =
    actor.role_id === 5 ? [1, 3, 5, 7] : actor.role_id === 3 ? [1, 3, 4, 5, 6, 7] : [1, 3, 7];

  const visibilityRoles = requestedVisibility.length > 0 ? requestedVisibility : defaultVisibility;
  const originalLanguage = detectLanguage(text);

  database.feedback.push({
    id: id('feedback'),
    author_id: actor.id,
    visibility_roles: visibilityRoles,
    is_private_to_author: Boolean(input.is_private_to_author),
    class_id: classId,
    category: input.category,
    text_original: text,
    lang_original: originalLanguage,
    translations: buildTranslations(text, originalLanguage),
    status: 'new',
  });

  return bootstrap(token);
}

export async function publishScheduleChange(
  token: string,
  input: {
    lesson_id: string;
    subject: string;
    room: string;
    reason: string;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  if (!(isAdministrator(actor) || actor.role_id === 3)) {
    unauthorized('Only administrator or teacher can publish schedule changes');
  }

  const oldLesson = database.lessons.find((entry) => entry.id === input.lesson_id);
  if (!oldLesson) {
    throw new Error('Lesson not found');
  }

  oldLesson.status = 'canceled';
  oldLesson.change_reason = input.reason;

  database.lessons.push({
    ...oldLesson,
    id: id('lesson_changed'),
    subject: input.subject,
    room: input.room,
    status: 'changed',
    original_reference_id: oldLesson.id,
    change_reason: input.reason,
  });

  return bootstrap(token);
}

export async function submitParentRegistrationApplication(input: {
  parent_data: ParentRegistrationData;
  student_data: RegistrationApplication['student_data'];
}): Promise<RegistrationApplication> {
  if (!input.parent_data.consent_personal_data) {
    throw new Error('Consent for personal data processing is required');
  }
  if (!input.student_data?.photo) {
    throw new Error('Student photo is required');
  }

  const createdAt = nowIso();
  const studentData = clone(input.student_data);
  studentData.photo = await persistUploadedFile(studentData.photo, 'student_photo');
  studentData.document_files = await persistUploadedFiles(studentData.document_files, 'student_doc');
  const application: RegistrationApplication = {
    id: id('application_parent'),
    type: 'parent_with_student',
    status: 'new',
    created_at: createdAt,
    updated_at: createdAt,
    parent_data: clone(input.parent_data),
    student_data: studentData,
    staff_data: undefined,
    reviewer_user_id: null,
    review_comment: null,
    missing_info_request: null,
    approved_user_ids: [],
    assigned_class_ids: [],
  };

  database.applications.unshift(application);
  await persistDatabase();
  return clone(application);
}

export async function submitStaffRegistrationApplication(input: {
  staff_data: StaffRegistrationData;
}): Promise<RegistrationApplication> {
  const createdAt = nowIso();
  const staffData = clone(input.staff_data);
  staffData.document_files = await persistUploadedFiles(staffData.document_files, 'staff_doc');
  staffData.diploma_files = await persistUploadedFiles(staffData.diploma_files, 'staff_diploma');
  const application: RegistrationApplication = {
    id: id('application_staff'),
    type: 'staff',
    status: 'new',
    created_at: createdAt,
    updated_at: createdAt,
    parent_data: undefined,
    student_data: undefined,
    staff_data: staffData,
    reviewer_user_id: null,
    review_comment: null,
    missing_info_request: null,
    approved_user_ids: [],
    assigned_class_ids: [],
  };

  database.applications.unshift(application);
  await persistDatabase();
  return clone(application);
}

export async function listRegistrationApplications(
  token: string,
  input?: { type?: ApplicationType; status?: ApplicationStatus },
): Promise<RegistrationApplication[]> {
  const actor = requireAuth(token);
  ensureAdministrator(actor);

  return clone(
    database.applications.filter((entry) => {
      if (input?.type && entry.type !== input.type) {
        return false;
      }
      if (input?.status && entry.status !== input.status) {
        return false;
      }
      return true;
    }),
  );
}

function roleIdFromStaffRole(role: StaffRegistrationData['role']): RoleId {
  if (role === 'teacher') {
    return 3;
  }
  if (role === 'staff') {
    return 6;
  }
  if (role === 'administrator') {
    return 7;
  }
  return 1;
}

function approveParentApplication(
  actor: User,
  application: RegistrationApplication,
  assignClassIds: string[],
): void {
  const parentData = application.parent_data;
  const studentData = application.student_data;
  if (!parentData || !studentData) {
    throw new Error('Parent/student data is required');
  }

  const fallbackClassId = database.classes.find((entry) => !entry.is_archived)?.id;
  const classId = assignClassIds[0] ?? fallbackClassId;
  if (!classId) {
    throw new Error('No active classes available for assignment');
  }

  const studentLogin = uniqueLogin(normalizeLoginBase(`student${studentData.last_name}`));
  const studentPassword = generateInitialPassword();
  const studentUser: User = {
    id: id('user_student'),
    name: `${studentData.first_name} ${studentData.last_name}`.trim(),
    photo_uri: studentData.photo.uri,
    role_id: 5,
    login: studentLogin,
    password_hash: hashPassword(studentPassword),
    preferred_language: 'ru',
    is_homeroom: false,
    class_ids: [classId],
    child_ids: [],
    is_active: true,
    dob: studentData.birth_date,
    show_birthday_in_calendar: true,
    phone: null,
    email: null,
    document_type: studentData.document_type,
    document_number: studentData.document_number,
    initial_password: studentPassword,
    is_blocked: false,
    block_reason: null,
    known_languages: ['ru'],
  };

  const parentLogin = uniqueLogin(normalizeLoginBase(`parent${parentData.last_name}`));
  const parentPassword = generateInitialPassword();
  const parentUser: User = {
    id: id('user_parent'),
    name: `${parentData.first_name} ${parentData.last_name}`.trim(),
    photo_uri: null,
    role_id: 4,
    login: parentLogin,
    password_hash: hashPassword(parentPassword),
    preferred_language: 'ru',
    is_homeroom: false,
    class_ids: [classId],
    child_ids: [studentUser.id],
    is_active: true,
    dob: '1990-01-01',
    show_birthday_in_calendar: true,
    phone: parentData.phone,
    email: parentData.email ?? null,
    document_type: parentData.document_type,
    document_number: parentData.document_number,
    initial_password: parentPassword,
    is_blocked: false,
    block_reason: null,
  };

  database.users.push(studentUser, parentUser);
  application.approved_user_ids = [parentUser.id, studentUser.id];
  application.assigned_class_ids = [classId];

  pushNotification(
    parentUser.id,
    'Ваша заявка одобрена',
    'Данные для входа доступны в профиле. Логин и пароль можно посмотреть в блоке доступа.',
  );
  pushNotification(
    studentUser.id,
    'Создан школьный аккаунт',
    'Данные для входа доступны в вашем профиле.',
  );

  adminLog(actor, 'APPLICATION_APPROVED', 'application', application.id, 'Parent + student accounts were created');
}

function approveStaffApplication(
  actor: User,
  application: RegistrationApplication,
  assignClassIds: string[],
): void {
  const staffData = application.staff_data;
  if (!staffData) {
    throw new Error('Staff data is required');
  }

  const userRole = roleIdFromStaffRole(staffData.role);
  const userLogin = uniqueLogin(normalizeLoginBase(`${staffData.first_name}${staffData.last_name}`));
  const userPassword = generateInitialPassword();

  const createdUser: User = {
    id: id('user_staff'),
    name: `${staffData.first_name} ${staffData.last_name}`.trim(),
    photo_uri: null,
    role_id: userRole,
    login: userLogin,
    password_hash: hashPassword(userPassword),
    preferred_language: 'ru',
    is_homeroom: false,
    teaching_subjects: userRole === 3 ? normalizeTeachingSubjects(staffData.subjects ?? []) : undefined,
    class_ids: assignClassIds.length > 0 ? [...assignClassIds] : [...staffData.class_ids],
    child_ids: [],
    is_active: true,
    dob: '1990-01-01',
    show_birthday_in_calendar: true,
    phone: staffData.phone,
    email: staffData.email,
    document_type: staffData.document_type,
    document_number: staffData.document_number,
    initial_password: userPassword,
    is_blocked: false,
    block_reason: null,
  };

  database.users.push(createdUser);
  application.approved_user_ids = [createdUser.id];
  application.assigned_class_ids = createdUser.class_ids;

  if (createdUser.class_ids.length > 0 && createdUser.role_id === 3) {
    database.threads = database.threads.map((thread) => {
      if (thread.type !== 'class') {
        return thread;
      }
      if (!thread.class_id || !createdUser.class_ids.includes(thread.class_id)) {
        return thread;
      }
      if (thread.participants.includes(createdUser.id)) {
        return thread;
      }
      return {
        ...thread,
        participants: [...thread.participants, createdUser.id],
      };
    });
  }

  pushNotification(
    createdUser.id,
    'Ваша заявка одобрена',
    'Данные для входа доступны в профиле. Для безопасности пароль можно показать кнопкой на 5 секунд.',
  );
  adminLog(actor, 'APPLICATION_APPROVED', 'application', application.id, 'Staff account was created');
}

export async function reviewRegistrationApplication(
  token: string,
  input: {
    application_id: string;
    status: ApplicationStatus;
    comment?: string;
    missing_info_request?: string;
    assigned_class_ids?: string[];
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureAdministrator(actor);
  sanitizeAdminThreads();

  const application = database.applications.find((entry) => entry.id === input.application_id);
  if (!application) {
    throw new Error('Application not found');
  }

  if (input.status === 'need_more_info' && !input.missing_info_request?.trim()) {
    throw new Error('missing_info_request is required');
  }
  if (input.status === 'rejected' && !input.comment?.trim()) {
    throw new Error('Rejection comment is required');
  }

  application.status = input.status;
  application.updated_at = nowIso();
  application.reviewer_user_id = actor.id;
  application.review_comment = input.comment?.trim() ?? null;
  application.missing_info_request = input.missing_info_request?.trim() ?? null;

  if (input.status === 'approved') {
    if (actor.role_id === 1) {
      const directorConfirmation = 'Подтверждено директором';
      if (input.comment?.trim()) {
        application.review_comment = `${input.comment.trim()} | ${directorConfirmation}`;
      } else {
        application.review_comment = directorConfirmation;
      }
    }
    if (application.approved_user_ids.length === 0) {
      if (application.type === 'parent_with_student') {
        approveParentApplication(actor, application, input.assigned_class_ids ?? []);
      } else {
        approveStaffApplication(actor, application, input.assigned_class_ids ?? []);
      }
    }
    for (const userId of application.approved_user_ids) {
      pushNotification(userId, 'Заявка одобрена', 'Данные для входа доступны в профиле.');
    }
  } else if (input.status === 'need_more_info') {
    adminLog(actor, 'APPLICATION_NEED_MORE_INFO', 'application', application.id, application.missing_info_request ?? undefined);
  } else if (input.status === 'rejected') {
    const rejectMessage = 'Проверка не пройдена. Обратитесь в администрацию школы по телефону 8888888';
    application.approved_user_ids.forEach((userId) => {
      pushNotification(userId, 'Проверка не пройдена', rejectMessage);
    });
    adminLog(actor, 'APPLICATION_REJECTED', 'application', application.id, application.review_comment ?? undefined);
  } else if (input.status === 'in_review') {
    directorUsers().forEach((director) => {
      pushNotification(
        director.id,
        'Заявка ожидает подтверждения',
        `Заявка ${application.id} переведена на проверку у директора.`,
      );
    });
    adminLog(actor, 'APPLICATION_IN_REVIEW', 'application', application.id, application.review_comment ?? undefined);
  }

  return bootstrap(token);
}

export async function upsertSubject(
  token: string,
  input: {
    subject_id?: string;
    name: string;
    name_i18n: TranslationMap;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureAdministrator(actor);

  if (!input.name.trim()) {
    throw new Error('Subject name is required');
  }

  if (input.subject_id) {
    const existing = database.subjects.find((entry) => entry.id === input.subject_id);
    if (!existing) {
      throw new Error('Subject not found');
    }
    existing.name = input.name.trim();
    existing.name_i18n = clone(input.name_i18n);
    existing.is_archived = false;
    existing.archived_at = null;
    existing.archived_mode = null;
    adminLog(actor, 'SUBJECT_UPDATED', 'subject', existing.id, existing.name);
  } else {
    const created = {
      id: id('subject'),
      name: input.name.trim(),
      name_i18n: clone(input.name_i18n),
      is_archived: false,
      archived_at: null,
      archived_mode: null,
    };
    database.subjects.push(created);
    adminLog(actor, 'SUBJECT_CREATED', 'subject', created.id, created.name);
  }

  return bootstrap(token);
}

export async function archiveSubject(
  token: string,
  input: {
    subject_id: string;
    mode: SubjectDeletionMode;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureAdministrator(actor);

  const subject = database.subjects.find((entry) => entry.id === input.subject_id);
  if (!subject) {
    throw new Error('Subject not found');
  }

  subject.is_archived = true;
  subject.archived_at = nowIso();
  subject.archived_mode = input.mode;

  adminLog(
    actor,
    'SUBJECT_ARCHIVED',
    'subject',
    subject.id,
    `Mode=${input.mode}; usages=${database.lessons.filter((entry) => entry.subject === subject.name).length}`,
  );

  return bootstrap(token);
}

export async function upsertClass(
  token: string,
  input: {
    class_id?: string;
    grade: string;
    name_i18n: TranslationMap;
    homeroom_teacher_id?: string | null;
    subject_ids?: string[];
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureAdministrator(actor);

  const ruName = input.name_i18n.ru.trim();
  const enName = input.name_i18n.en.trim();
  const heName = input.name_i18n.he.trim();
  if (!ruName || !enName || !heName) {
    throw new Error('Class name must be provided in RU/EN/HE');
  }

  const normalizedSubjectIds = Array.from(
    new Set(
      (input.subject_ids ?? []).filter((subjectId) =>
        database.subjects.some((entry) => entry.id === subjectId && !entry.is_archived),
      ),
    ),
  );

  if (input.class_id) {
    const existing = database.classes.find((entry) => entry.id === input.class_id);
    if (!existing) {
      throw new Error('Class not found');
    }
    existing.grade = input.grade.trim();
    existing.name_i18n = clone(input.name_i18n);
    existing.name = ruName;
    if (typeof input.homeroom_teacher_id !== 'undefined') {
      existing.homeroom_teacher_id = input.homeroom_teacher_id;
    }
    if (typeof input.subject_ids !== 'undefined') {
      existing.subject_ids = normalizedSubjectIds;
    }
    existing.is_archived = false;
    adminLog(actor, 'CLASS_UPDATED', 'class', existing.id, existing.name);
  } else {
    const created: ClassModel = {
      id: id('class'),
      name: ruName,
      grade: input.grade.trim(),
      homeroom_teacher_id: input.homeroom_teacher_id ?? null,
      name_i18n: clone(input.name_i18n),
      subject_ids: normalizedSubjectIds,
      is_archived: false,
    };
    database.classes.push(created);
    adminLog(actor, 'CLASS_CREATED', 'class', created.id, created.name);
  }

  return bootstrap(token);
}

export async function archiveClass(token: string, input: { class_id: string }): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureAdministrator(actor);

  const classModel = database.classes.find((entry) => entry.id === input.class_id);
  if (!classModel) {
    throw new Error('Class not found');
  }

  classModel.is_archived = true;
  adminLog(actor, 'CLASS_ARCHIVED', 'class', classModel.id, classModel.name);
  return bootstrap(token);
}

export async function assignStaffSchedule(
  token: string,
  input: {
    staff_user_id?: string;
    bulk_staff_user_ids?: string[];
    days_of_week: number[];
    start_time: string;
    end_time: string;
    starts_on: string;
    ends_on?: string | null;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureAdministrator(actor);

  const staffIds = input.bulk_staff_user_ids?.length
    ? input.bulk_staff_user_ids
    : input.staff_user_id
      ? [input.staff_user_id]
      : [];
  if (staffIds.length === 0) {
    throw new Error('staff_user_id or bulk_staff_user_ids is required');
  }

  for (const staffId of staffIds) {
    database.staff_schedules.push({
      id: id('staff_schedule'),
      staff_user_id: staffId,
      days_of_week: [...input.days_of_week],
      start_time: input.start_time,
      end_time: input.end_time,
      starts_on: input.starts_on,
      ends_on: input.ends_on ?? null,
      assigned_by_user_id: actor.id,
      created_at: nowIso(),
    });
    adminLog(actor, 'SCHEDULE_ASSIGNED', 'user', staffId, 'Staff schedule assigned');
  }

  return bootstrap(token);
}

export async function createStaffScheduleException(
  token: string,
  input: {
    schedule_id: string;
    date: string;
    start_time?: string | null;
    end_time?: string | null;
    reason?: string | null;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureAdministrator(actor);

  const schedule = database.staff_schedules.find((entry) => entry.id === input.schedule_id);
  if (!schedule) {
    throw new Error('Schedule not found');
  }

  const exception = {
    id: id('staff_exception'),
    schedule_id: schedule.id,
    date: input.date,
    start_time: input.start_time ?? null,
    end_time: input.end_time ?? null,
    reason: input.reason ?? null,
    created_by_user_id: actor.id,
  };
  database.staff_schedule_exceptions.push(exception);
  adminLog(actor, 'SCHEDULE_EXCEPTION_CREATED', 'schedule', schedule.id, input.reason ?? undefined);

  return bootstrap(token);
}

export async function updateUserCard(
  token: string,
  input: {
    user_id: string;
    name?: string;
    dob?: string;
    show_birthday_in_calendar?: boolean;
    phone?: string | null;
    known_languages?: AppLanguage[];
    email?: string | null;
    document_number?: string | null;
    document_type?: User['document_type'];
    class_ids?: string[];
    child_ids?: string[];
    role_id?: RoleId;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureAdministrator(actor);

  const user = getUserById(input.user_id);
  if (typeof input.name !== 'undefined') {
    user.name = input.name.trim();
  }
  if (typeof input.dob !== 'undefined') {
    const parsed = parseDateInput(input.dob);
    if (!parsed) {
      throw new Error('Неверный формат даты. Используйте YYYY-MM-DD.');
    }
    user.dob = input.dob;
  }
  if (typeof input.show_birthday_in_calendar !== 'undefined') {
    user.show_birthday_in_calendar = input.show_birthday_in_calendar;
  }
  if (typeof input.phone !== 'undefined') {
    user.phone = input.phone;
  }
  if (typeof input.known_languages !== 'undefined') {
    user.known_languages = Array.from(
      new Set(input.known_languages.filter((entry): entry is AppLanguage => ['ru', 'en', 'he'].includes(entry))),
    );
  }
  if (typeof input.email !== 'undefined') {
    user.email = input.email;
  }
  if (typeof input.document_number !== 'undefined') {
    user.document_number = input.document_number;
  }
  if (typeof input.document_type !== 'undefined') {
    user.document_type = input.document_type;
  }
  if (typeof input.class_ids !== 'undefined') {
    user.class_ids = [...input.class_ids];
  }
  if (typeof input.child_ids !== 'undefined') {
    user.child_ids = [...input.child_ids];
  }
  if (typeof input.role_id !== 'undefined') {
    applyRole(user, input.role_id);
  }

  adminLog(actor, 'USER_CARD_UPDATED', 'user', user.id, user.name);
  return bootstrap(token);
}

export async function setUserBlocked(
  token: string,
  input: {
    user_id: string;
    blocked: boolean;
    reason?: string;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureAdministrator(actor);

  const user = getUserById(input.user_id);
  user.is_blocked = input.blocked;
  user.block_reason = input.blocked ? input.reason?.trim() ?? 'Blocked by administrator' : null;

  if (input.blocked) {
    pushNotification(user.id, 'Доступ временно заблокирован', user.block_reason ?? 'Обратитесь к администратору.');
  } else {
    pushNotification(user.id, 'Доступ восстановлен', 'Вы снова можете войти в приложение.');
  }

  adminLog(actor, input.blocked ? 'USER_BLOCKED' : 'USER_UNBLOCKED', 'user', user.id, user.block_reason ?? undefined);
  return bootstrap(token);
}

export async function sendUserNotification(
  token: string,
  input: {
    user_id: string;
    title: string;
    body: string;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureAdministrator(actor);
  getUserById(input.user_id);

  pushNotification(input.user_id, input.title.trim(), input.body.trim());
  adminLog(actor, 'USER_NOTIFIED', 'user', input.user_id, input.title.trim());
  return bootstrap(token);
}

export async function bindDevice(
  token: string,
  input: {
    device_id: string;
    platform: DeviceBinding['platform'];
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  const existing = database.devices.find(
    (entry) => entry.user_id === actor.id && entry.device_id === input.device_id,
  );
  if (existing) {
    existing.platform = input.platform;
    existing.is_active = true;
    existing.last_seen_at = nowIso();
    existing.deactivated_at = null;
  } else {
    database.devices.push({
      id: id('device'),
      user_id: actor.id,
      device_id: input.device_id,
      platform: input.platform,
      is_active: true,
      created_at: nowIso(),
      last_seen_at: nowIso(),
      deactivated_at: null,
    });
  }
  return bootstrap(token);
}

export async function recoverDeviceAccess(
  token: string,
  input: {
    device_id: string;
    platform: DeviceBinding['platform'];
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);

  database.devices = database.devices.map((entry) => {
    if (entry.user_id !== actor.id) {
      return entry;
    }
    if (entry.device_id === input.device_id) {
      return {
        ...entry,
        platform: input.platform,
        is_active: true,
        last_seen_at: nowIso(),
        deactivated_at: null,
      };
    }
    if (entry.is_active) {
      return {
        ...entry,
        is_active: false,
        deactivated_at: nowIso(),
      };
    }
    return entry;
  });

  if (!database.devices.some((entry) => entry.user_id === actor.id && entry.device_id === input.device_id)) {
    database.devices.push({
      id: id('device'),
      user_id: actor.id,
      device_id: input.device_id,
      platform: input.platform,
      is_active: true,
      created_at: nowIso(),
      last_seen_at: nowIso(),
      deactivated_at: null,
    });
  }

  return bootstrap(token);
}

export function resetDatabase(): void {
  database = createSeedDatabase();
  databaseInitialized = true;
  void persistDatabase();
}

export function getRawData(): DatabaseSnapshot {
  return clone(database);
}

export function getClassById(classId: string): ClassModel | undefined {
  return database.classes.find((entry) => entry.id === classId);
}

export function getLessonById(lessonId: string): Lesson | undefined {
  return database.lessons.find((entry) => entry.id === lessonId);
}
