import { createSeedDatabase } from '../data/seed';
import { createJwtToken, hashPassword, parseJwtToken } from '../lib/auth';
import { buildTranslations } from '../lib/translation';
import {
  AppLanguage,
  ClassModel,
  DatabaseSnapshot,
  Feedback,
  Homework,
  Lesson,
  LoginResponse,
  RoleId,
  Session,
  Thread,
  User,
} from '../types/models';

let database = createSeedDatabase();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function classIdsForUser(user: User): string[] {
  if (user.role_id === 1) {
    return database.classes.map((entry) => entry.id);
  }

  if (user.role_id === 4) {
    const children = database.users.filter((entry) => user.child_ids.includes(entry.id));
    return Array.from(new Set(children.flatMap((entry) => entry.class_ids)));
  }

  return user.class_ids;
}

function visibleUsersFor(user: User): User[] {
  if (user.role_id === 1) {
    return database.users;
  }

  const classIds = classIdsForUser(user);
  const visible = database.users.filter((entry) => {
    if (entry.id === user.id) {
      return true;
    }
    if (user.role_id === 4 && user.child_ids.includes(entry.id)) {
      return true;
    }
    if (entry.class_ids.some((classId) => classIds.includes(classId))) {
      return true;
    }
    return false;
  });

  return visible;
}

function visibleThreadsFor(user: User): Thread[] {
  if (user.role_id === 1) {
    return database.threads;
  }

  if (user.role_id === 5) {
    return database.threads.filter(
      (thread) => thread.type !== 'parent_teacher' && thread.participants.includes(user.id),
    );
  }

  return database.threads.filter((thread) => thread.participants.includes(user.id));
}

function visibleFeedbackFor(user: User): Feedback[] {
  if (user.role_id === 1) {
    return database.feedback;
  }

  if (user.role_id === 4) {
    return database.feedback.filter((item) => item.author_id === user.id);
  }

  if (user.role_id === 5 || user.role_id === 6) {
    return [];
  }

  if (user.role_id === 3) {
    return database.feedback.filter(
      (item) => item.author_id === user.id || (!item.is_private_to_author && item.visibility_roles.includes(3)),
    );
  }

  return [];
}

