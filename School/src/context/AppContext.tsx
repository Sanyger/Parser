import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  assignHomeroomTeacher,
  assignStaffSchedule as assignStaffScheduleRequest,
  archiveClass as archiveClassRequest,
  archiveSubject as archiveSubjectRequest,
  bootstrap,
  createStaffScheduleException as createStaffScheduleExceptionRequest,
  createFeedback as createFeedbackRequest,
  createParentStudentRelationRequest as createParentStudentRelationRequestCall,
  createAbsence,
  deleteLesson as deleteLessonRequest,
  ensureDirectThread as ensureDirectThreadRequest,
  getBirthdays as getBirthdaysRequest,
  getStudentDetails as getStudentDetailsRequest,
  initDatabase,
  deleteHomework as deleteHomeworkRequest,
  reviewRegistrationApplication as reviewRegistrationApplicationRequest,
  reviewParentStudentRelationRequest as reviewParentStudentRelationRequestCall,
  login as loginRequest,
  markThreadRead,
  publishAnnouncement as publishAnnouncementRequest,
  publishScheduleChange,
  sendDirectMessage,
  sendUserNotification as sendUserNotificationRequest,
  setUserBlocked as setUserBlockedRequest,
  setParentHomeworkChecked as setParentHomeworkCheckedRequest,
  setStudentHomeworkDone as setStudentHomeworkDoneRequest,
  setUserLanguage,
  swapLessons,
  sendMessage,
  updateTeacherSubjects as updateTeacherSubjectsRequest,
  updateUserCard as updateUserCardRequest,
  updateOwnProfile as updateOwnProfileRequest,
  updateChildProfileByParent as updateChildProfileByParentRequest,
  updateOwnBirthdaySettings as updateOwnBirthdaySettingsRequest,
  updateUserPhoto,
  upsertLesson,
  upsertLessonReport,
  upsertStudentLessonRecord,
  upsertClass as upsertClassRequest,
  upsertSubject as upsertSubjectRequest,
  updateFeedback,
  updateUserRole,
  upsertHomework,
} from '../api/mockApi';
import { requestPushPermission, scheduleLocalPushAt, sendLocalPush } from '../lib/notifications';
import { t } from '../lib/i18n';
import { fromJerusalemDateTime, toJerusalemDateInput } from '../lib/time';
import { buildTranslations, detectLanguage, getLocalizedText } from '../lib/translation';
import {
  AppLanguage,
  ApplicationStatus,
  DatabaseSnapshot,
  FeedbackCategory,
  Feedback,
  LessonType,
  LoginResponse,
  RoleId,
  Session,
  StudentDetailsResponse,
  SubjectDeletionMode,
  TranslationMap,
  User,
} from '../types/models';

