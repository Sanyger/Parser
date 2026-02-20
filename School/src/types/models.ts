export type AppLanguage = 'he' | 'ru' | 'en';

export type RoleId = 1 | 2 | 3 | 4 | 5 | 6;

export type LessonType = 'lesson' | 'holiday' | 'event' | 'requirement';

export type LessonStatus = 'normal' | 'changed' | 'canceled';

export type ThreadType = 'parent_teacher' | 'class' | 'announcement';

export type FeedbackStatus = 'new' | 'reviewed' | 'planned' | 'done';

export interface School {
  id: string;
  name: string;
  timezone: string;
  enabled_languages: AppLanguage[];
  auto_translate_enabled: boolean;
}

export interface User {
  id: string;
  name: string;
  role_id: RoleId;
  login: string;
  password_hash: string;
  preferred_language: AppLanguage;
  is_homeroom: boolean;
  class_ids: string[];
  child_ids: string[];
  is_active: boolean;
}

export interface ClassModel {
  id: string;
  name: string;
  grade: string;
  homeroom_teacher_id: string | null;
}

export interface Lesson {
  id: string;
  class_id: string;
  teacher_id: string;
  subject: string;
  room: string;
  start_datetime: string;
  end_datetime: string;
  type: LessonType;
  status: LessonStatus;
  original_reference_id: string | null;
  change_reason: string | null;
}

export interface Homework {
  id: string;
  lesson_id: string;
  class_id: string;
  teacher_id: string;
  text: string;
  attachments: string[];
  source: 'manual' | 'photo_ocr';
  ocr_raw_text: string | null;
  created_at: string;
  updated_at: string;
}

export interface Thread {
  id: string;
  type: ThreadType;
  participants: string[];
  class_id: string | null;
}

export interface TranslationMap {
  ru: string;
  en: string;
  he: string;
}

export interface Message {
  id: string;
  thread_id: string;
  sender_id: string;
  text_original: string;
  lang_original: AppLanguage;
  translations: TranslationMap;
  attachments: string[];
  created_at: string;
  read_by: string[];
}

export interface Feedback {
  id: string;
  author_id: string;
  visibility_roles: RoleId[];
  is_private_to_author: boolean;
  text_original: string;
  translations: TranslationMap;
  status: FeedbackStatus;
}

export interface Absence {
  id: string;
  student_id: string;
  lesson_id: string;
  note_from_parent: string;
  status: 'new' | 'reviewed' | 'approved';
}

export interface ExtraClass {
  id: string;
  title: string;
  description: string;
  datetime: string;
  max_slots: number;
}

export interface Signup {
  id: string;
  extra_class_id: string;
  student_id: string;
  status: 'pending' | 'approved' | 'rejected';
}

export interface Session {
  token: string;
  user_id: string;
  role_id: RoleId;
  expires_at: string;
}

export interface DatabaseSnapshot {
  school: School;
  users: User[];
  classes: ClassModel[];
  lessons: Lesson[];
  homework: Homework[];
  threads: Thread[];
  messages: Message[];
  feedback: Feedback[];
  absence: Absence[];
  extra_classes: ExtraClass[];
  signups: Signup[];
}

export interface LoginResponse {
  session: Session;
  user: User;
  snapshot: DatabaseSnapshot;
}
