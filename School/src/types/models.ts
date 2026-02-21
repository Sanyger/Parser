export type AppLanguage = 'he' | 'ru' | 'en';

export type RoleId = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type LessonType = 'lesson' | 'holiday' | 'event' | 'requirement';

export type LessonStatus = 'normal' | 'changed' | 'canceled';

export type ThreadType = 'parent_teacher' | 'class' | 'announcement' | 'direct';

export type FeedbackStatus = 'new' | 'reviewed' | 'planned' | 'done';
export type FeedbackCategory = 'furniture' | 'gym' | 'canteen' | 'equipment';
export type IdentityDocumentType = 'teudat_zeut' | 'passport' | 'visa_a5';
export type ParentRelation = 'mother' | 'father' | 'guardian';
export type StaffRole = 'teacher' | 'staff' | 'administrator' | 'director';
export type ApplicationType = 'parent_with_student' | 'staff';
export type ApplicationStatus = 'new' | 'in_review' | 'need_more_info' | 'approved' | 'rejected';
export type SubjectDeletionMode = 'future_only' | 'all';

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
  photo_uri?: string | null;
  role_id: RoleId;
  login: string;
  password_hash: string;
  preferred_language: AppLanguage;
  is_homeroom: boolean;
  teaching_subjects?: string[];
  class_ids: string[];
  child_ids: string[];
  is_active: boolean;
  phone?: string | null;
  email?: string | null;
  dob?: string | null;
  show_birthday_in_calendar?: boolean;
  document_type?: IdentityDocumentType | null;
  document_number?: string | null;
  is_blocked?: boolean;
  block_reason?: string | null;
  initial_password?: string | null;
  known_languages?: AppLanguage[];
}

export interface StudentDetailsParent {
  user_id: string;
  name: string;
  photo_uri: string | null;
  phone: string | null;
  relation: ParentRelation;
}

export interface StudentDetailsResponse {
  student: {
    id: string;
    name: string;
    photo_uri: string | null;
    class_id: string;
    class_name: string;
    dob: string | null;
    is_birthday_today: boolean;
    status: 'present' | 'absent';
  };
  parents: StudentDetailsParent[];
  summary: {
    latest_grade: string | null;
    homework_total: number;
    homework_overdue: number;
    homework_unconfirmed: number;
  };
}

export interface ClassModel {
  id: string;
  name: string;
  grade: string;
  homeroom_teacher_id: string | null;
  name_i18n?: TranslationMap;
  subject_ids?: string[];
  is_archived?: boolean;
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
  text_original?: string;
  lang_original?: AppLanguage;
  translations?: TranslationMap;
  assigned_date: string;
  due_date: string;
  attachments: string[];
  student_confirmed_ids: string[];
  parent_confirmed_ids: string[];
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

export interface UploadedFile {
  id: string;
  name: string;
  uri: string;
  uploaded_at: string;
}

export interface StudentRegistrationData {
  first_name: string;
  last_name: string;
  birth_date: string;
  photo: UploadedFile;
  document_type: IdentityDocumentType;
  document_number: string;
  document_files: UploadedFile[];
}

export interface ParentRegistrationData {
  first_name: string;
  last_name: string;
  phone: string;
  phone_verified: boolean;
  email?: string | null;
  document_type: IdentityDocumentType;
  document_number: string;
  relation: ParentRelation;
  consent_personal_data: boolean;
}

export interface StaffRegistrationData {
  first_name: string;
  last_name: string;
  phone: string;
  phone_verified: boolean;
  email: string;
  document_type: IdentityDocumentType;
  document_number: string;
  document_files: UploadedFile[];
  role: StaffRole;
  subjects: string[];
  class_ids: string[];
  years_experience?: number | null;
  diploma_files: UploadedFile[];
  planned_start_date?: string | null;
  comment?: string | null;
}

export interface RegistrationApplication {
  id: string;
  type: ApplicationType;
  status: ApplicationStatus;
  created_at: string;
  updated_at: string;
  parent_data?: ParentRegistrationData;
  student_data?: StudentRegistrationData;
  staff_data?: StaffRegistrationData;
  reviewer_user_id?: string | null;
  review_comment?: string | null;
  missing_info_request?: string | null;
  approved_user_ids: string[];
  assigned_class_ids: string[];
}

export interface SubjectModel {
  id: string;
  name: string;
  name_i18n: TranslationMap;
  is_archived: boolean;
  archived_at?: string | null;
  archived_mode?: SubjectDeletionMode | null;
}

export interface StaffSchedule {
  id: string;
  staff_user_id: string;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  starts_on: string;
  ends_on: string | null;
  assigned_by_user_id: string;
  created_at: string;
}

export interface StaffScheduleException {
  id: string;
  schedule_id: string;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  reason?: string | null;
  created_by_user_id: string;
}

export interface DeviceBinding {
  id: string;
  user_id: string;
  device_id: string;
  platform: 'ios' | 'android' | 'web' | 'unknown';
  is_active: boolean;
  created_at: string;
  last_seen_at: string;
  deactivated_at?: string | null;
}

export interface AdminAuditLog {
  id: string;
  actor_user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  details?: string | null;
}

export interface UserNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  created_at: string;
  is_read: boolean;
}

export interface ParentStudentRelationRequest {
  id: string;
  parent_id: string;
  student_id: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  updated_at: string;
  reviewed_by_user_id?: string | null;
  comment?: string | null;
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
  class_id?: string | null;
  category?: FeedbackCategory;
  text_original: string;
  lang_original?: AppLanguage;
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

export interface LessonReport {
  id: string;
  lesson_id: string;
  teacher_id: string;
  summary_text: string;
  audio_transcript: string | null;
  updated_at: string;
}

export interface StudentLessonRecord {
  id: string;
  lesson_id: string;
  student_id: string;
  teacher_id: string;
  absent: boolean;
  remark: string | null;
  grade: string | null;
  updated_at: string;
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
  subjects: SubjectModel[];
  lessons: Lesson[];
  homework: Homework[];
  threads: Thread[];
  messages: Message[];
  feedback: Feedback[];
  absence: Absence[];
  lesson_reports: LessonReport[];
  student_lesson_records: StudentLessonRecord[];
  extra_classes: ExtraClass[];
  signups: Signup[];
  applications: RegistrationApplication[];
  staff_schedules: StaffSchedule[];
  staff_schedule_exceptions: StaffScheduleException[];
  devices: DeviceBinding[];
  admin_logs: AdminAuditLog[];
  notifications: UserNotification[];
  parent_student_relations: ParentStudentRelationRequest[];
}

export interface LoginResponse {
  session: Session;
  user: User;
  snapshot: DatabaseSnapshot;
}