function visibleSnapshotFor(user: User): DatabaseSnapshot {
  const classIds = classIdsForUser(user);
  const classes = database.classes.filter((entry) => classIds.includes(entry.id));
  const lessons = database.lessons.filter((entry) => classIds.includes(entry.class_id));
  const homework = database.homework.filter((entry) => classIds.includes(entry.class_id));
  const threads = visibleThreadsFor(user);
  const threadIds = new Set(threads.map((thread) => thread.id));
  const messages = database.messages.filter((entry) => threadIds.has(entry.thread_id));
  const users = visibleUsersFor(user);
  const feedback = visibleFeedbackFor(user);

  return {
    school: clone(database.school),
    users: clone(users),
    classes: clone(classes),
    lessons: clone(lessons),
    homework: clone(homework),
    threads: clone(threads),
    messages: clone(messages),
    feedback: clone(feedback),
    absence: clone(database.absence),
    extra_classes: clone(database.extra_classes),
    signups: clone(database.signups),
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

function ensureDirector(user: User): void {
  if (user.role_id !== 1) {
    unauthorized('Director role required');
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

export async function login(input: {
  login: string;
  password: string;
  preferred_language: AppLanguage;
}): Promise<LoginResponse> {
  const found = database.users.find((entry) => entry.login === input.login && entry.is_active);

  if (!found || found.password_hash !== hashPassword(input.password)) {
    throw new Error('Invalid login or password');
  }

  found.preferred_language = input.preferred_language;

  return {
    session: sessionForUser(found),
    user: clone(found),
    snapshot: visibleSnapshotFor(found),
  };
}

export async function bootstrap(token: string): Promise<LoginResponse> {
  const user = requireAuth(token);
  return {
    session: sessionForUser(user),
    user: clone(user),
    snapshot: visibleSnapshotFor(user),
  };
}

export async function setUserLanguage(token: string, language: AppLanguage): Promise<LoginResponse> {
  const user = requireAuth(token);
  user.preferred_language = language;
  return {
    session: sessionForUser(user),
    user: clone(user),
    snapshot: visibleSnapshotFor(user),
  };
}

export async function assignHomeroomTeacher(
  token: string,
  input: { teacher_id: string; class_id: string; is_homeroom: boolean },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureDirector(actor);

  const teacher = getUserById(input.teacher_id);
  ensureTeacher(teacher);

  teacher.is_homeroom = input.is_homeroom;

  const classModel = database.classes.find((entry) => entry.id === input.class_id);
  if (!classModel) {
    throw new Error('Class not found');
  }
  classModel.homeroom_teacher_id = input.is_homeroom ? teacher.id : null;

  return bootstrap(token);
}

export async function updateUserRole(
  token: string,
  input: { user_id: string; role_id: RoleId },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureDirector(actor);

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
    attachments: string[];
    source: 'manual' | 'photo_ocr';
    ocr_raw_text: string | null;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);
  ensureTeacher(actor);

  const lesson = database.lessons.find((entry) => entry.id === input.lesson_id);
  if (!lesson) {
    throw new Error('Lesson not found');
  }

  const now = new Date().toISOString();

  if (input.homework_id) {
    const existing = database.homework.find((entry) => entry.id === input.homework_id);
    if (!existing) {
      throw new Error('Homework not found');
    }

    existing.text = input.text;
    existing.attachments = [...input.attachments];
    existing.source = input.source;
    existing.ocr_raw_text = input.ocr_raw_text;
    existing.updated_at = now;
  } else {
    database.homework.push({
      id: id('hw'),
      lesson_id: lesson.id,
      class_id: lesson.class_id,
      teacher_id: actor.id,
      text: input.text,
      attachments: [...input.attachments],
      source: input.source,
      ocr_raw_text: input.ocr_raw_text,
      created_at: now,
      updated_at: now,
    });
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

  database.messages.push({
    id: id('msg'),
    thread_id: thread.id,
    sender_id: actor.id,
    text_original: input.text_original,
    lang_original: actor.preferred_language,
    translations: buildTranslations(input.text_original, actor.preferred_language),
    attachments: [...input.attachments],
    created_at: new Date().toISOString(),
    read_by: [actor.id],
  });

  return bootstrap(token);
}

function classParticipants(classId: string): string[] {
  return database.users
    .filter((entry) => entry.class_ids.includes(classId) || entry.role_id === 1 || entry.role_id === 6)
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

export async function publishAnnouncement(
  token: string,
  input: {
    text_original: string;
    class_id?: string;
  },
): Promise<LoginResponse> {
  const actor = requireAuth(token);

  const canPublishGlobal = actor.role_id === 1;
  const canPublishClass = actor.role_id === 1 || (actor.role_id === 3 && actor.is_homeroom);

  if (input.class_id && !canPublishClass) {
    unauthorized('Class announcement requires homeroom or director role');
  }

  if (!input.class_id && !canPublishGlobal) {
    unauthorized('Global announcement requires director role');
  }

  const thread = input.class_id
    ? findOrCreateClassThread(input.class_id)
    : database.threads.find((entry) => entry.id === 'thread_director_all');

  if (!thread) {
    throw new Error('Announcement thread not found');
  }

  database.messages.push({
    id: id('msg_ann'),
    thread_id: thread.id,
    sender_id: actor.id,
    text_original: input.text_original,
    lang_original: actor.preferred_language,
    translations: buildTranslations(input.text_original, actor.preferred_language),
    attachments: [],
    created_at: new Date().toISOString(),
    read_by: [actor.id],
  });

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

  const canManageVisibility = actor.role_id === 1;
  const canApprove = actor.role_id === 1 || (actor.role_id === 3 && actor.is_homeroom);

  if (input.visibility_roles && !canManageVisibility) {
    unauthorized('Only director can manage visibility');
  }

  if (input.status && !canApprove) {
    unauthorized('Only director or homeroom teacher can update feedback status');
  }

  if (input.visibility_roles) {
    feedback.visibility_roles = [...input.visibility_roles];
  }
  if (input.status) {
    feedback.status = input.status;
  }

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
  if (!(actor.role_id === 1 || actor.role_id === 3)) {
    unauthorized('Only director or teacher can publish schedule changes');
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

export function resetDatabase(): void {
  database = createSeedDatabase();
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
