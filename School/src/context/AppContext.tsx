import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  assignHomeroomTeacher,
  bootstrap,
  createAbsence,
  login as loginRequest,
  markThreadRead,
  publishAnnouncement as publishAnnouncementRequest,
  publishScheduleChange,
  setUserLanguage,
  sendMessage,
  updateFeedback,
  updateUserRole,
  upsertHomework,
} from '../api/mockApi';
import { requestPushPermission, sendLocalPush } from '../lib/notifications';
import { t } from '../lib/i18n';
import {
  AppLanguage,
  DatabaseSnapshot,
  Feedback,
  LoginResponse,
  RoleId,
  Session,
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
  saveHomework: (params: {
    homeworkId?: string;
    lessonId: string;
    text: string;
    attachments: string[];
    source: 'manual' | 'photo_ocr';
    ocrRawText: string | null;
  }) => Promise<void>;
  sendThreadMessage: (params: { threadId: string; text: string; attachments: string[] }) => Promise<void>;
  publishAnnouncement: (params: { text: string; classId?: string }) => Promise<void>;
  sendAbsence: (params: { studentId: string; lessonId: string; note: string }) => Promise<void>;
  markRead: (threadId: string) => Promise<void>;
  updateFeedback: (params: { feedbackId: string; status?: Feedback['status']; visibilityRoles?: RoleId[] }) => Promise<void>;
  publishScheduleUpdate: (params: {
    lessonId: string;
    subject: string;
    room: string;
    reason: string;
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
  const [session, setSession] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [snapshot, setSnapshot] = useState<DatabaseSnapshot | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);

  const applyResponse = useResponseUpdater(setSession, setCurrentUser, setSnapshot);

  useEffect(() => {
    requestPushPermission().then(setPushEnabled);
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      loading,
      session,
      currentUser,
      snapshot,
      showOriginal,
      pushEnabled,
      login: async ({ login, password, language }) => {
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
      saveHomework: async ({ homeworkId, lessonId, text, attachments, source, ocrRawText }) => {
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
            attachments,
            source,
            ocr_raw_text: ocrRawText,
          });
          applyResponse(response);
          if (pushEnabled) {
            await sendLocalPush(
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
            await sendLocalPush(
              t(language, {
                ru: 'Новое сообщение',
                en: 'New message',
                he: 'הודעה חדשה',
              }),
              text,
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
            await sendLocalPush(
              t(language, {
                ru: 'Объявление опубликовано',
                en: 'Announcement published',
                he: 'הודעה פורסמה',
              }),
              text,
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
    }),
    [loading, session, currentUser, snapshot, showOriginal, pushEnabled],
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
