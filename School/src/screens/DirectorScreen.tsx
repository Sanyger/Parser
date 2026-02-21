import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BirthdaySettingsCard } from '../components/BirthdaySettingsCard';
import { isRtlLanguage, roleNameById, t } from '../lib/i18n';
import { formatDate, nowInJerusalemLabel, toJerusalemDateInput } from '../lib/time';
import { ensureTranslationMap, getLocalizedText } from '../lib/translation';
import {
  ApplicationStatus,
  DatabaseSnapshot,
  Feedback,
  RegistrationApplication,
  RoleId,
  User,
} from '../types/models';

type ProposalViewMode = 'list' | 'detail' | 'reject';
type PlannerViewMode = 'list' | 'editor';
type ApplicationActionMode = 'reject' | 'need_more_info';

type DirectorMeeting = {
  id: string;
  title: string;
  date: string;
  start: string;
  end: string;
  status: 'planned' | 'canceled';
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function feedbackStatusView(status: Feedback['status'], language: User['preferred_language']): {
  label: string;
  bg: string;
  text: string;
} {
  if (status === 'done') {
    return {
      label: t(language, { ru: 'Одобрено', en: 'Approved', he: 'אושר' }),
      bg: 'rgba(34, 197, 94, 0.17)',
      text: '#166534',
    };
  }
  if (status === 'planned') {
    return {
      label: t(language, { ru: 'В работе', en: 'In progress', he: 'בטיפול' }),
      bg: 'rgba(59, 130, 246, 0.17)',
      text: '#1D4ED8',
    };
  }
  if (status === 'reviewed') {
    return {
      label: t(language, { ru: 'Отклонено', en: 'Rejected', he: 'נדחה' }),
      bg: 'rgba(239, 68, 68, 0.16)',
      text: '#B91C1C',
    };
  }
  return {
    label: t(language, { ru: 'Новая', en: 'New', he: 'חדש' }),
    bg: 'rgba(251, 146, 60, 0.2)',
    text: '#9A3412',
  };
}

function sortFeedback(input: Feedback[]): Feedback[] {
  const score: Record<Feedback['status'], number> = {
    new: 0,
    planned: 1,
    done: 2,
    reviewed: 3,
  };
  return [...input].sort((left, right) => score[left.status] - score[right.status]);
}

function applicationStatusView(
  status: ApplicationStatus,
  language: User['preferred_language'],
): { label: string; bg: string; text: string } {
  if (status === 'approved') {
    return {
      label: t(language, { ru: 'Одобрено', en: 'Approved', he: 'אושר' }),
      bg: 'rgba(34, 197, 94, 0.18)',
      text: '#166534',
    };
  }
  if (status === 'in_review') {
    return {
      label: t(language, { ru: 'На проверке', en: 'In review', he: 'בבדיקה' }),
      bg: 'rgba(59, 130, 246, 0.17)',
      text: '#1D4ED8',
    };
  }
  if (status === 'need_more_info') {
    return {
      label: t(language, { ru: 'Нужны данные', en: 'Need more info', he: 'נדרש מידע נוסף' }),
      bg: 'rgba(245, 158, 11, 0.2)',
      text: '#B45309',
    };
  }
  if (status === 'rejected') {
    return {
      label: t(language, { ru: 'Отклонено', en: 'Rejected', he: 'נדחה' }),
      bg: 'rgba(239, 68, 68, 0.16)',
      text: '#B91C1C',
    };
  }
  return {
    label: t(language, { ru: 'Новая', en: 'New', he: 'חדש' }),
    bg: 'rgba(139, 92, 246, 0.2)',
    text: '#6D28D9',
  };
}

function applicationTypeLabel(
  type: RegistrationApplication['type'],
  language: User['preferred_language'],
): string {
  return type === 'parent_with_student'
    ? t(language, { ru: 'Родитель', en: 'Parent', he: 'הורה' })
    : t(language, { ru: 'Сотрудник', en: 'Staff', he: 'עובד/ת' });
}

function applicationDisplayName(
  application: RegistrationApplication,
  language: User['preferred_language'],
): string {
  if (application.type === 'parent_with_student') {
    const parentName = `${application.parent_data?.first_name ?? ''} ${application.parent_data?.last_name ?? ''}`.trim();
    const studentName = `${application.student_data?.first_name ?? ''} ${application.student_data?.last_name ?? ''}`.trim();
    return parentName || studentName || t(language, { ru: 'Без имени', en: 'No name', he: 'ללא שם' });
  }
  const staffName = `${application.staff_data?.first_name ?? ''} ${application.staff_data?.last_name ?? ''}`.trim();
  return staffName || t(language, { ru: 'Без имени', en: 'No name', he: 'ללא שם' });
}

function applicationPhotoUri(application: RegistrationApplication): string | null {
  if (application.type === 'parent_with_student') {
    return application.student_data?.photo?.uri ?? null;
  }
  return application.staff_data?.document_files?.[0]?.uri ?? null;
}

function isTeacherRole(roleId: RoleId): boolean {
  return roleId === 2 || roleId === 3;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function defaultMeetingStartHour(): string {
  const now = new Date();
  const hour = now.getHours() + 1;
  return `${pad2(Math.max(8, Math.min(19, hour)))}:00`;
}

function defaultMeetingEndHour(): string {
  const now = new Date();
  const hour = now.getHours() + 2;
  return `${pad2(Math.max(9, Math.min(20, hour)))}:00`;
}

export function DirectorScreen({
  user,
  snapshot,
  showOriginal,
  onToggleOriginal,
  onRefresh,
  onLogout,
  onAssignHomeroom: _onAssignHomeroom,
  onUpdateRole: _onUpdateRole,
  onPublishAnnouncement: _onPublishAnnouncement,
  onUpdateFeedback,
  onReviewApplication,
  onPublishScheduleUpdate: _onPublishScheduleUpdate,
  onUpdateBirthdaySettings,
}: {
  user: User;
  snapshot: DatabaseSnapshot;
  showOriginal: boolean;
  onToggleOriginal: () => void;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
  onAssignHomeroom: (teacherId: string, classId: string, isHomeroom: boolean) => Promise<void>;
  onUpdateRole: (userId: string, roleId: RoleId) => Promise<void>;
  onPublishAnnouncement: (params: { text: string }) => Promise<void>;
  onUpdateFeedback: (params: {
    feedbackId: string;
    status?: Feedback['status'];
    visibilityRoles?: RoleId[];
  }) => Promise<void>;
  onReviewApplication: (params: {
    applicationId: string;
    status: ApplicationStatus;
    comment?: string;
    missingInfoRequest?: string;
    assignedClassIds?: string[];
  }) => Promise<void>;
  onPublishScheduleUpdate: (params: {
    lessonId: string;
    subject: string;
    room: string;
    reason: string;
  }) => Promise<void>;
  onUpdateBirthdaySettings: (params: { dob: string; showInCalendar: boolean }) => Promise<void>;
}) {
  const language = user.preferred_language;
  const rtl = isRtlLanguage(language);
  const isAdministrator = user.role_id === 7;

  const [proposalMode, setProposalMode] = useState<ProposalViewMode>('list');
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('');
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [proposalSavingId, setProposalSavingId] = useState<string | null>(null);
  const [applicationActionMode, setApplicationActionMode] = useState<ApplicationActionMode | null>(null);
  const [applicationDraftId, setApplicationDraftId] = useState<string | null>(null);
  const [applicationReasonInput, setApplicationReasonInput] = useState('');
  const [applicationSavingId, setApplicationSavingId] = useState<string | null>(null);

  const [plannerMode, setPlannerMode] = useState<PlannerViewMode>('list');
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingDate, setMeetingDate] = useState(toJerusalemDateInput(new Date().toISOString()));
  const [meetingStart, setMeetingStart] = useState(defaultMeetingStartHour());
  const [meetingEnd, setMeetingEnd] = useState(defaultMeetingEndHour());

  const [meetings, setMeetings] = useState<DirectorMeeting[]>([
    {
      id: 'meeting_1',
      title: t(language, {
        ru: 'Приём родителей',
        en: 'Parent meeting',
        he: 'קבלת הורים',
      }),
      date: toJerusalemDateInput(new Date().toISOString()),
      start: '10:00',
      end: '11:00',
      status: 'planned',
    },
    {
      id: 'meeting_2',
      title: t(language, {
        ru: 'Совещание с завучами',
        en: 'Deputy principals sync',
        he: 'ישיבה עם סגני מנהל',
      }),
      date: toJerusalemDateInput(new Date().toISOString()),
      start: '13:30',
      end: '14:15',
      status: 'planned',
    },
  ]);

  const feedbackList = useMemo(() => sortFeedback(snapshot.feedback), [snapshot.feedback]);
  const applicationList = useMemo(() => {
    const statusOrder: Record<ApplicationStatus, number> = {
      new: 0,
      in_review: 1,
      need_more_info: 2,
      approved: 3,
      rejected: 4,
    };
    return [...snapshot.applications].sort((left, right) => {
      const statusDelta = statusOrder[left.status] - statusOrder[right.status];
      if (statusDelta !== 0) {
        return statusDelta;
      }
      return right.created_at.localeCompare(left.created_at);
    });
  }, [snapshot.applications]);

  const selectedProposal = useMemo(
    () => feedbackList.find((entry) => entry.id === selectedProposalId) ?? null,
    [feedbackList, selectedProposalId],
  );

  const localizedProposalText = (entry: Feedback): string =>
    getLocalizedText(
      entry.text_original,
      ensureTranslationMap(entry.text_original, entry.lang_original, entry.translations),
      language,
      showOriginal,
    );

  const usersById = useMemo(() => new Map(snapshot.users.map((entry) => [entry.id, entry])), [snapshot.users]);
  const applicationsById = useMemo(
    () => new Map(snapshot.applications.map((entry) => [entry.id, entry])),
    [snapshot.applications],
  );
  const activeDraftApplication = useMemo(
    () => (applicationDraftId ? applicationsById.get(applicationDraftId) ?? null : null),
    [applicationDraftId, applicationsById],
  );
  const defaultClassId = useMemo(
    () =>
      snapshot.classes.find((entry) => !entry.is_archived)?.id ?? snapshot.classes[0]?.id ?? null,
    [snapshot.classes],
  );

  const studentCount = snapshot.users.filter((entry) => entry.role_id === 5 && entry.is_active).length;
  const absentStudents = new Set(snapshot.absence.map((entry) => entry.student_id)).size;

  const attendancePercent =
    snapshot.student_lesson_records.length > 0 && studentCount > 0
      ? Math.max(0, Math.min(100, Math.round(((studentCount - absentStudents) / studentCount) * 100)))
      : 94;

  const activeTeachers = snapshot.users.filter(
    (entry) => entry.is_active && isTeacherRole(entry.role_id as RoleId),
  ).length;
  const teachersOnDuty = activeTeachers >= 5 ? activeTeachers : 45;

  const newIdeasCount = snapshot.feedback.filter((entry) => entry.status === 'new').length;

  const submitProposalStatus = async (feedbackId: string, status: Feedback['status']) => {
    try {
      setProposalSavingId(feedbackId);
      await onUpdateFeedback({ feedbackId, status });
    } finally {
      setProposalSavingId(null);
    }
  };

  const openProposalDetails = (feedbackId: string) => {
    setSelectedProposalId(feedbackId);
    setProposalMode('detail');
    setRejectReasonInput('');
  };

  const openRejectMode = (feedbackId: string) => {
    setSelectedProposalId(feedbackId);
    setProposalMode('reject');
    setRejectReasonInput(rejectReasons[feedbackId] ?? '');
  };

  const approveProposal = async (feedbackId: string) => {
    await submitProposalStatus(feedbackId, 'done');
    Alert.alert(
      t(language, { ru: 'Одобрено', en: 'Approved', he: 'אושר' }),
      t(language, {
        ru: 'Статус обновлён. Автор получил уведомление.',
        en: 'Status updated. Author was notified.',
        he: 'הסטטוס עודכן. המחבר קיבל התראה.',
      }),
    );
  };

  const moveProposalToWork = async (feedbackId: string) => {
    await submitProposalStatus(feedbackId, 'planned');
    Alert.alert(
      t(language, { ru: 'В работе', en: 'In progress', he: 'בטיפול' }),
      t(language, {
        ru: 'Задача переведена в работу. Автор получил уведомление.',
        en: 'Proposal moved to in-progress. Author was notified.',
        he: 'ההצעה הועברה לטיפול. המחבר קיבל התראה.',
      }),
    );
  };

  const rejectProposal = async () => {
    if (!selectedProposal || !rejectReasonInput.trim()) {
      Alert.alert(
        t(language, { ru: 'Нужно заполнить причину', en: 'Reason is required', he: 'נדרשת סיבה' }),
        t(language, {
          ru: 'Укажите, почему предложение отклонено.',
          en: 'Please enter why the proposal was rejected.',
          he: 'אנא הזן למה ההצעה נדחתה.',
        }),
      );
      return;
    }

    await submitProposalStatus(selectedProposal.id, 'reviewed');
    setRejectReasons((prev) => ({
      ...prev,
      [selectedProposal.id]: rejectReasonInput.trim(),
    }));
    Alert.alert(
      t(language, { ru: 'Отклонено', en: 'Rejected', he: 'נדחה' }),
      t(language, {
        ru: 'Причина сохранена. Автор получил уведомление.',
        en: 'Reason saved. Author was notified.',
        he: 'הסיבה נשמרה. המחבר קיבל התראה.',
      }),
    );
    setProposalMode('detail');
  };

  const submitApplicationStatus = async (params: {
    applicationId: string;
    status: ApplicationStatus;
    comment?: string;
    missingInfoRequest?: string;
    assignedClassIds?: string[];
  }) => {
    setApplicationSavingId(params.applicationId);
    try {
      await onReviewApplication(params);
    } finally {
      setApplicationSavingId(null);
    }
  };

  const openApplicationAction = (applicationId: string, mode: ApplicationActionMode) => {
    const application = applicationsById.get(applicationId);
    setApplicationDraftId(applicationId);
    setApplicationActionMode(mode);
    if (!application) {
      setApplicationReasonInput('');
      return;
    }
    setApplicationReasonInput(
      mode === 'reject'
        ? application.review_comment ?? ''
        : application.missing_info_request ?? '',
    );
  };

  const closeApplicationAction = () => {
    setApplicationDraftId(null);
    setApplicationActionMode(null);
    setApplicationReasonInput('');
  };

  const moveApplicationToReview = async (applicationId: string) => {
    await submitApplicationStatus({
      applicationId,
      status: 'in_review',
      comment: t(language, {
        ru: 'Проверка начата администратором',
        en: 'Review started by administrator',
        he: 'הבדיקה החלה על ידי מנהל מערכת',
      }),
    });
  };

  const approveApplication = async (application: RegistrationApplication) => {
    const assignedClassIds =
      application.type === 'parent_with_student'
        ? defaultClassId
          ? [defaultClassId]
          : []
        : application.staff_data?.class_ids.length
          ? application.staff_data.class_ids
          : defaultClassId
            ? [defaultClassId]
            : [];

    await submitApplicationStatus({
      applicationId: application.id,
      status: 'approved',
      comment: t(language, {
        ru: 'Заявка одобрена из панели администратора',
        en: 'Approved from admin panel',
        he: 'הבקשה אושרה מפאנל הניהול',
      }),
      assignedClassIds,
    });
  };

  const submitApplicationAction = async () => {
    if (!activeDraftApplication || !applicationActionMode) {
      return;
    }

    const reason = applicationReasonInput.trim();
    if (!reason) {
      Alert.alert(
        t(language, { ru: 'Добавьте комментарий', en: 'Add comment', he: 'הוסף הערה' }),
        t(language, {
          ru: 'Для этого действия нужна причина.',
          en: 'A reason is required for this action.',
          he: 'נדרשת סיבה לפעולה זו.',
        }),
      );
      return;
    }

    if (applicationActionMode === 'reject') {
      await submitApplicationStatus({
        applicationId: activeDraftApplication.id,
        status: 'rejected',
        comment: reason,
      });
    } else {
      await submitApplicationStatus({
        applicationId: activeDraftApplication.id,
        status: 'need_more_info',
        missingInfoRequest: reason,
      });
    }
    closeApplicationAction();
  };

  const showApplicationDocuments = (application: RegistrationApplication) => {
    const files =
      application.type === 'parent_with_student'
        ? [
            application.student_data?.photo?.name,
            ...(application.student_data?.document_files ?? []).map((entry) => entry.name),
          ]
        : application.staff_data?.document_files?.map((entry) => entry.name) ?? [];

    Alert.alert(
      t(language, { ru: 'Документы', en: 'Documents', he: 'מסמכים' }),
      files.filter(Boolean).join('\n') ||
        t(language, { ru: 'Файлы не загружены', en: 'No files uploaded', he: 'לא הועלו קבצים' }),
    );
  };

  const resetMeetingForm = () => {
    setEditingMeetingId(null);
    setMeetingTitle('');
    setMeetingDate(toJerusalemDateInput(new Date().toISOString()));
    setMeetingStart(defaultMeetingStartHour());
    setMeetingEnd(defaultMeetingEndHour());
  };

  const openMeetingCreate = () => {
    resetMeetingForm();
    setPlannerMode('editor');
  };

  const openMeetingEdit = (meeting: DirectorMeeting) => {
    setEditingMeetingId(meeting.id);
    setMeetingTitle(meeting.title);
    setMeetingDate(meeting.date);
    setMeetingStart(meeting.start);
    setMeetingEnd(meeting.end);
    setPlannerMode('editor');
  };

  const saveMeeting = () => {
    if (!meetingTitle.trim()) {
      Alert.alert(
        t(language, { ru: 'Нужно название', en: 'Title required', he: 'נדרשת כותרת' }),
        t(language, {
          ru: 'Добавьте описание встречи.',
          en: 'Add a meeting title.',
          he: 'הוסף כותרת לפגישה.',
        }),
      );
      return;
    }

    if (!TIME_PATTERN.test(meetingStart) || !TIME_PATTERN.test(meetingEnd)) {
      Alert.alert(
        t(language, { ru: 'Неверное время', en: 'Invalid time', he: 'זמן לא תקין' }),
        t(language, {
          ru: 'Введите время в формате ЧЧ:ММ.',
          en: 'Use HH:MM format.',
          he: 'השתמש בפורמט HH:MM.',
        }),
      );
      return;
    }

    if (meetingStart >= meetingEnd) {
      Alert.alert(
        t(language, { ru: 'Проверьте интервал', en: 'Check range', he: 'בדוק טווח' }),
        t(language, {
          ru: 'Время окончания должно быть позже начала.',
          en: 'End time must be after start time.',
          he: 'שעת סיום צריכה להיות אחרי שעת התחלה.',
        }),
      );
      return;
    }

    if (editingMeetingId) {
      setMeetings((prev) =>
        prev.map((entry) =>
          entry.id === editingMeetingId
            ? {
                ...entry,
                title: meetingTitle.trim(),
                date: meetingDate.trim(),
                start: meetingStart,
                end: meetingEnd,
                status: 'planned',
              }
            : entry,
        ),
      );
    } else {
      setMeetings((prev) => [
        {
          id: `meeting_${Date.now()}`,
          title: meetingTitle.trim(),
          date: meetingDate.trim(),
          start: meetingStart,
          end: meetingEnd,
          status: 'planned',
        },
        ...prev,
      ]);
    }

    setPlannerMode('list');
    resetMeetingForm();
  };

  const cancelMeeting = (meetingId: string) => {
    setMeetings((prev) =>
      prev.map((entry) => (entry.id === meetingId ? { ...entry, status: 'canceled' } : entry)),
    );
  };

  const renderBackButton = (onPress: () => void) => (
    <Pressable style={[styles.backButton, rtl && styles.rowReverse]} onPress={onPress}>
      <Ionicons name={rtl ? 'chevron-forward' : 'chevron-back'} size={18} color="#4338CA" />
      <Text style={[styles.backButtonText, rtl && styles.textRtl]}>
        {t(language, { ru: 'Назад', en: 'Back', he: 'חזרה' })}
      </Text>
    </Pressable>
  );

  const criticalAlerts = feedbackList.filter((entry) => entry.status === 'new').length;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <LinearGradient
          colors={['#1E1B4B', '#581C87']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerGradient}
        >
          <View style={[styles.headerTopRow, rtl && styles.rowReverse]}>
            <View style={[styles.profileBlock, rtl && styles.rowReverse]}>
              {user.photo_uri ? (
                <Image source={{ uri: user.photo_uri }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}>
                  <Ionicons name="person" size={30} color="#E5E7EB" />
                </View>
              )}

              <View style={styles.profileTextWrap}>
                <Text style={[styles.headerName, rtl && styles.textRtl]}>{user.name}</Text>
                <View style={[styles.titleRow, rtl && styles.rowReverse]}>
                  <MaterialCommunityIcons name="crown" size={15} color="#FDE68A" />
                  <Text style={[styles.headerRole, rtl && styles.textRtl]}>
                    {t(language, {
                      ru: isAdministrator ? 'Администратор школы' : 'Директор школы',
                      en: isAdministrator ? 'School Administrator' : 'School Director',
                      he: isAdministrator ? 'מנהל מערכת בית הספר' : 'מנהל/ת בית הספר',
                    })}
                  </Text>
                </View>
                <Text style={[styles.headerTime, rtl && styles.textRtl]}>{nowInJerusalemLabel(language)}</Text>
              </View>
            </View>

            <Pressable
              style={styles.alertBellButton}
              onPress={() =>
                Alert.alert(
                  t(language, {
                    ru: 'Критические уведомления',
                    en: 'Critical alerts',
                    he: 'התראות קריטיות',
                  }),
                  t(language, {
                    ru: `Сейчас новых сигналов: ${criticalAlerts}`,
                    en: `New critical alerts now: ${criticalAlerts}`,
                    he: `התראות חדשות כעת: ${criticalAlerts}`,
                  }),
                )
              }
            >
              <Ionicons name="notifications-outline" size={22} color="#F8FAFC" />
              {criticalAlerts > 0 ? (
                <View style={styles.alertBadge}>
                  <Text style={styles.alertBadgeText}>{criticalAlerts}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>

          <View style={[styles.headerActions, rtl && styles.rowReverse]}>
            <Pressable style={styles.headerActionButton} onPress={onToggleOriginal}>
              <Text style={[styles.headerActionText, rtl && styles.textRtl]}>
                {showOriginal
                  ? t(language, { ru: 'Оригинал: ВКЛ', en: 'Original: ON', he: 'מקור: פעיל' })
                  : t(language, { ru: 'Оригинал: ВЫКЛ', en: 'Original: OFF', he: 'מקור: כבוי' })}
              </Text>
            </Pressable>
            <Pressable style={styles.headerActionButton} onPress={onRefresh}>
              <Text style={[styles.headerActionText, rtl && styles.textRtl]}>
                {t(language, { ru: 'Обновить', en: 'Refresh', he: 'רענון' })}
              </Text>
            </Pressable>
            <Pressable style={[styles.headerActionButton, styles.headerLogoutButton]} onPress={onLogout}>
              <Text style={[styles.headerActionText, rtl && styles.textRtl]}>
                {t(language, { ru: 'Выйти', en: 'Logout', he: 'יציאה' })}
              </Text>
            </Pressable>
          </View>
        </LinearGradient>

        <View style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>
            {t(language, { ru: 'Дата рождения', en: 'Birthdate', he: 'תאריך לידה' })}
          </Text>
          {user.dob ? (
            <Text style={[styles.sectionSubtitle, rtl && styles.textRtl]}>
              {user.dob.split('-').reverse().join('.')} 🎂
            </Text>
          ) : null}
          <BirthdaySettingsCard user={user} onSave={onUpdateBirthdaySettings} />
        </View>

        <View style={styles.metricRow}>
          <View style={styles.metricCard}>
            <View style={[styles.metricIconWrap, { backgroundColor: 'rgba(34, 197, 94, 0.16)' }]}>
              <Ionicons name="people-outline" size={18} color="#166534" />
            </View>
            <Text style={styles.metricValue}>{attendancePercent}%</Text>
            <Text style={[styles.metricLabel, rtl && styles.textRtl]}>
              {t(language, { ru: 'Посещаемость', en: 'Attendance', he: 'נוכחות' })}
            </Text>
          </View>

          <View style={styles.metricCard}>
            <View style={[styles.metricIconWrap, { backgroundColor: 'rgba(59, 130, 246, 0.16)' }]}>
              <Ionicons name="school-outline" size={18} color="#1D4ED8" />
            </View>
            <Text style={styles.metricValue}>{teachersOnDuty}</Text>
            <Text style={[styles.metricLabel, rtl && styles.textRtl]}>
              {t(language, { ru: 'Учителя в строю', en: 'Teachers on duty', he: 'מורים בתפקיד' })}
            </Text>
          </View>

          <View style={styles.metricCard}>
            <View style={[styles.metricIconWrap, { backgroundColor: 'rgba(245, 158, 11, 0.18)' }]}>
              <Ionicons name="bulb-outline" size={18} color="#B45309" />
            </View>
            <Text style={styles.metricValue}>{newIdeasCount}</Text>
            <Text style={[styles.metricLabel, rtl && styles.textRtl]}>
              {t(language, { ru: 'Новых идей', en: 'New ideas', he: 'רעיונות חדשים' })}
            </Text>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={[styles.sectionTitleRow, rtl && styles.rowReverse]}>
            <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Очередь заявок',
                en: 'Application queue',
                he: 'תור בקשות',
              })}
            </Text>
            <Text style={[styles.sectionSubtitle, rtl && styles.textRtl]}>
              {t(language, {
                ru: `Всего: ${applicationList.length}`,
                en: `Total: ${applicationList.length}`,
                he: `סה"כ: ${applicationList.length}`,
              })}
            </Text>
          </View>

          {applicationList.length === 0 ? (
            <Text style={[styles.emptyStateText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Новых заявок пока нет',
                en: 'No new applications yet',
                he: 'אין בקשות חדשות כרגע',
              })}
            </Text>
          ) : null}

          {applicationList.map((entry) => {
            const status = applicationStatusView(entry.status, language);
            const typeLabel = applicationTypeLabel(entry.type, language);
            const applicantName = applicationDisplayName(entry, language);
            const avatarUri = applicationPhotoUri(entry);
            const blocked = entry.status === 'approved' || entry.status === 'rejected';
            const staffRole =
              entry.staff_data?.role === 'teacher'
                ? t(language, { ru: 'Учитель', en: 'Teacher', he: 'מורה' })
                : entry.staff_data?.role === 'administrator'
                  ? t(language, { ru: 'Администратор', en: 'Administrator', he: 'מנהל מערכת' })
                  : entry.staff_data?.role === 'director'
                    ? t(language, { ru: 'Директор', en: 'Director', he: 'מנהל/ת' })
                    : t(language, { ru: 'Сотрудник', en: 'Staff', he: 'עובד/ת' });

            return (
              <View key={entry.id} style={styles.applicationCard}>
                <LinearGradient
                  colors={['rgba(30, 27, 75, 0.93)', 'rgba(76, 29, 149, 0.9)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.applicationCardGradient}
                >
                  <View style={[styles.applicationTopRow, rtl && styles.rowReverse]}>
                    <View style={styles.applicationTypeBadge}>
                      <Text style={styles.applicationTypeBadgeText}>{typeLabel}</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                      <Text style={[styles.statusBadgeText, { color: status.text }]}>{status.label}</Text>
                    </View>
                  </View>

                  <View style={[styles.applicationMainRow, rtl && styles.rowReverse]}>
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={styles.applicationAvatar} />
                    ) : (
                      <View style={[styles.applicationAvatar, styles.applicationAvatarFallback]}>
                        <Ionicons name="person" size={24} color="#CBD5E1" />
                      </View>
                    )}
                    <View style={styles.applicationMainText}>
                      <Text style={[styles.applicationName, rtl && styles.textRtl]}>{applicantName}</Text>
                      <Text style={[styles.applicationMeta, rtl && styles.textRtl]}>
                        {entry.type === 'parent_with_student'
                          ? t(language, {
                              ru: `Ученик: ${entry.student_data?.first_name ?? '-'} ${entry.student_data?.last_name ?? ''}`.trim(),
                              en: `Student: ${entry.student_data?.first_name ?? '-'} ${entry.student_data?.last_name ?? ''}`.trim(),
                              he: `תלמיד/ה: ${entry.student_data?.first_name ?? '-'} ${entry.student_data?.last_name ?? ''}`.trim(),
                            })
                          : t(language, {
                              ru: `Роль: ${staffRole}`,
                              en: `Role: ${staffRole}`,
                              he: `תפקיד: ${staffRole}`,
                            })}
                      </Text>
                      <Text style={[styles.applicationMeta, rtl && styles.textRtl]}>
                        {t(language, {
                          ru: `Подана: ${formatDate(entry.created_at, language)}`,
                          en: `Submitted: ${formatDate(entry.created_at, language)}`,
                          he: `נשלחה: ${formatDate(entry.created_at, language)}`,
                        })}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.applicationActionRow, rtl && styles.rowReverse]}>
                    <Pressable onPress={() => showApplicationDocuments(entry)} style={styles.applicationDocsButton}>
                      <Text style={styles.applicationDocsButtonText}>
                        {t(language, {
                          ru: 'Посмотреть доки',
                          en: 'View docs',
                          he: 'הצג מסמכים',
                        })}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={[styles.applicationActionRow, rtl && styles.rowReverse]}>
                    <Pressable
                      disabled={blocked || applicationSavingId === entry.id}
                      onPress={() => approveApplication(entry)}
                      style={({ pressed }) => [
                        styles.applicationPrimaryAction,
                        (blocked || applicationSavingId === entry.id) && styles.actionDisabled,
                        pressed && styles.pressedScale,
                      ]}
                    >
                      <LinearGradient
                        colors={['#8A3FFC', '#FF4FA1', '#2F8CFF']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                      <Text style={styles.applicationPrimaryActionText}>
                        {t(language, { ru: 'Принять', en: 'Approve', he: 'אשר' })}
                      </Text>
                    </Pressable>
                    <Pressable
                      disabled={blocked || applicationSavingId === entry.id}
                      onPress={() => moveApplicationToReview(entry.id)}
                      style={({ pressed }) => [
                        styles.applicationSecondaryAction,
                        (blocked || applicationSavingId === entry.id) && styles.actionDisabled,
                        pressed && styles.pressedScale,
                      ]}
                    >
                      <Text style={styles.applicationSecondaryActionText}>
                        {t(language, { ru: 'В работу', en: 'In review', he: 'לטיפול' })}
                      </Text>
                    </Pressable>
                  </View>

                  <View style={[styles.applicationActionRow, rtl && styles.rowReverse]}>
                    <Pressable
                      disabled={blocked || applicationSavingId === entry.id}
                      onPress={() => openApplicationAction(entry.id, 'need_more_info')}
                      style={({ pressed }) => [
                        styles.applicationSecondaryAction,
                        (blocked || applicationSavingId === entry.id) && styles.actionDisabled,
                        pressed && styles.pressedScale,
                      ]}
                    >
                      <Text style={styles.applicationSecondaryActionText}>
                        {t(language, { ru: 'Запросить данные', en: 'Request info', he: 'בקש מידע' })}
                      </Text>
                    </Pressable>
                    <Pressable
                      disabled={blocked || applicationSavingId === entry.id}
                      onPress={() => openApplicationAction(entry.id, 'reject')}
                      style={({ pressed }) => [
                        styles.applicationDangerAction,
                        (blocked || applicationSavingId === entry.id) && styles.actionDisabled,
                        pressed && styles.pressedScale,
                      ]}
                    >
                      <Text style={styles.applicationDangerActionText}>
                        {t(language, { ru: 'Отклонить', en: 'Reject', he: 'דחה' })}
                      </Text>
                    </Pressable>
                  </View>
                </LinearGradient>
              </View>
            );
          })}

          {applicationActionMode && activeDraftApplication ? (
            <View style={styles.nestedPanel}>
              {renderBackButton(closeApplicationAction)}
              <Text style={[styles.nestedTitle, rtl && styles.textRtl]}>
                {applicationActionMode === 'reject'
                  ? t(language, {
                      ru: 'Укажите причину отклонения',
                      en: 'Enter rejection reason',
                      he: 'הזן סיבת דחייה',
                    })
                  : t(language, {
                      ru: 'Что нужно дополнить?',
                      en: 'What info is missing?',
                      he: 'איזה מידע חסר?',
                    })}
              </Text>
              <TextInput
                value={applicationReasonInput}
                onChangeText={setApplicationReasonInput}
                multiline
                placeholder={t(language, {
                  ru: 'Короткий комментарий',
                  en: 'Short comment',
                  he: 'הערה קצרה',
                })}
                placeholderTextColor="#94A3B8"
                style={[styles.rejectInput, rtl && styles.textRtl]}
              />
              <Pressable
                style={[styles.actionBtn, styles.progressBtn, styles.rejectSubmitButton]}
                disabled={applicationSavingId === activeDraftApplication.id}
                onPress={submitApplicationAction}
              >
                <Text style={styles.actionBtnText}>
                  {t(language, { ru: 'Сохранить', en: 'Save', he: 'שמור' })}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.sectionCard}>
          <View style={[styles.sectionTitleRow, rtl && styles.rowReverse]}>
            <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Управление предложениями (Public Roadmap)',
                en: 'Suggestion Management (Public Roadmap)',
                he: 'ניהול הצעות (Public Roadmap)',
              })}
            </Text>
            <Text style={[styles.sectionSubtitle, rtl && styles.textRtl]}>
              {t(language, {
                ru: `Всего: ${feedbackList.length}`,
                en: `Total: ${feedbackList.length}`,
                he: `סה"כ: ${feedbackList.length}`,
              })}
            </Text>
          </View>

          {proposalMode === 'list'
            ? feedbackList.map((entry) => {
                const author = usersById.get(entry.author_id);
                const status = feedbackStatusView(entry.status, language);
                return (
                  <Pressable key={entry.id} style={styles.proposalCard} onPress={() => openProposalDetails(entry.id)}>
                    <View style={[styles.proposalAuthorRow, rtl && styles.rowReverse]}>
                      {author?.photo_uri ? (
                        <Image source={{ uri: author.photo_uri }} style={styles.proposalAvatar} />
                      ) : (
                        <View style={[styles.proposalAvatar, styles.proposalAvatarFallback]}>
                          <Ionicons name="person" size={16} color="#9CA3AF" />
                        </View>
                      )}
                      <View style={styles.proposalAuthorTextWrap}>
                        <Text style={[styles.proposalAuthorName, rtl && styles.textRtl]}>
                          {author?.name ?? t(language, { ru: 'Неизвестный автор', en: 'Unknown author', he: 'מחבר לא ידוע' })}
                        </Text>
                        <Text style={[styles.proposalAuthorRole, rtl && styles.textRtl]}>
                          {author ? roleNameById(author.role_id as RoleId, language) : '-'}
                        </Text>
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: status.bg }]}>
                        <Text style={[styles.statusBadgeText, { color: status.text }]}>{status.label}</Text>
                      </View>
                    </View>

                    <Text style={[styles.proposalText, rtl && styles.textRtl]}>{localizedProposalText(entry)}</Text>
                  </Pressable>
                );
              })
            : null}

          {proposalMode === 'detail' && selectedProposal ? (
            <View style={styles.nestedPanel}>
              {renderBackButton(() => setProposalMode('list'))}
              <Text style={[styles.nestedTitle, rtl && styles.textRtl]}>
                {t(language, { ru: 'Карточка предложения', en: 'Proposal card', he: 'כרטיס הצעה' })}
              </Text>

              <View style={styles.proposalCardStatic}>
                <View style={[styles.proposalAuthorRow, rtl && styles.rowReverse]}>
                  {usersById.get(selectedProposal.author_id)?.photo_uri ? (
                    <Image
                      source={{ uri: usersById.get(selectedProposal.author_id)?.photo_uri ?? undefined }}
                      style={styles.proposalAvatar}
                    />
                  ) : (
                    <View style={[styles.proposalAvatar, styles.proposalAvatarFallback]}>
                      <Ionicons name="person" size={16} color="#9CA3AF" />
                    </View>
                  )}

                  <View style={styles.proposalAuthorTextWrap}>
                    <Text style={[styles.proposalAuthorName, rtl && styles.textRtl]}>
                      {usersById.get(selectedProposal.author_id)?.name ??
                        t(language, { ru: 'Неизвестный автор', en: 'Unknown author', he: 'מחבר לא ידוע' })}
                    </Text>
                    <Text style={[styles.proposalAuthorRole, rtl && styles.textRtl]}>
                      {usersById.get(selectedProposal.author_id)
                        ? roleNameById((usersById.get(selectedProposal.author_id)?.role_id ?? 3) as RoleId, language)
                        : '-'}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.proposalText, rtl && styles.textRtl]}>{localizedProposalText(selectedProposal)}</Text>

                {rejectReasons[selectedProposal.id] ? (
                  <View style={styles.rejectReasonBox}>
                    <Text style={[styles.rejectReasonLabel, rtl && styles.textRtl]}>
                      {t(language, { ru: 'Причина отклонения', en: 'Rejection reason', he: 'סיבת דחייה' })}
                    </Text>
                    <Text style={[styles.rejectReasonText, rtl && styles.textRtl]}>{rejectReasons[selectedProposal.id]}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.proposalActionsRow}>
                <Pressable
                  style={[styles.actionBtn, styles.approveBtn]}
                  disabled={proposalSavingId === selectedProposal.id}
                  onPress={() => approveProposal(selectedProposal.id)}
                >
                  <Text style={styles.actionBtnText}>
                    {t(language, { ru: 'Одобрить', en: 'Approve', he: 'אשר' })}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, styles.progressBtn]}
                  disabled={proposalSavingId === selectedProposal.id}
                  onPress={() => moveProposalToWork(selectedProposal.id)}
                >
                  <Text style={styles.actionBtnText}>
                    {t(language, { ru: 'В работу', en: 'In progress', he: 'לטיפול' })}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, styles.rejectBtn]}
                  disabled={proposalSavingId === selectedProposal.id}
                  onPress={() => openRejectMode(selectedProposal.id)}
                >
                  <Text style={styles.actionBtnText}>
                    {t(language, { ru: 'Отклонить', en: 'Reject', he: 'דחה' })}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {proposalMode === 'reject' && selectedProposal ? (
            <View style={styles.nestedPanel}>
              {renderBackButton(() => setProposalMode('detail'))}
              <Text style={[styles.nestedTitle, rtl && styles.textRtl]}>
                {t(language, {
                  ru: 'Почему отклоняем предложение?',
                  en: 'Why reject this proposal?',
                  he: 'למה דוחים את ההצעה?',
                })}
              </Text>

              <TextInput
                value={rejectReasonInput}
                onChangeText={setRejectReasonInput}
                multiline
                placeholder={t(language, {
                  ru: isAdministrator ? 'Комментарий администратора' : 'Комментарий директора',
                  en: isAdministrator ? 'Administrator comment' : 'Director comment',
                  he: isAdministrator ? 'הערת מנהל מערכת' : 'הערת מנהל',
                })}
                placeholderTextColor="#94A3B8"
                style={[styles.rejectInput, rtl && styles.textRtl]}
              />

              <Pressable
                style={[styles.actionBtn, styles.rejectBtn, styles.rejectSubmitButton]}
                disabled={proposalSavingId === selectedProposal.id}
                onPress={rejectProposal}
              >
                <Text style={styles.actionBtnText}>
                  {t(language, {
                    ru: 'Отклонить и сохранить причину',
                    en: 'Reject and save reason',
                    he: 'דחה ושמור סיבה',
                  })}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Мониторинг школы: Состояние классов',
              en: 'School Monitoring: Class status',
              he: 'ניטור בית ספר: מצב כיתות',
            })}
          </Text>

          {snapshot.classes.map((entry) => {
            const homeroom = usersById.get(entry.homeroom_teacher_id ?? '');
            return (
              <View key={entry.id} style={[styles.classRow, rtl && styles.rowReverse]}>
                <View style={styles.classDot} />
                <View style={styles.classTextWrap}>
                  <Text style={[styles.className, rtl && styles.textRtl]}>{entry.name}</Text>
                  <Text style={[styles.classMeta, rtl && styles.textRtl]}>
                    {t(language, { ru: 'Класс', en: 'Grade', he: 'כיתה' })}: {entry.grade}
                    {' · '}
                    {homeroom
                      ? `${t(language, {
                          ru: 'Классный руководитель',
                          en: 'Homeroom',
                          he: 'מחנך',
                        })}: ${homeroom.name}`
                      : t(language, {
                          ru: 'Руководитель не назначен',
                          en: 'Homeroom not assigned',
                          he: 'לא הוקצה מחנך',
                        })}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.sectionCard}>
          <View style={[styles.sectionTitleRow, rtl && styles.rowReverse]}>
            <Text style={[styles.sectionTitle, rtl && styles.textRtl]}>
            {t(language, {
              ru: isAdministrator ? 'График администратора' : 'График директора',
              en: isAdministrator ? 'Administrator schedule' : 'Director schedule',
              he: isAdministrator ? 'יומן מנהל מערכת' : 'יומן המנהל',
            })}
          </Text>
            {plannerMode === 'list' ? (
              <Pressable style={styles.addMeetingButton} onPress={openMeetingCreate}>
                <Text style={styles.addMeetingButtonText}>
                  {t(language, { ru: '+ Добавить блок', en: '+ Add block', he: '+ הוסף בלוק' })}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {plannerMode === 'editor' ? (
            <View style={styles.nestedPanel}>
              {renderBackButton(() => {
                setPlannerMode('list');
                resetMeetingForm();
              })}

              <Text style={[styles.nestedTitle, rtl && styles.textRtl]}>
                {editingMeetingId
                  ? t(language, {
                      ru: 'Редактирование встречи',
                      en: 'Edit meeting',
                      he: 'עריכת פגישה',
                    })
                  : t(language, {
                      ru: 'Новая встреча',
                      en: 'New meeting',
                      he: 'פגישה חדשה',
                    })}
              </Text>

              <TextInput
                value={meetingTitle}
                onChangeText={setMeetingTitle}
                placeholder={t(language, {
                  ru: 'Название (например: Приём родителей)',
                  en: 'Title (e.g. Parent meeting)',
                  he: 'כותרת (למשל: קבלת הורים)',
                })}
                placeholderTextColor="#94A3B8"
                style={[styles.meetingInput, rtl && styles.textRtl]}
              />
              <TextInput
                value={meetingDate}
                onChangeText={setMeetingDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#94A3B8"
                style={[styles.meetingInput, rtl && styles.textRtl]}
              />
              <View style={[styles.timeRow, rtl && styles.rowReverse]}>
                <TextInput
                  value={meetingStart}
                  onChangeText={setMeetingStart}
                  placeholder="10:00"
                  placeholderTextColor="#94A3B8"
                  style={[styles.meetingInput, styles.timeInput, rtl && styles.textRtl]}
                />
                <Text style={styles.timeDivider}>—</Text>
                <TextInput
                  value={meetingEnd}
                  onChangeText={setMeetingEnd}
                  placeholder="11:00"
                  placeholderTextColor="#94A3B8"
                  style={[styles.meetingInput, styles.timeInput, rtl && styles.textRtl]}
                />
              </View>

              <Pressable style={[styles.actionBtn, styles.progressBtn, styles.rejectSubmitButton]} onPress={saveMeeting}>
                <Text style={styles.actionBtnText}>
                  {editingMeetingId
                    ? t(language, {
                        ru: 'Перенести / сохранить',
                        en: 'Reschedule / save',
                        he: 'העבר / שמור',
                      })
                    : t(language, {
                        ru: 'Добавить в график',
                        en: 'Add to schedule',
                        he: 'הוסף ליומן',
                      })}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {plannerMode === 'list'
            ? meetings.map((meeting) => (
                <Pressable
                  key={meeting.id}
                  onPress={() => openMeetingEdit(meeting)}
                  style={[styles.meetingCard, meeting.status === 'canceled' && styles.meetingCardCanceled]}
                >
                  <View style={[styles.meetingRowTop, rtl && styles.rowReverse]}>
                    <Text style={[styles.meetingTitle, rtl && styles.textRtl]}>{meeting.title}</Text>
                    <View
                      style={[
                        styles.meetingBadge,
                        meeting.status === 'planned' ? styles.meetingBadgePlanned : styles.meetingBadgeCanceled,
                      ]}
                    >
                      <Text
                        style={[
                          styles.meetingBadgeText,
                          meeting.status === 'planned'
                            ? styles.meetingBadgeTextPlanned
                            : styles.meetingBadgeTextCanceled,
                        ]}
                      >
                        {meeting.status === 'planned'
                          ? t(language, { ru: 'Активно', en: 'Active', he: 'פעיל' })
                          : t(language, { ru: 'Отменено', en: 'Canceled', he: 'בוטל' })}
                      </Text>
                    </View>
                  </View>

                  <Text style={[styles.meetingMeta, rtl && styles.textRtl]}>
                    {formatDate(`${meeting.date}T10:00:00.000Z`, language)} · {meeting.start} - {meeting.end}
                  </Text>

                  <View style={[styles.meetingActionsRow, rtl && styles.rowReverse]}>
                    <Pressable
                      style={[styles.inlineMeetingButton, styles.rescheduleButton]}
                      onPress={(event) => {
                        event.stopPropagation();
                        openMeetingEdit(meeting);
                      }}
                    >
                      <Text style={styles.inlineMeetingButtonText}>
                        {t(language, { ru: 'Перенести', en: 'Reschedule', he: 'העבר' })}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={[styles.inlineMeetingButton, styles.cancelButton]}
                      onPress={(event) => {
                        event.stopPropagation();
                        cancelMeeting(meeting.id);
                      }}
                    >
                      <Text style={styles.inlineMeetingButtonText}>
                        {t(language, { ru: 'Отменить', en: 'Cancel', he: 'בטל' })}
                      </Text>
                    </Pressable>
                  </View>
                </Pressable>
              ))
            : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#EEF2FF',
  },
  content: {
    paddingBottom: 36,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  pressedScale: {
    transform: [{ scale: 0.97 }],
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },

  headerGradient: {
    marginHorizontal: 12,
    marginTop: 10,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  profileBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  profileTextWrap: {
    flex: 1,
  },
  avatar: {
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: '#312E81',
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerName: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  headerRole: {
    color: '#FDE68A',
    fontSize: 13,
    fontWeight: '700',
  },
  headerTime: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    marginTop: 4,
  },
  alertBellButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF4444',
  },
  alertBadgeText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 10,
  },
  headerActions: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerActionButton: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  headerActionText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  headerLogoutButton: {
    backgroundColor: 'rgba(127, 29, 29, 0.45)',
    borderColor: 'rgba(254, 202, 202, 0.38)',
  },

  metricRow: {
    marginTop: 12,
    marginHorizontal: 12,
    flexDirection: 'row',
    gap: 8,
  },
  metricCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 108,
  },
  metricIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  metricValue: {
    color: '#0F172A',
    fontWeight: '900',
    fontSize: 22,
  },
  metricLabel: {
    marginTop: 4,
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },

  sectionCard: {
    marginTop: 12,
    marginHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    gap: 10,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    color: '#0F172A',
    fontWeight: '900',
    fontSize: 16,
    flex: 1,
  },
  sectionSubtitle: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
  },
  emptyStateText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },

  applicationCard: {
    borderRadius: 18,
    overflow: 'hidden',
  },
  applicationCardGradient: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  applicationTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  applicationTypeBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  applicationTypeBadgeText: {
    color: '#F8FAFC',
    fontWeight: '800',
    fontSize: 11,
  },
  applicationMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  applicationAvatar: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  applicationAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  applicationMainText: {
    flex: 1,
    gap: 3,
  },
  applicationName: {
    color: '#F8FAFC',
    fontWeight: '900',
    fontSize: 16,
  },
  applicationMeta: {
    color: 'rgba(241, 245, 249, 0.85)',
    fontWeight: '600',
    fontSize: 12,
  },
  applicationActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  applicationDocsButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.34)',
    backgroundColor: 'rgba(255,255,255,0.09)',
    paddingVertical: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applicationDocsButtonText: {
    color: '#E2E8F0',
    fontWeight: '700',
    fontSize: 12,
  },
  applicationPrimaryAction: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  applicationPrimaryActionText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12,
  },
  applicationSecondaryAction: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.34)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  applicationSecondaryActionText: {
    color: '#F1F5F9',
    fontWeight: '800',
    fontSize: 12,
  },
  applicationDangerAction: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.7)',
    backgroundColor: 'rgba(220, 38, 38, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  applicationDangerActionText: {
    color: '#FCA5A5',
    fontWeight: '800',
    fontSize: 12,
  },
  actionDisabled: {
    opacity: 0.46,
  },

  proposalCard: {
    borderWidth: 1,
    borderColor: '#DCE4F2',
    backgroundColor: '#F8FAFF',
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  proposalCardStatic: {
    borderWidth: 1,
    borderColor: '#DCE4F2',
    backgroundColor: '#F8FAFF',
    borderRadius: 12,
    padding: 10,
    gap: 8,
  },
  proposalAuthorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  proposalAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#E5E7EB',
  },
  proposalAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  proposalAuthorTextWrap: {
    flex: 1,
  },
  proposalAuthorName: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 13,
  },
  proposalAuthorRole: {
    color: '#64748B',
    fontWeight: '600',
    fontSize: 12,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  proposalText: {
    color: '#1E293B',
    fontSize: 14,
    fontWeight: '600',
  },

  nestedPanel: {
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingTop: 8,
    gap: 10,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    backgroundColor: '#EEF2FF',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 2,
  },
  backButtonText: {
    color: '#4338CA',
    fontWeight: '800',
    fontSize: 12,
  },
  nestedTitle: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 15,
  },

  proposalActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  approveBtn: {
    backgroundColor: '#16A34A',
  },
  progressBtn: {
    backgroundColor: '#2563EB',
  },
  rejectBtn: {
    backgroundColor: '#DC2626',
  },
  rejectInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    minHeight: 90,
    textAlignVertical: 'top',
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#0F172A',
    fontWeight: '500',
  },
  rejectSubmitButton: {
    alignSelf: 'stretch',
  },
  rejectReasonBox: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    padding: 8,
    gap: 4,
  },
  rejectReasonLabel: {
    color: '#B91C1C',
    fontWeight: '800',
    fontSize: 12,
  },
  rejectReasonText: {
    color: '#7F1D1D',
    fontWeight: '600',
    fontSize: 13,
  },

  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    backgroundColor: '#F8FAFF',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  classDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22C55E',
  },
  classTextWrap: {
    flex: 1,
  },
  className: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 14,
  },
  classMeta: {
    marginTop: 2,
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },

  addMeetingButton: {
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  addMeetingButtonText: {
    color: '#3730A3',
    fontWeight: '800',
    fontSize: 12,
  },
  meetingInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: '#0F172A',
    fontWeight: '600',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeInput: {
    flex: 1,
  },
  timeDivider: {
    color: '#64748B',
    fontWeight: '700',
  },

  meetingCard: {
    borderWidth: 1,
    borderColor: '#DCE4F2',
    borderRadius: 12,
    padding: 10,
    gap: 8,
    backgroundColor: '#F8FAFF',
  },
  meetingCardCanceled: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  meetingRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  meetingTitle: {
    flex: 1,
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 14,
  },
  meetingMeta: {
    color: '#475569',
    fontWeight: '600',
    fontSize: 12,
  },
  meetingBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  meetingBadgePlanned: {
    backgroundColor: 'rgba(37, 99, 235, 0.16)',
  },
  meetingBadgeCanceled: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  meetingBadgeText: {
    fontWeight: '800',
    fontSize: 11,
  },
  meetingBadgeTextPlanned: {
    color: '#1D4ED8',
  },
  meetingBadgeTextCanceled: {
    color: '#B91C1C',
  },
  meetingActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  inlineMeetingButton: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inlineMeetingButtonText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
  },
  rescheduleButton: {
    backgroundColor: '#2563EB',
  },
  cancelButton: {
    backgroundColor: '#DC2626',
  },
});