interface AppContextValue {
  loading: boolean;
  session: Session | null;
  currentUser: User | null;
  snapshot: DatabaseSnapshot | null;
  showOriginal: boolean;
  pushEnabled: boolean;
  login: (params: { login: string; password: string; language: AppLanguage }) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
  setLanguage: (language: AppLanguage) => Promise<void>;
  toggleShowOriginal: () => void;
  assignHomeroom: (teacherId: string, classId: string, isHomeroom: boolean) => Promise<void>;
  updateRole: (userId: string, roleId: RoleId) => Promise<void>;
  updateTeachingSubjects: (teacherId: string, teachingSubjects: string[]) => Promise<void>;
  updateOwnProfile: (params: { name: string; email: string | null; phone: string | null }) => Promise<void>;
  updateOwnBirthdaySettings: (params: { dob: string; showInCalendar: boolean }) => Promise<void>;
  saveHomework: (params: {
    homeworkId?: string;
    lessonId: string;
    text: string;
    assignedDate: string;
    dueDate: string;
    attachments: string[];
    source: 'manual' | 'photo_ocr';
    ocrRawText: string | null;
  }) => Promise<void>;
  deleteHomework: (homeworkId: string) => Promise<void>;
  setStudentHomeworkDone: (params: { homeworkId: string; done: boolean }) => Promise<void>;
  setParentHomeworkChecked: (params: {
    homeworkId: string;
    studentId: string;
    checked: boolean;
  }) => Promise<void>;
  requestParentStudentRelation: (params: { studentId: string }) => Promise<void>;
  reviewParentStudentRelation: (params: {
    requestId: string;
    status: 'approved' | 'rejected';
    comment?: string;
  }) => Promise<void>;
  sendThreadMessage: (params: { threadId: string; text: string; attachments: string[] }) => Promise<void>;
  publishAnnouncement: (params: { text: string; classId?: string }) => Promise<void>;
  sendAbsence: (params: { studentId: string; lessonId: string; note: string }) => Promise<void>;
  markRead: (threadId: string) => Promise<void>;
  createFeedback: (params: {
    text: string;
    category: FeedbackCategory;
    visibilityRoles?: RoleId[];
    classId?: string | null;
  }) => Promise<void>;
  updateFeedback: (params: { feedbackId: string; status?: Feedback['status']; visibilityRoles?: RoleId[] }) => Promise<void>;
  reviewApplication: (params: {
    applicationId: string;
    status: ApplicationStatus;
    comment?: string;
    missingInfoRequest?: string;
    assignedClassIds?: string[];
  }) => Promise<void>;
  upsertClassEntry: (params: {
    classId?: string;
    grade: string;
    nameI18n: TranslationMap;
    homeroomTeacherId?: string | null;
    subjectIds?: string[];
  }) => Promise<void>;
  archiveClassEntry: (classId: string) => Promise<void>;
  upsertSubjectEntry: (params: {
    subjectId?: string;
    name: string;
    nameI18n: TranslationMap;
  }) => Promise<void>;
  archiveSubjectEntry: (params: { subjectId: string; mode: SubjectDeletionMode }) => Promise<void>;
  updateUserCardEntry: (params: {
    userId: string;
    name?: string;
    dob?: string;
    showBirthdayInCalendar?: boolean;
    phone?: string | null;
    knownLanguages?: AppLanguage[];
    email?: string | null;
    documentNumber?: string | null;
    documentType?: User['document_type'];
    classIds?: string[];
    childIds?: string[];
    roleId?: RoleId;
  }) => Promise<void>;
  updateChildProfileByParentEntry: (params: {
    childId: string;
    phone?: string | null;
    knownLanguages?: AppLanguage[];
  }) => Promise<void>;
  setUserBlockedState: (params: { userId: string; blocked: boolean; reason?: string }) => Promise<void>;
  sendUserPush: (params: { userId: string; title: string; body: string }) => Promise<void>;
  assignStaffScheduleEntry: (params: {
    staffUserId?: string;
    bulkStaffUserIds?: string[];
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    startsOn: string;
    endsOn?: string | null;
  }) => Promise<void>;
  createStaffScheduleExceptionEntry: (params: {
    scheduleId: string;
    date: string;
    startTime?: string | null;
    endTime?: string | null;
    reason?: string | null;
  }) => Promise<void>;
  publishScheduleUpdate: (params: {
    lessonId: string;
    subject: string;
    room: string;
    reason: string;
  }) => Promise<void>;
  updateProfilePhoto: (photoUri: string | null) => Promise<void>;
  saveLesson: (params: {
    lessonId?: string;
    classId: string;
    subject: string;
    room: string;
    startDatetime: string;
    endDatetime: string;
    type: LessonType;
  }) => Promise<void>;
  deleteLesson: (lessonId: string) => Promise<void>;
  swapLessonSlots: (params: { firstLessonId: string; secondLessonId: string }) => Promise<void>;
  saveLessonReport: (params: {
    lessonId: string;
    summaryText: string;
    audioTranscript: string | null;
  }) => Promise<void>;
  saveStudentRecord: (params: {
    lessonId: string;
    studentId: string;
    absent: boolean;
    remark: string | null;
    grade: string | null;
  }) => Promise<void>;
  getStudentDetails: (studentId: string) => Promise<StudentDetailsResponse>;
  ensureDirectThreadWithUser: (targetUserId: string) => Promise<void>;
  sendDirectThreadMessage: (params: {
    targetUserId: string;
    text: string;
    attachments: string[];
  }) => Promise<void>;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

function useToken(session: Session | null): string {
  if (!session) {
    throw new Error('Session is required');
  }
  return session.token;
}

function useResponseUpdater(
  setSession: React.Dispatch<React.SetStateAction<Session | null>>,
  setCurrentUser: React.Dispatch<React.SetStateAction<User | null>>,
  setSnapshot: React.Dispatch<React.SetStateAction<DatabaseSnapshot | null>>,
) {
  return (response: LoginResponse) => {
    setSession(response.session);
    setCurrentUser(response.user);
    setSnapshot(response.snapshot);
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [snapshot, setSnapshot] = useState<DatabaseSnapshot | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const birthdayPushSignatureRef = useRef('');

  const applyResponse = useResponseUpdater(setSession, setCurrentUser, setSnapshot);

  useEffect(() => {
    let cancelled = false;

    void initDatabase().finally(() => {
      if (!cancelled) {
        setStorageReady(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    requestPushPermission().then(setPushEnabled);
  }, []);

  useEffect(() => {
    if (!session || !currentUser || !pushEnabled) {
      return;
    }

    let cancelled = false;

    const joinNames = (names: string[]): string => {
      if (names.length <= 1) {
        return names[0] ?? '';
      }
      if (names.length === 2) {
        return `${names[0]} и ${names[1]}`;
      }
      return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
    };

    void (async () => {
      try {
        const today = toJerusalemDateInput(new Date().toISOString());
        const birthdaysResponse = await getBirthdaysRequest(session.token, { date: today });
        if (cancelled || birthdaysResponse.birthdays.length === 0) {
          return;
        }

        const names = birthdaysResponse.birthdays.map((entry) => entry.name);
        const signature = `${currentUser.id}:${today}:${names.join('|')}`;
        if (birthdayPushSignatureRef.current === signature) {
          return;
        }

        const count = birthdaysResponse.birthdays.length;
        const namesText = joinNames(names.slice(0, 3));
        let body = `Сегодня день рождения у ${count} человек: ${namesText}. Не забудьте поздравить!`;

        if (currentUser.role_id === 1) {
          const anniversaryStaff = birthdaysResponse.birthdays.filter((entry) => entry.is_staff_anniversary);
          if (anniversaryStaff.length > 0) {
            body += ` Юбилей сотрудников: ${joinNames(anniversaryStaff.map((entry) => entry.name))}.`;
          }
        }

        const title = t(currentUser.preferred_language, {
          ru: 'Утреннее напоминание',
          en: 'Morning reminder',
          he: 'תזכורת בוקר',
        });

        const currentHour = Number.parseInt(
          new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Jerusalem',
            hour: '2-digit',
            hour12: false,
          }).format(new Date()),
          10,
        );

        if (currentHour >= 8) {
          await sendLocalPush(title, body);
        } else {
          const triggerIso = fromJerusalemDateTime(today, '08:00');
          if (triggerIso) {
            await scheduleLocalPushAt(new Date(triggerIso), title, body);
          } else {
            await sendLocalPush(title, body);
          }
        }

        birthdayPushSignatureRef.current = signature;
      } catch {
        // Ignore push errors in Expo Go / unsupported env.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, currentUser, pushEnabled]);

  const value = useMemo<AppContextValue>(
    () => ({
      loading: loading || !storageReady,
      session,
      currentUser,
      snapshot,
      showOriginal,
      pushEnabled,
      login: async ({ login, password, language }) => {
        await initDatabase();
        setLoading(true);
        try {
          const response = await loginRequest({
            login,
            password,
            preferred_language: language,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      logout: () => {
        setSession(null);
        setCurrentUser(null);
        setSnapshot(null);
        birthdayPushSignatureRef.current = '';
      },
      refresh: async () => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await bootstrap(useToken(session));
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      setLanguage: async (language) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await setUserLanguage(useToken(session), language);
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      toggleShowOriginal: () => setShowOriginal((entry) => !entry),
      assignHomeroom: async (teacherId, classId, isHomeroom) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await assignHomeroomTeacher(useToken(session), {
            teacher_id: teacherId,
            class_id: classId,
            is_homeroom: isHomeroom,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      updateRole: async (userId, roleId) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await updateUserRole(useToken(session), {
            user_id: userId,
            role_id: roleId,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      updateTeachingSubjects: async (teacherId, teachingSubjects) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await updateTeacherSubjectsRequest(useToken(session), {
            teacher_id: teacherId,
            teaching_subjects: teachingSubjects,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      updateOwnProfile: async ({ name, email, phone }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await updateOwnProfileRequest(useToken(session), {
            name,
            email,
            phone,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      updateOwnBirthdaySettings: async ({ dob, showInCalendar }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await updateOwnBirthdaySettingsRequest(useToken(session), {
            dob,
            show_birthday_in_calendar: showInCalendar,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      saveHomework: async ({
        homeworkId,
        lessonId,
        text,
        assignedDate,
        dueDate,
        attachments,
        source,
        ocrRawText,
      }) => {
        if (!session) {
          return;
        }
        const language = currentUser?.preferred_language ?? 'en';
        setLoading(true);
        try {
          const response = await upsertHomework(useToken(session), {
            homework_id: homeworkId,
            lesson_id: lessonId,
            text,
            assigned_date: assignedDate,
            due_date: dueDate,
            attachments,
            source,
            ocr_raw_text: ocrRawText,
          });
          applyResponse(response);
          if (pushEnabled) {
            void sendLocalPush(
              t(language, {
                ru: 'Добавлено домашнее задание',
                en: 'Homework added',
                he: 'נוסף שיעורי בית',
              }),
              t(language, {
                ru: 'Опубликовано новое домашнее задание.',
                en: 'A new homework item was published.',
                he: 'פורסם פריט שיעורי בית חדש.',
              }),
            );
          }
        } finally {
          setLoading(false);
        }
      },
      deleteHomework: async (homeworkId) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await deleteHomeworkRequest(useToken(session), {
            homework_id: homeworkId,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      setStudentHomeworkDone: async ({ homeworkId, done }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await setStudentHomeworkDoneRequest(useToken(session), {
            homework_id: homeworkId,
            done,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      setParentHomeworkChecked: async ({ homeworkId, studentId, checked }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await setParentHomeworkCheckedRequest(useToken(session), {
            homework_id: homeworkId,
            student_id: studentId,
            checked,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      requestParentStudentRelation: async ({ studentId }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await createParentStudentRelationRequestCall(useToken(session), {
            student_id: studentId,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      reviewParentStudentRelation: async ({ requestId, status, comment }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await reviewParentStudentRelationRequestCall(useToken(session), {
            request_id: requestId,
            status,
            comment,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      sendThreadMessage: async ({ threadId, text, attachments }) => {
        if (!session) {
          return;
        }
        const language = currentUser?.preferred_language ?? 'en';
        setLoading(true);
        try {
          const response = await sendMessage(useToken(session), {
            thread_id: threadId,
            text_original: text,
            attachments,
          });
          applyResponse(response);
          if (pushEnabled) {
            const localizedBody = getLocalizedText(
              text,
              buildTranslations(text, detectLanguage(text)),
              language,
              false,
            );
            await sendLocalPush(
              t(language, {
                ru: 'Новое сообщение',
                en: 'New message',
                he: 'הודעה חדשה',
              }),
              localizedBody,
            );
          }
        } finally {
          setLoading(false);
        }
      },
      publishAnnouncement: async ({ text, classId }) => {
        if (!session) {
          return;
        }
        const language = currentUser?.preferred_language ?? 'en';
        setLoading(true);
        try {
          const response = await publishAnnouncementRequest(useToken(session), {
            text_original: text,
            class_id: classId,
          });
          applyResponse(response);
          if (pushEnabled) {
            const localizedBody = getLocalizedText(
              text,
              buildTranslations(text, detectLanguage(text)),
              language,
              false,
            );
            await sendLocalPush(
              t(language, {
                ru: 'Объявление опубликовано',
                en: 'Announcement published',
                he: 'הודעה פורסמה',
              }),
              localizedBody,
            );
          }
        } finally {
          setLoading(false);
        }
      },
      sendAbsence: async ({ studentId, lessonId, note }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await createAbsence(useToken(session), {
            student_id: studentId,
            lesson_id: lessonId,
            note_from_parent: note,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      markRead: async (threadId) => {
        if (!session) {
          return;
        }
        const response = await markThreadRead(useToken(session), threadId);
        applyResponse(response);
      },
      createFeedback: async ({ text, category, visibilityRoles, classId }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await createFeedbackRequest(useToken(session), {
            text_original: text,
            category,
            visibility_roles: visibilityRoles,
            class_id: classId,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      updateFeedback: async ({ feedbackId, status, visibilityRoles }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await updateFeedback(useToken(session), {
            feedback_id: feedbackId,
            status,
            visibility_roles: visibilityRoles,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      reviewApplication: async ({ applicationId, status, comment, missingInfoRequest, assignedClassIds }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await reviewRegistrationApplicationRequest(useToken(session), {
            application_id: applicationId,
            status,
            comment,
            missing_info_request: missingInfoRequest,
            assigned_class_ids: assignedClassIds,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      upsertClassEntry: async ({ classId, grade, nameI18n, homeroomTeacherId, subjectIds }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await upsertClassRequest(useToken(session), {
            class_id: classId,
            grade,
            name_i18n: nameI18n,
            homeroom_teacher_id: homeroomTeacherId,
            subject_ids: subjectIds,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      archiveClassEntry: async (classId) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await archiveClassRequest(useToken(session), {
            class_id: classId,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      upsertSubjectEntry: async ({ subjectId, name, nameI18n }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await upsertSubjectRequest(useToken(session), {
            subject_id: subjectId,
            name,
            name_i18n: nameI18n,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      archiveSubjectEntry: async ({ subjectId, mode }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await archiveSubjectRequest(useToken(session), {
            subject_id: subjectId,
            mode,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      updateUserCardEntry: async ({
        userId,
        name,
        dob,
        showBirthdayInCalendar,
        phone,
        knownLanguages,
        email,
        documentNumber,
        documentType,
        classIds,
        childIds,
        roleId,
      }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await updateUserCardRequest(useToken(session), {
            user_id: userId,
            name,
            dob,
            show_birthday_in_calendar: showBirthdayInCalendar,
            phone,
            known_languages: knownLanguages,
            email,
            document_number: documentNumber,
            document_type: documentType,
            class_ids: classIds,
            child_ids: childIds,
            role_id: roleId,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      updateChildProfileByParentEntry: async ({ childId, phone, knownLanguages }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await updateChildProfileByParentRequest(useToken(session), {
            child_id: childId,
            phone,
            known_languages: knownLanguages,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      setUserBlockedState: async ({ userId, blocked, reason }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await setUserBlockedRequest(useToken(session), {
            user_id: userId,
            blocked,
            reason,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      sendUserPush: async ({ userId, title, body }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await sendUserNotificationRequest(useToken(session), {
            user_id: userId,
            title,
            body,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      assignStaffScheduleEntry: async ({
        staffUserId,
        bulkStaffUserIds,
        daysOfWeek,
        startTime,
        endTime,
        startsOn,
        endsOn,
      }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await assignStaffScheduleRequest(useToken(session), {
            staff_user_id: staffUserId,
            bulk_staff_user_ids: bulkStaffUserIds,
            days_of_week: daysOfWeek,
            start_time: startTime,
            end_time: endTime,
            starts_on: startsOn,
            ends_on: endsOn,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      createStaffScheduleExceptionEntry: async ({ scheduleId, date, startTime, endTime, reason }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await createStaffScheduleExceptionRequest(useToken(session), {
            schedule_id: scheduleId,
            date,
            start_time: startTime,
            end_time: endTime,
            reason,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      publishScheduleUpdate: async ({ lessonId, subject, room, reason }) => {
        if (!session) {
          return;
        }
        const language = currentUser?.preferred_language ?? 'en';
        setLoading(true);
        try {
          const response = await publishScheduleChange(useToken(session), {
            lesson_id: lessonId,
            subject,
            room,
            reason,
          });
          applyResponse(response);
          if (pushEnabled) {
            await sendLocalPush(
              t(language, {
                ru: 'Расписание изменено',
                en: 'Schedule changed',
                he: 'המערכת עודכנה',
              }),
              t(language, {
                ru: `${subject} перенесён в ${room}`,
                en: `${subject} moved to ${room}`,
                he: `${subject} הועבר ל-${room}`,
              }),
            );
          }
        } finally {
          setLoading(false);
        }
      },
      updateProfilePhoto: async (photoUri) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await updateUserPhoto(useToken(session), {
            photo_uri: photoUri,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      saveLesson: async ({ lessonId, classId, subject, room, startDatetime, endDatetime, type }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await upsertLesson(useToken(session), {
            lesson_id: lessonId,
            class_id: classId,
            subject,
            room,
            start_datetime: startDatetime,
            end_datetime: endDatetime,
            type,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      deleteLesson: async (lessonId) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await deleteLessonRequest(useToken(session), {
            lesson_id: lessonId,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      swapLessonSlots: async ({ firstLessonId, secondLessonId }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await swapLessons(useToken(session), {
            first_lesson_id: firstLessonId,
            second_lesson_id: secondLessonId,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      saveLessonReport: async ({ lessonId, summaryText, audioTranscript }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await upsertLessonReport(useToken(session), {
            lesson_id: lessonId,
            summary_text: summaryText,
            audio_transcript: audioTranscript,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      saveStudentRecord: async ({ lessonId, studentId, absent, remark, grade }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await upsertStudentLessonRecord(useToken(session), {
            lesson_id: lessonId,
            student_id: studentId,
            absent,
            remark,
            grade,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      getStudentDetails: async (studentId) => {
        if (!session) {
          throw new Error('Session is required');
        }
        return getStudentDetailsRequest(useToken(session), {
          student_id: studentId,
        });
      },
      ensureDirectThreadWithUser: async (targetUserId) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await ensureDirectThreadRequest(useToken(session), {
            target_user_id: targetUserId,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
      sendDirectThreadMessage: async ({ targetUserId, text, attachments }) => {
        if (!session) {
          return;
        }
        setLoading(true);
        try {
          const response = await sendDirectMessage(useToken(session), {
            target_user_id: targetUserId,
            text_original: text,
            attachments,
          });
          applyResponse(response);
        } finally {
          setLoading(false);
        }
      },
    }),
    [loading, storageReady, session, currentUser, snapshot, showOriginal, pushEnabled],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used inside AppProvider');
  }
  return context;
}
