import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Keyboard,
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
import { BirthdaySettingsCard } from '../components/BirthdaySettingsCard';
import { ThreadChat } from '../components/ThreadChat';
import { isRtlLanguage, localizeLessonSubject, t } from '../lib/i18n';
import { childUsers, threadTitle } from '../lib/selectors';
import { formatDate, formatTime, toJerusalemDateInput } from '../lib/time';
import { ensureTranslationMap, getLocalizedText } from '../lib/translation';
import { AppLanguage, DatabaseSnapshot, Homework, Thread, User } from '../types/models';

type ParentTab = 'dashboard' | 'homework' | 'messages' | 'absence' | 'profile';

const PARENT_TABS: Array<{
  key: ParentTab;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { key: 'dashboard', icon: 'home-outline' },
  { key: 'homework', icon: 'checkbox-outline' },
  { key: 'messages', icon: 'chatbubble-ellipses-outline' },
  { key: 'absence', icon: 'medical-outline' },
  { key: 'profile', icon: 'person-outline' },
];

const CHILD_LANGUAGE_OPTIONS: Array<{ value: AppLanguage; label: string }> = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
  { value: 'he', label: 'עברית' },
];

function parentTabLabel(tab: ParentTab, language: User['preferred_language']): string {
  if (tab === 'dashboard') {
    return t(language, { ru: 'Главная', en: 'Home', he: 'ראשי' });
  }
  if (tab === 'homework') {
    return t(language, { ru: 'Задания', en: 'Homework', he: 'שיעורי בית' });
  }
  if (tab === 'messages') {
    return t(language, { ru: 'Чат', en: 'Chat', he: 'צ׳אט' });
  }
  if (tab === 'absence') {
    return t(language, { ru: 'Отсутствие', en: 'Absence', he: 'היעדרות' });
  }
  return t(language, { ru: 'Профиль', en: 'Profile', he: 'פרופיל' });
}

function dateInputLabel(dateInput: string): string {
  const match = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return dateInput;
  }
  return `${match[3]}.${match[2]}`;
}

function homeworkBodyText(text: string): string {
  return text
    .replace(/Дано:\s*\d{2}\.\d{2}\s*/gi, '')
    .replace(/(?:Срок сдачи|Сдать до):\s*\d{2}\.\d{2}\s*/gi, '')
    .trim();
}

function classLabel(
  snapshot: DatabaseSnapshot,
  student: User | undefined,
  language: User['preferred_language'],
): string {
  const classId = student?.class_ids[0];
  if (!classId) {
    return '—';
  }
  const classModel = snapshot.classes.find((entry) => entry.id === classId);
  if (!classModel) {
    return classId;
  }
  return classModel.name_i18n?.[language] ?? classModel.name;
}

function staffRoleLabel(roleId: User['role_id'], language: User['preferred_language']): string {
  if (roleId === 1) {
    return t(language, { ru: 'Дирекция', en: 'Directorate', he: 'הנהלה' });
  }
  if (roleId === 7) {
    return t(language, { ru: 'Администратор', en: 'Administrator', he: 'אדמין' });
  }
  if (roleId === 3) {
    return t(language, { ru: 'Учитель', en: 'Teacher', he: 'מורה' });
  }
  return t(language, { ru: 'Персонал', en: 'Staff', he: 'Staff' });
}

function userInitials(name: string, fallback = 'P'): string {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .map((entry) => entry[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return initials || fallback;
}

export function ParentScreen({
  user,
  snapshot,
  showOriginal,
  onToggleOriginal: _onToggleOriginal,
  onRefresh: _onRefresh,
  onLogout,
  onSendAbsence,
  onSendMessage,
  onMarkRead,
  onSetParentHomeworkChecked,
  onRequestParentStudentRelation,
  onUpdateChildProfile,
  onUpdateProfilePhoto,
  onUpdateBirthdaySettings,
}: {
  user: User;
  snapshot: DatabaseSnapshot;
  showOriginal: boolean;
  onToggleOriginal: () => void;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
  onSendAbsence: (params: { studentId: string; lessonId: string; note: string }) => Promise<void>;
  onSendMessage: (params: { threadId: string; text: string; attachments: string[] }) => Promise<void>;
  onMarkRead: (threadId: string) => Promise<void>;
  onSetParentHomeworkChecked: (params: {
    homeworkId: string;
    studentId: string;
    checked: boolean;
  }) => Promise<void>;
  onRequestParentStudentRelation: (params: { studentId: string }) => Promise<void>;
  onUpdateChildProfile: (params: {
    childId: string;
    phone?: string | null;
    knownLanguages?: AppLanguage[];
  }) => Promise<void>;
  onUpdateProfilePhoto: (photoUri: string | null) => Promise<void>;
  onUpdateBirthdaySettings: (params: { dob: string; showInCalendar: boolean }) => Promise<void>;
}) {
  const language = user.preferred_language;
  const rtl = isRtlLanguage(language);

  const [tab, setTab] = useState<ParentTab>('dashboard');
  const [selectedChildId, setSelectedChildId] = useState('');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedAbsenceLessonId, setSelectedAbsenceLessonId] = useState('');
  const [absenceNote, setAbsenceNote] = useState('');
  const [addChildVisible, setAddChildVisible] = useState(false);
  const [childSearch, setChildSearch] = useState('');
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [childProfileDrafts, setChildProfileDrafts] = useState<
    Record<string, { phone: string; knownLanguages: AppLanguage[] }>
  >({});
  const [savingChildProfileIds, setSavingChildProfileIds] = useState<string[]>([]);

  const children = useMemo(() => childUsers(user, snapshot), [snapshot, user]);

  useEffect(() => {
    if (children.length === 0) {
      setSelectedChildId('');
      return;
    }
    if (!children.some((entry) => entry.id === selectedChildId)) {
      setSelectedChildId(children[0].id);
    }
  }, [children, selectedChildId]);

  const selectedChild = useMemo(
    () => children.find((entry) => entry.id === selectedChildId),
    [children, selectedChildId],
  );

  useEffect(() => {
    setChildProfileDrafts((current) => {
      const next: Record<string, { phone: string; knownLanguages: AppLanguage[] }> = {};
      children.forEach((child) => {
        const existing = current[child.id];
        if (existing) {
          next[child.id] = existing;
          return;
        }
        const knownLanguages =
          child.known_languages && child.known_languages.length > 0
            ? [...child.known_languages]
            : [child.preferred_language];
        next[child.id] = {
          phone: child.phone ?? '',
          knownLanguages,
        };
      });
      return next;
    });
  }, [children]);

  const childClassIds = selectedChild?.class_ids ?? [];

  const lessons = useMemo(
    () => snapshot.lessons.filter((lesson) => childClassIds.includes(lesson.class_id)),
    [snapshot.lessons, childClassIds],
  );

  const lessonsById = useMemo(() => new Map(lessons.map((entry) => [entry.id, entry])), [lessons]);

  const homework = useMemo(
    () => snapshot.homework.filter((entry) => childClassIds.includes(entry.class_id)),
    [snapshot.homework, childClassIds],
  );

  const sortedHomework = useMemo(
    () =>
      homework
        .slice()
        .sort(
          (left, right) =>
            left.due_date.localeCompare(right.due_date) ||
            new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
        ),
    [homework],
  );

  const pendingHomeworkChecks = useMemo(
    () => sortedHomework.filter((entry) => !entry.parent_confirmed_ids.includes(user.id)).length,
    [sortedHomework, user.id],
  );

  const parentThreads = useMemo(
    () => snapshot.threads.filter((thread) => thread.participants.includes(user.id)),
    [snapshot.threads, user.id],
  );

  useEffect(() => {
    if (parentThreads.length === 0) {
      setSelectedThreadId(null);
      return;
    }
    if (!selectedThreadId || !parentThreads.some((entry) => entry.id === selectedThreadId)) {
      setSelectedThreadId(parentThreads[0].id);
    }
  }, [parentThreads, selectedThreadId]);

  const selectedThread: Thread | undefined = useMemo(
    () => parentThreads.find((entry) => entry.id === selectedThreadId),
    [parentThreads, selectedThreadId],
  );

  const todayDateInput = useMemo(() => toJerusalemDateInput(new Date().toISOString()), []);

  const todayLessons = useMemo(
    () =>
      lessons
        .filter(
          (lesson) =>
            lesson.status !== 'canceled' && toJerusalemDateInput(lesson.start_datetime) === todayDateInput,
        )
        .sort(
          (left, right) => new Date(left.start_datetime).getTime() - new Date(right.start_datetime).getTime(),
        ),
    [lessons, todayDateInput],
  );

  const activeLesson = useMemo(() => {
    const now = Date.now();
    return (
      todayLessons.find((lesson) => {
        const start = new Date(lesson.start_datetime).getTime();
        const end = new Date(lesson.end_datetime).getTime();
        return now >= start && now <= end;
      }) ?? null
    );
  }, [todayLessons]);

  const attendanceByLessonId = useMemo(() => {
    const result = new Map<string, boolean>();
    snapshot.student_lesson_records
      .filter((record) => record.student_id === selectedChildId)
      .forEach((record) => {
        result.set(record.lesson_id, !record.absent);
      });
    return result;
  }, [snapshot.student_lesson_records, selectedChildId]);

  useEffect(() => {
    if (lessons.length === 0) {
      setSelectedAbsenceLessonId('');
      return;
    }
    if (!selectedAbsenceLessonId || !lessons.some((lesson) => lesson.id === selectedAbsenceLessonId)) {
      setSelectedAbsenceLessonId(lessons[0].id);
    }
  }, [lessons, selectedAbsenceLessonId]);

  const relationRequests = useMemo(
    () =>
      snapshot.parent_student_relations
        .filter((entry) => entry.parent_id === user.id)
        .slice()
        .sort((left, right) => right.created_at.localeCompare(left.created_at)),
    [snapshot.parent_student_relations, user.id],
  );

  const staffCategories = useMemo(
    () => ({
      management: snapshot.users.filter((entry) => entry.is_active && (entry.role_id === 1 || entry.role_id === 7)),
      teachers: snapshot.users.filter((entry) => entry.is_active && entry.role_id === 3),
      staff: snapshot.users.filter((entry) => entry.is_active && entry.role_id === 6),
    }),
    [snapshot.users],
  );

  const selectedStaff = useMemo(
    () => snapshot.users.find((entry) => entry.id === selectedStaffId) ?? null,
    [snapshot.users, selectedStaffId],
  );

  const pendingRelationRequests = useMemo(
    () => relationRequests.filter((entry) => entry.status === 'pending'),
    [relationRequests],
  );

  const pendingStudentIdSet = useMemo(
    () => new Set(pendingRelationRequests.map((entry) => entry.student_id)),
    [pendingRelationRequests],
  );

  const availableStudents = useMemo(
    () =>
      snapshot.users.filter(
        (entry) =>
          entry.role_id === 5 &&
          entry.is_active &&
          !user.child_ids.includes(entry.id) &&
          !pendingStudentIdSet.has(entry.id),
      ),
    [snapshot.users, user.child_ids, pendingStudentIdSet],
  );

  const filteredCandidates = useMemo(() => {
    const query = childSearch.trim().toLowerCase();
    if (!query) {
      return availableStudents;
    }
    return availableStudents.filter((entry) => {
      const candidateClass = classLabel(snapshot, entry, language).toLowerCase();
      return entry.name.toLowerCase().includes(query) || candidateClass.includes(query);
    });
  }, [availableStudents, childSearch, snapshot]);

  useEffect(() => {
    if (filteredCandidates.length === 0) {
      setSelectedCandidateId('');
      return;
    }
    if (!filteredCandidates.some((entry) => entry.id === selectedCandidateId)) {
      setSelectedCandidateId(filteredCandidates[0].id);
    }
  }, [filteredCandidates, selectedCandidateId]);

  const selectedCandidate = useMemo(
    () => availableStudents.find((entry) => entry.id === selectedCandidateId),
    [availableStudents, selectedCandidateId],
  );

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const openAddChildSheet = () => {
    setAddChildVisible(true);
    setChildSearch('');
  };

  const closeAddChildSheet = () => {
    setAddChildVisible(false);
    setChildSearch('');
  };

  const submitRelationRequest = async () => {
    if (!selectedCandidate) {
      return;
    }
    try {
      await onRequestParentStudentRelation({ studentId: selectedCandidate.id });
      Alert.alert(
        t(language, { ru: 'Запрос отправлен', en: 'Request sent', he: 'הבקשה נשלחה' }),
        t(language, {
          ru: 'Статус: Ожидает подтверждения админом.',
          en: 'Status: waiting for admin confirmation.',
          he: 'סטטוס: ממתין לאישור אדמין.',
        }),
      );
      closeAddChildSheet();
      setTab('profile');
    } catch (error) {
      Alert.alert(
        t(language, { ru: 'Не удалось отправить', en: 'Failed to submit', he: 'שליחה נכשלה' }),
        (error as Error).message,
      );
    }
  };

  const pickImage = async (): Promise<string | null> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        t(language, { ru: 'Нет доступа к галерее', en: 'No gallery access', he: 'אין גישה לגלריה' }),
      );
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
    });
    if (result.canceled || !result.assets[0]) {
      return null;
    }
    return result.assets[0].uri;
  };

  const takeImage = async (): Promise<string | null> => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        t(language, { ru: 'Нет доступа к камере', en: 'No camera access', he: 'אין גישה למצלמה' }),
      );
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
    });
    if (result.canceled || !result.assets[0]) {
      return null;
    }
    return result.assets[0].uri;
  };

  const updateParentPhoto = async (mode: 'gallery' | 'camera') => {
    const uri = mode === 'camera' ? await takeImage() : await pickImage();
    if (!uri) {
      return;
    }
    await onUpdateProfilePhoto(uri);
  };

  const submitAbsence = async () => {
    if (!selectedChild || !selectedAbsenceLessonId || !absenceNote.trim()) {
      return;
    }
    await onSendAbsence({
      studentId: selectedChild.id,
      lessonId: selectedAbsenceLessonId,
      note: absenceNote.trim(),
    });
    setAbsenceNote('');
    Alert.alert(
      t(language, { ru: 'Отправлено', en: 'Sent', he: 'נשלח' }),
      t(language, {
        ru: 'Уведомление об отсутствии отправлено в школу.',
        en: 'Absence notice has been sent to school.',
        he: 'הודעת היעדרות נשלחה לבית הספר.',
      }),
    );
  };

  const toggleParentHomeworkCheck = async (item: Homework) => {
    if (!selectedChild) {
      return;
    }
    const checked = item.parent_confirmed_ids.includes(user.id);
    try {
      await onSetParentHomeworkChecked({
        homeworkId: item.id,
        studentId: selectedChild.id,
        checked: !checked,
      });
    } catch (error) {
      Alert.alert(
        t(language, { ru: 'Ошибка', en: 'Error', he: 'שגיאה' }),
        (error as Error).message,
      );
    }
  };

  const updateChildPhoneDraft = (childId: string, phone: string) => {
    setChildProfileDrafts((current) => {
      const existing = current[childId] ?? { phone: '', knownLanguages: ['ru' as AppLanguage] };
      return {
        ...current,
        [childId]: {
          ...existing,
          phone,
        },
      };
    });
  };

  const toggleChildKnownLanguage = (childId: string, languageCode: AppLanguage) => {
    setChildProfileDrafts((current) => {
      const existing = current[childId] ?? { phone: '', knownLanguages: ['ru' as AppLanguage] };
      const hasLanguage = existing.knownLanguages.includes(languageCode);
      const nextKnownLanguages = hasLanguage
        ? existing.knownLanguages.length > 1
          ? existing.knownLanguages.filter((entry) => entry !== languageCode)
          : existing.knownLanguages
        : [...existing.knownLanguages, languageCode];

      return {
        ...current,
        [childId]: {
          ...existing,
          knownLanguages: nextKnownLanguages,
        },
      };
    });
  };

  const saveChildProfile = async (child: User) => {
    const draft = childProfileDrafts[child.id];
    if (!draft) {
      return;
    }

    setSavingChildProfileIds((current) =>
      current.includes(child.id) ? current : [...current, child.id],
    );

    try {
      await onUpdateChildProfile({
        childId: child.id,
        phone: draft.phone.trim() ? draft.phone.trim() : null,
        knownLanguages: draft.knownLanguages,
      });
      Alert.alert(
        t(language, { ru: 'Сохранено', en: 'Saved', he: 'נשמר' }),
        t(language, {
          ru: 'Данные ребёнка обновлены.',
          en: 'Child profile updated.',
          he: 'נתוני הילד עודכנו.',
        }),
      );
    } catch (error) {
      Alert.alert(
        t(language, { ru: 'Ошибка', en: 'Error', he: 'שגיאה' }),
        (error as Error).message,
      );
    } finally {
      setSavingChildProfileIds((current) => current.filter((entry) => entry !== child.id));
    }
  };

  const childClassName = classLabel(snapshot, selectedChild, language);

  const locationStatusText = activeLesson
    ? t(language, { ru: 'В школе', en: 'At school', he: 'בבית הספר' })
    : t(language, { ru: 'Дома', en: 'At home', he: 'בבית' });

  const homeworkStatusText =
    pendingHomeworkChecks > 0
      ? t(language, {
          ru: `Есть ${pendingHomeworkChecks} задание`,
          en: `${pendingHomeworkChecks} to check`,
          he: `${pendingHomeworkChecks} לבדיקה`,
        })
      : t(language, { ru: 'Нет новых', en: 'No pending', he: 'אין חדש' });

  return (
    <KeyboardAvoidingView
      style={[styles.root, rtl && styles.rootRtl]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <LinearGradient colors={['#fefefe', '#eef4ff']} style={styles.header}>
        <View style={[styles.headerTopRow, rtl && styles.rowReverse]}>
          <View style={styles.headerIdentity}>
            <Text style={[styles.headerName, rtl && styles.textRtl]}>{user.name}</Text>
            <Text style={[styles.headerRole, rtl && styles.textRtl]}>
              {t(language, { ru: 'Родитель', en: 'Parent', he: 'הורה' })}
            </Text>
          </View>
          <Pressable style={styles.headerIconButton} onPress={onLogout}>
            <Ionicons name="log-out-outline" size={18} color="#0f172a" />
          </Pressable>
        </View>

        <View style={styles.childrenStrip}>
          <Text style={[styles.childrenStripTitle, rtl && styles.textRtl]}>
            {t(language, { ru: 'Мои дети', en: 'My children', he: 'הילדים שלי' })}
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.childrenCarousel, rtl && styles.childrenCarouselRtl]}
          >
            {children.map((child) => {
              const active = selectedChildId === child.id;
              return (
                <Pressable
                  key={child.id}
                  style={styles.childAvatarItem}
                  onPress={() => setSelectedChildId(child.id)}
                >
                  <View style={[styles.childAvatarRing, active && styles.childAvatarRingActive]}>
                    {child.photo_uri ? (
                      <Image source={{ uri: child.photo_uri }} style={styles.childAvatarImage} />
                    ) : (
                      <View style={styles.childAvatarFallback}>
                        <Text style={styles.childAvatarFallbackText}>{userInitials(child.name, 'S')}</Text>
                      </View>
                    )}
                  </View>
                  <Text
                    style={[
                      styles.childAvatarName,
                      active && styles.childAvatarNameActive,
                      rtl && styles.textRtl,
                    ]}
                    numberOfLines={1}
                  >
                    {child.name.split(' ')[0]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </LinearGradient>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
      >
        {tab === 'dashboard' ? (
          <>
            <View style={styles.dashboardCard}>
              {selectedChild ? (
                <>
                  <View style={[styles.dashboardHero, rtl && styles.rowReverse]}>
                    <View
                      style={[
                        styles.dashboardChildPhotoRing,
                        activeLesson
                          ? styles.dashboardChildPhotoRingOnline
                          : styles.dashboardChildPhotoRingOffline,
                      ]}
                    >
                      {selectedChild.photo_uri ? (
                        <Image source={{ uri: selectedChild.photo_uri }} style={styles.dashboardChildPhoto} />
                      ) : (
                        <View style={styles.dashboardChildPhotoFallback}>
                          <Text style={styles.dashboardChildPhotoFallbackText}>
                            {userInitials(selectedChild.name, 'S')}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.dashboardChildMeta}>
                      <Text style={[styles.dashboardChildName, rtl && styles.textRtl]}>{selectedChild.name}</Text>
                      <Text style={[styles.dashboardChildClass, rtl && styles.textRtl]}>
                        {t(language, { ru: 'Класс', en: 'Class', he: 'כיתה' })}: {childClassName}
                      </Text>
                    </View>
                  </View>

                  <View style={[styles.metricsRow, rtl && styles.rowReverse]}>
                    <View style={[styles.metricCard, activeLesson ? styles.metricGreen : styles.metricRed]}>
                      <Text style={[styles.metricLabel, rtl && styles.textRtl]}>
                        {t(language, { ru: 'Где ребёнок', en: 'Where is child', he: 'איפה הילד' })}
                      </Text>
                      <Text style={[styles.metricValue, rtl && styles.textRtl]}>{locationStatusText}</Text>
                    </View>
                    <Pressable style={[styles.metricCard, styles.metricBlue]} onPress={() => setTab('homework')}>
                      <Text style={[styles.metricLabel, styles.metricLabelLight, rtl && styles.textRtl]}>
                        {t(language, { ru: 'ДЗ на проверку', en: 'Homework', he: 'שיעורי בית' })}
                      </Text>
                      <Text style={[styles.metricValueLight, rtl && styles.textRtl]}>{homeworkStatusText}</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Text style={[styles.emptyText, rtl && styles.textRtl]}>
                  {t(language, {
                    ru: 'Добавьте ребёнка, чтобы увидеть дашборд.',
                    en: 'Add a child to see dashboard.',
                    he: 'הוסף ילד כדי לראות את הדשבורד.',
                  })}
                </Text>
              )}
            </View>

            <View style={styles.panelCard}>
              <Text style={[styles.panelTitle, rtl && styles.textRtl]}>
                {t(language, { ru: 'Уроки на сегодня', en: 'Lessons today', he: 'שיעורים להיום' })}
              </Text>
              {todayLessons.length === 0 ? (
                <Text style={[styles.emptyText, rtl && styles.textRtl]}>
                  {t(language, { ru: 'Сегодня уроков нет', en: 'No lessons today', he: 'אין שיעורים היום' })}
                </Text>
              ) : (
                <View style={styles.lessonsList}>
                  {todayLessons.map((lesson, index) => {
                    const present = attendanceByLessonId.get(lesson.id) ?? true;
                    return (
                      <View key={lesson.id} style={[styles.lessonRow, rtl && styles.rowReverse]}>
                        <View style={styles.lessonNumber}>
                          <Text style={styles.lessonNumberText}>{index + 1}</Text>
                        </View>
                        <View style={styles.lessonInfo}>
                          <Text style={[styles.lessonSubject, rtl && styles.textRtl]}>
                            {localizeLessonSubject(lesson.subject, language)}
                          </Text>
                          <Text style={[styles.lessonTime, rtl && styles.textRtl]}>
                            {formatTime(lesson.start_datetime, language)}-{formatTime(lesson.end_datetime, language)}
                          </Text>
                        </View>
                        <Text style={styles.attendanceIcon}>{present ? '✅' : '❌'}</Text>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        ) : null}

        {tab === 'homework' ? (
          <View style={styles.panelCard}>
            <Text style={[styles.panelTitle, rtl && styles.textRtl]}>
              {t(language, { ru: 'Задания', en: 'Homework', he: 'שיעורי בית' })}
            </Text>

            {sortedHomework.length === 0 ? (
              <Text style={[styles.emptyText, rtl && styles.textRtl]}>
                {t(language, { ru: 'Домашних заданий пока нет', en: 'No homework yet', he: 'אין שיעורי בית' })}
              </Text>
            ) : (
              <View style={styles.homeworkList}>
                {sortedHomework.map((item) => {
                  const lesson = lessonsById.get(item.lesson_id);
                  const studentDone =
                    Boolean(selectedChildId) && item.student_confirmed_ids.includes(selectedChildId);
                  const parentChecked = item.parent_confirmed_ids.includes(user.id);
                  const textOriginal = item.text_original ?? item.text;
                  const localizedText = getLocalizedText(
                    textOriginal,
                    ensureTranslationMap(textOriginal, item.lang_original, item.translations),
                    language,
                    showOriginal,
                  );

                  return (
                    <View key={item.id} style={styles.homeworkCard}>
                      <Text style={[styles.homeworkText, rtl && styles.textRtl]}>
                        {homeworkBodyText(localizedText) || localizedText}
                      </Text>
                      <Text style={[styles.homeworkMeta, rtl && styles.textRtl]}>
                        {lesson
                          ? `${localizeLessonSubject(lesson.subject, language)} · ${formatDate(
                              lesson.start_datetime,
                              language,
                            )}`
                          : t(language, { ru: 'Неизвестный урок', en: 'Unknown lesson', he: 'שיעור לא ידוע' })}
                      </Text>
                      <Text style={[styles.homeworkDates, rtl && styles.textRtl]}>
                        {t(language, { ru: 'Дано', en: 'Given', he: 'ניתן' })}: {dateInputLabel(item.assigned_date)} |{' '}
                        {t(language, { ru: 'Сдать до', en: 'Due', he: 'להגיש עד' })}: {dateInputLabel(item.due_date)}
                      </Text>

                      <View style={[styles.checkRow, rtl && styles.rowReverse]}>
                        <View
                          style={[
                            styles.checkBox,
                            studentDone ? styles.checkBoxStudentDone : styles.checkBoxIdle,
                          ]}
                        >
                          {studentDone ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                        </View>
                        <Text style={[styles.checkText, rtl && styles.textRtl]}>
                          {t(language, {
                            ru: 'Ученик: Я выполнил',
                            en: 'Student: I have done',
                            he: 'תלמיד: ביצעתי',
                          })}
                        </Text>
                      </View>

                      <Pressable style={[styles.checkRow, rtl && styles.rowReverse]} onPress={() => void toggleParentHomeworkCheck(item)}>
                        <View
                          style={[
                            styles.checkBox,
                            parentChecked ? styles.checkBoxParentDone : styles.checkBoxIdle,
                          ]}
                        >
                          {parentChecked ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                        </View>
                        <Text style={[styles.checkText, rtl && styles.textRtl]}>
                          {t(language, {
                            ru: 'Родитель: Я проверил',
                            en: 'Parent: I checked',
                            he: 'הורה: בדקתי',
                          })}
                        </Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}

        {tab === 'messages' ? (
          <>
            <View style={styles.panelCard}>
              <Text style={[styles.panelTitle, rtl && styles.textRtl]}>
                {t(language, { ru: 'Чаты', en: 'Chats', he: 'צ׳אטים' })}
              </Text>
              {parentThreads.length === 0 ? (
                <Text style={[styles.emptyText, rtl && styles.textRtl]}>
                  {t(language, { ru: 'Нет доступных чатов', en: 'No available chats', he: 'אין צ׳אטים זמינים' })}
                </Text>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={[styles.threadTabs, rtl && styles.threadTabsRtl]}
                >
                  {parentThreads.map((thread) => {
                    const active = selectedThreadId === thread.id;
                    return (
                      <Pressable
                        key={thread.id}
                        style={[styles.threadTab, active && styles.threadTabActive]}
                        onPress={() => {
                          setSelectedThreadId(thread.id);
                          void onMarkRead(thread.id);
                        }}
                      >
                        <Text
                          style={[
                            styles.threadTabText,
                            active && styles.threadTabTextActive,
                            rtl && styles.textRtl,
                          ]}
                        >
                          {threadTitle(thread, snapshot, language)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </View>

            {selectedThread ? (
              <View style={styles.panelCard}>
                <Text style={[styles.panelTitle, rtl && styles.textRtl]}>
                  {threadTitle(selectedThread, snapshot, language)}
                </Text>
                <ThreadChat
                  thread={selectedThread}
                  messages={snapshot.messages}
                  users={snapshot.users}
                  currentUser={user}
                  userLanguage={language}
                  showOriginal={showOriginal}
                  allowSend
                  keyboardAvoidingEnabled={false}
                  onAttach={pickImage}
                  onSend={(text, attachments) =>
                    onSendMessage({
                      threadId: selectedThread.id,
                      text,
                      attachments,
                    })
                  }
                />
              </View>
            ) : null}
          </>
        ) : null}

        {tab === 'absence' ? (
          <View style={styles.panelCard}>
            <Text style={[styles.panelTitle, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Уведомление об отсутствии',
                en: 'Absence notice',
                he: 'דיווח היעדרות',
              })}
            </Text>

            {lessons.length === 0 ? (
              <Text style={[styles.emptyText, rtl && styles.textRtl]}>
                {t(language, { ru: 'Нет уроков для выбора', en: 'No lessons to choose', he: 'אין שיעורים לבחירה' })}
              </Text>
            ) : (
              <View style={styles.lessonPickList}>
                {lessons.map((lesson) => {
                  const active = selectedAbsenceLessonId === lesson.id;
                  return (
                    <Pressable
                      key={lesson.id}
                      onPress={() => setSelectedAbsenceLessonId(lesson.id)}
                      style={[styles.lessonPick, active && styles.lessonPickActive]}
                    >
                      <Text style={[styles.lessonPickText, active && styles.lessonPickTextActive, rtl && styles.textRtl]}>
                        {formatDate(lesson.start_datetime, language)} {formatTime(lesson.start_datetime, language)}{' '}
                        {localizeLessonSubject(lesson.subject, language)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}

            <TextInput
              style={[styles.input, rtl && styles.textRtl]}
              multiline
              value={absenceNote}
              onChangeText={setAbsenceNote}
              placeholder={t(language, {
                ru: 'Комментарий от родителя',
                en: 'Parent note',
                he: 'הערה מהורה',
              })}
              placeholderTextColor="#94a3b8"
            />

            <Pressable style={styles.primaryButton} onPress={() => void submitAbsence()}>
              <Text style={[styles.primaryButtonText, rtl && styles.textRtl]}>
                {t(language, { ru: 'Отправить', en: 'Send', he: 'שלח' })}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {tab === 'profile' ? (
          <>
            <View style={styles.panelCard}>
              <Text style={[styles.panelTitle, rtl && styles.textRtl]}>
                {t(language, { ru: 'Профиль родителя', en: 'Parent profile', he: 'פרופיל הורה' })}
              </Text>

              <View style={[styles.profileRow, rtl && styles.rowReverse]}>
                {user.photo_uri ? (
                  <Image source={{ uri: user.photo_uri }} style={styles.profileAvatar} />
                ) : (
                  <View style={[styles.profileAvatar, styles.profileAvatarFallback]}>
                    <Text style={styles.profileAvatarFallbackText}>{userInitials(user.name)}</Text>
                  </View>
                )}
                <View style={styles.profileInfo}>
                  <Text style={[styles.profileName, rtl && styles.textRtl]}>{user.name}</Text>
                  <Text style={[styles.profileMeta, rtl && styles.textRtl]}>{user.login}</Text>
                  {user.dob ? (
                    <Text style={[styles.profileMeta, rtl && styles.textRtl]}>
                      {user.dob.split('-').reverse().join('.')} 🎂
                    </Text>
                  ) : null}
                </View>
              </View>

              <View style={[styles.rowButtons, rtl && styles.rowReverse]}>
                <Pressable style={styles.primaryButton} onPress={() => void updateParentPhoto('gallery')}>
                  <Text style={styles.primaryButtonText}>
                    {t(language, { ru: 'Фото из галереи', en: 'Gallery photo', he: 'תמונה מהגלריה' })}
                  </Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={() => void updateParentPhoto('camera')}>
                  <Text style={styles.secondaryButtonText}>
                    {t(language, { ru: 'Фото с камеры', en: 'Camera photo', he: 'צילום מצלמה' })}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.panelCard}>
              <View style={[styles.rowBetween, rtl && styles.rowReverse]}>
                <Text style={[styles.panelTitle, rtl && styles.textRtl]}>
                  {t(language, { ru: 'Семья', en: 'Family', he: 'משפחה' })}
                </Text>
                <Pressable style={styles.secondaryButton} onPress={openAddChildSheet}>
                  <Text style={styles.secondaryButtonText}>
                    + {t(language, { ru: 'Добавить ребёнка', en: 'Add child', he: 'הוסף ילד' })}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.familyChildrenList}>
                {children.map((child) => {
                  const draft = childProfileDrafts[child.id] ?? {
                    phone: child.phone ?? '',
                    knownLanguages: child.known_languages?.length ? child.known_languages : [child.preferred_language],
                  };
                  const saving = savingChildProfileIds.includes(child.id);
                  return (
                    <View key={child.id} style={[styles.familyChildCard, selectedChildId === child.id && styles.familyChildCardActive]}>
                      <View style={[styles.familyChildPhotoWrap, rtl && styles.rowReverse]}>
                        {child.photo_uri ? (
                          <Image source={{ uri: child.photo_uri }} style={styles.familyChildPhoto} />
                        ) : (
                          <View style={[styles.familyChildPhoto, styles.profileAvatarFallback]}>
                            <Text style={styles.profileAvatarFallbackText}>{userInitials(child.name, 'S')}</Text>
                          </View>
                        )}
                        <View style={styles.familyChildMeta}>
                          <Text style={[styles.familyChildName, rtl && styles.textRtl]}>{child.name}</Text>
                          <Text style={[styles.familyChildClass, rtl && styles.textRtl]}>
                            {classLabel(snapshot, child, language)}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.childEditorBlock}>
                        <Text style={[styles.childEditorLabel, rtl && styles.textRtl]}>
                          {t(language, { ru: 'Телефон ребёнка', en: 'Child phone', he: 'טלפון הילד' })}
                        </Text>
                        <TextInput
                          style={[styles.childEditorInput, rtl && styles.textRtl]}
                          value={draft.phone}
                          onChangeText={(value) => updateChildPhoneDraft(child.id, value)}
                          placeholder={t(language, {
                            ru: 'Например: +972500000000',
                            en: 'Example: +972500000000',
                            he: 'לדוגמה: +972500000000',
                          })}
                          placeholderTextColor="#94a3b8"
                          keyboardType="phone-pad"
                        />

                        <Text style={[styles.childEditorLabel, rtl && styles.textRtl]}>
                          {t(language, {
                            ru: 'Языки ребёнка',
                            en: 'Child languages',
                            he: 'שפות שהילד יודע',
                          })}
                        </Text>
                        <View style={[styles.childLanguageRow, rtl && styles.rowReverse]}>
                          {CHILD_LANGUAGE_OPTIONS.map((entry) => {
                            const active = draft.knownLanguages.includes(entry.value);
                            return (
                              <Pressable
                                key={`${child.id}_${entry.value}`}
                                style={[styles.childLanguageChip, active && styles.childLanguageChipActive]}
                                onPress={() => toggleChildKnownLanguage(child.id, entry.value)}
                              >
                                <Text style={[styles.childLanguageChipText, active && styles.childLanguageChipTextActive]}>
                                  {entry.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>

                        <Pressable
                          style={[styles.primaryButton, saving && styles.disabledButton]}
                          onPress={() => void saveChildProfile(child)}
                          disabled={saving}
                        >
                          <Text style={styles.primaryButtonText}>
                            {saving
                              ? t(language, { ru: 'Сохранение...', en: 'Saving...', he: 'שומר...' })
                              : t(language, { ru: 'Сохранить', en: 'Save', he: 'שמור' })}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>

              {pendingRelationRequests.length > 0 ? (
                <View style={styles.pendingWrap}>
                  <Text style={[styles.pendingTitle, rtl && styles.textRtl]}>
                    {t(language, {
                      ru: 'Ожидают подтверждения админом',
                      en: 'Waiting for admin confirmation',
                      he: 'ממתין לאישור אדמין',
                    })}
                  </Text>
                  {pendingRelationRequests.map((request) => {
                    const student = snapshot.users.find((entry) => entry.id === request.student_id);
                    return (
                      <View key={request.id} style={styles.pendingRow}>
                        <Text style={[styles.pendingText, rtl && styles.textRtl]}>
                          {student?.name ?? request.student_id}
                        </Text>
                        <Text style={[styles.pendingStatus, rtl && styles.textRtl]}>
                          {t(language, { ru: 'Ожидает', en: 'Pending', he: 'בהמתנה' })}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>

            <View style={styles.panelCard}>
              <Text style={[styles.panelTitle, rtl && styles.textRtl]}>
                {t(language, { ru: 'Сотрудники школы', en: 'School staff', he: 'צוות בית הספר' })}
              </Text>
              <Text style={[styles.profileMeta, rtl && styles.textRtl]}>
                {t(language, {
                  ru: 'Нажмите на фото, чтобы открыть карточку сотрудника.',
                  en: 'Tap a photo to open staff card.',
                  he: 'לחצו על תמונה כדי לפתוח כרטיס עובד.',
                })}
              </Text>

              <View style={styles.staffCategoryBlock}>
                <Text style={[styles.staffCategoryTitle, rtl && styles.textRtl]}>
                  {t(language, { ru: 'Дирекция', en: 'Directorate', he: 'הנהלה' })}
                </Text>
                <View style={styles.staffGrid}>
                  {staffCategories.management.map((entry) => (
                    <Pressable key={entry.id} style={styles.staffGridItem} onPress={() => setSelectedStaffId(entry.id)}>
                      {entry.photo_uri ? (
                        <Image source={{ uri: entry.photo_uri }} style={styles.staffPhoto} />
                      ) : (
                        <View style={[styles.staffPhoto, styles.profileAvatarFallback]}>
                          <Text style={styles.profileAvatarFallbackText}>{userInitials(entry.name, 'S')}</Text>
                        </View>
                      )}
                      <Text style={[styles.staffGridName, rtl && styles.textRtl]} numberOfLines={1}>
                        {entry.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.staffCategoryBlock}>
                <Text style={[styles.staffCategoryTitle, rtl && styles.textRtl]}>
                  {t(language, { ru: 'Учителя', en: 'Teachers', he: 'מורים' })}
                </Text>
                <View style={styles.staffGrid}>
                  {staffCategories.teachers.map((entry) => (
                    <Pressable key={entry.id} style={styles.staffGridItem} onPress={() => setSelectedStaffId(entry.id)}>
                      {entry.photo_uri ? (
                        <Image source={{ uri: entry.photo_uri }} style={styles.staffPhoto} />
                      ) : (
                        <View style={[styles.staffPhoto, styles.profileAvatarFallback]}>
                          <Text style={styles.profileAvatarFallbackText}>{userInitials(entry.name, 'S')}</Text>
                        </View>
                      )}
                      <Text style={[styles.staffGridName, rtl && styles.textRtl]} numberOfLines={1}>
                        {entry.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <View style={styles.staffCategoryBlock}>
                <Text style={[styles.staffCategoryTitle, rtl && styles.textRtl]}>
                  {t(language, { ru: 'Персонал', en: 'Support staff', he: 'צוות שירות' })}
                </Text>
                <View style={styles.staffGrid}>
                  {staffCategories.staff.map((entry) => (
                    <Pressable key={entry.id} style={styles.staffGridItem} onPress={() => setSelectedStaffId(entry.id)}>
                      {entry.photo_uri ? (
                        <Image source={{ uri: entry.photo_uri }} style={styles.staffPhoto} />
                      ) : (
                        <View style={[styles.staffPhoto, styles.profileAvatarFallback]}>
                          <Text style={styles.profileAvatarFallbackText}>{userInitials(entry.name, 'S')}</Text>
                        </View>
                      )}
                      <Text style={[styles.staffGridName, rtl && styles.textRtl]} numberOfLines={1}>
                        {entry.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.panelCard}>
              <BirthdaySettingsCard user={user} onSave={onUpdateBirthdaySettings} />
            </View>
          </>
        ) : null}
      </ScrollView>

      {!keyboardVisible ? (
        <View style={styles.bottomTabBar}>
          {PARENT_TABS.map((entry) => {
            const active = tab === entry.key;
            return (
              <Pressable key={entry.key} style={styles.bottomTabItem} onPress={() => setTab(entry.key)}>
                <Ionicons name={entry.icon} size={20} color={active ? '#1d4ed8' : '#94a3b8'} />
                <Text style={[styles.bottomTabLabel, active && styles.bottomTabLabelActive]}>
                  {parentTabLabel(entry.key, language)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <Modal
        visible={addChildVisible}
        transparent
        animationType="slide"
        onRequestClose={closeAddChildSheet}
      >
        <Pressable style={styles.sheetBackdrop} onPress={closeAddChildSheet} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={[styles.rowBetween, rtl && styles.rowReverse]}>
            <Text style={[styles.sheetTitle, rtl && styles.textRtl]}>
              {t(language, { ru: 'Добавить ребёнка', en: 'Add child', he: 'הוסף ילד' })}
            </Text>
            <Pressable onPress={closeAddChildSheet}>
              <Ionicons name="close" size={20} color="#334155" />
            </Pressable>
          </View>

          <TextInput
            value={childSearch}
            onChangeText={setChildSearch}
            placeholder={t(language, {
              ru: 'Поиск: ФИО или класс',
              en: 'Search by name or class',
              he: 'חיפוש לפי שם או כיתה',
            })}
            placeholderTextColor="#94a3b8"
            style={[styles.sheetInput, rtl && styles.textRtl]}
          />

          <ScrollView style={styles.sheetList}>
            {filteredCandidates.length === 0 ? (
              <Text style={[styles.emptyText, rtl && styles.textRtl]}>
                {t(language, {
                  ru: 'Нет доступных учеников. Возможно, заявка уже отправлена.',
                  en: 'No available students. Request may already be sent.',
                  he: 'אין תלמידים זמינים. ייתכן שכבר נשלחה בקשה.',
                })}
              </Text>
            ) : (
              filteredCandidates.map((student) => {
                const active = selectedCandidateId === student.id;
                return (
                  <Pressable
                    key={student.id}
                    onPress={() => setSelectedCandidateId(student.id)}
                    style={[styles.sheetCandidate, active && styles.sheetCandidateActive]}
                  >
                    <Text style={[styles.sheetCandidateName, rtl && styles.textRtl]}>{student.name}</Text>
                    <Text style={[styles.sheetCandidateClass, rtl && styles.textRtl]}>
                      {classLabel(snapshot, student, language)}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View style={[styles.rowButtons, rtl && styles.rowReverse]}>
            <Pressable style={styles.secondaryButton} onPress={closeAddChildSheet}>
              <Text style={styles.secondaryButtonText}>
                {t(language, { ru: 'Отмена', en: 'Cancel', he: 'ביטול' })}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.primaryButton, !selectedCandidate && styles.disabledButton]}
              onPress={() => void submitRelationRequest()}
              disabled={!selectedCandidate}
            >
              <Text style={styles.primaryButtonText}>
                {t(language, { ru: 'Отправить запрос', en: 'Send request', he: 'שלח בקשה' })}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(selectedStaff)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedStaffId(null)}
      >
        <Pressable style={styles.staffModalBackdrop} onPress={() => setSelectedStaffId(null)} />
        {selectedStaff ? (
          <View style={styles.staffModalCard}>
            {selectedStaff.photo_uri ? (
              <Image source={{ uri: selectedStaff.photo_uri }} style={styles.staffModalPhoto} />
            ) : (
              <View style={[styles.staffModalPhoto, styles.profileAvatarFallback]}>
                <Text style={styles.profileAvatarFallbackText}>{userInitials(selectedStaff.name, 'S')}</Text>
              </View>
            )}
            <Text style={[styles.staffModalName, rtl && styles.textRtl]}>{selectedStaff.name}</Text>
            <Text style={[styles.staffModalRole, rtl && styles.textRtl]}>
              {staffRoleLabel(selectedStaff.role_id, language)}
            </Text>
            {selectedStaff.role_id === 3 && selectedStaff.teaching_subjects?.length ? (
              <Text style={[styles.staffModalRole, rtl && styles.textRtl]}>
                {selectedStaff.teaching_subjects.join(', ')}
              </Text>
            ) : null}
            <Pressable style={styles.primaryButton} onPress={() => setSelectedStaffId(null)}>
              <Text style={styles.primaryButtonText}>
                {t(language, { ru: 'Закрыть', en: 'Close', he: 'סגור' })}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  rootRtl: {
    direction: 'rtl',
  },
  header: {
    paddingTop: 44,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#dbeafe',
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerIdentity: {
    gap: 2,
  },
  headerName: {
    color: '#0f172a',
    fontSize: 24,
    fontWeight: '800',
  },
  headerRole: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
  },
  headerIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  childrenStrip: {
    marginTop: 14,
    gap: 8,
  },
  childrenStripTitle: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  childrenCarousel: {
    gap: 12,
    paddingRight: 6,
  },
  childrenCarouselRtl: {
    flexDirection: 'row-reverse',
  },
  childAvatarItem: {
    width: 72,
    alignItems: 'center',
    gap: 6,
  },
  childAvatarRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: '#dbeafe',
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#93c5fd',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 5,
  },
  childAvatarRingActive: {
    borderColor: '#1d4ed8',
  },
  childAvatarImage: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  childAvatarFallback: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#1e3a8a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  childAvatarFallbackText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 18,
  },
  childAvatarName: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  childAvatarNameActive: {
    color: '#1d4ed8',
  },
  content: {
    padding: 14,
    paddingBottom: 96,
    gap: 12,
  },
  dashboardCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 8,
    gap: 12,
  },
  dashboardHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dashboardChildPhotoRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 3,
    padding: 3,
  },
  dashboardChildPhotoRingOnline: {
    borderColor: '#22c55e',
  },
  dashboardChildPhotoRingOffline: {
    borderColor: '#ef4444',
  },
  dashboardChildPhoto: {
    width: '100%',
    height: '100%',
    borderRadius: 42,
  },
  dashboardChildPhotoFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 42,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashboardChildPhotoFallbackText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  dashboardChildMeta: {
    flex: 1,
    gap: 4,
  },
  dashboardChildName: {
    color: '#0f172a',
    fontSize: 20,
    fontWeight: '800',
  },
  dashboardChildClass: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: '600',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  metricCard: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 4,
  },
  metricGreen: {
    backgroundColor: '#dcfce7',
  },
  metricRed: {
    backgroundColor: '#fee2e2',
  },
  metricBlue: {
    backgroundColor: '#1d4ed8',
  },
  metricLabel: {
    color: '#166534',
    fontSize: 12,
    fontWeight: '700',
  },
  metricLabelLight: {
    color: '#bfdbfe',
  },
  metricValue: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  metricValueLight: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  panelCard: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    gap: 10,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 6,
  },
  panelTitle: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: '800',
  },
  emptyText: {
    color: '#64748b',
    fontSize: 13,
  },
  lessonsList: {
    gap: 8,
  },
  lessonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: '#f8fafc',
  },
  lessonNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#dbeafe',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lessonNumberText: {
    color: '#1e3a8a',
    fontSize: 12,
    fontWeight: '800',
  },
  lessonInfo: {
    flex: 1,
  },
  lessonSubject: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
  },
  lessonTime: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
  attendanceIcon: {
    fontSize: 18,
  },
  homeworkList: {
    gap: 10,
  },
  homeworkCard: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 14,
    backgroundColor: '#f8fbff',
    padding: 10,
    gap: 7,
  },
  homeworkText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  homeworkMeta: {
    color: '#475569',
    fontSize: 12,
  },
  homeworkDates: {
    color: '#1e3a8a',
    fontSize: 12,
    fontWeight: '700',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxIdle: {
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  checkBoxStudentDone: {
    borderColor: '#6366f1',
    backgroundColor: '#6366f1',
  },
  checkBoxParentDone: {
    borderColor: '#1d4ed8',
    backgroundColor: '#1d4ed8',
  },
  checkText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  threadTabs: {
    flexDirection: 'row',
    gap: 8,
  },
  threadTabsRtl: {
    flexDirection: 'row-reverse',
  },
  threadTab: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    backgroundColor: '#ffffff',
    paddingVertical: 7,
    paddingHorizontal: 11,
  },
  threadTabActive: {
    borderColor: '#1d4ed8',
    backgroundColor: '#dbeafe',
  },
  threadTabText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  threadTabTextActive: {
    color: '#1d4ed8',
  },
  lessonPickList: {
    gap: 7,
  },
  lessonPick: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  lessonPickActive: {
    borderColor: '#1d4ed8',
    backgroundColor: '#e0ecff',
  },
  lessonPickText: {
    color: '#334155',
    fontSize: 12,
  },
  lessonPickTextActive: {
    color: '#1d4ed8',
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    minHeight: 82,
    textAlignVertical: 'top',
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: '#0f172a',
  },
  primaryButton: {
    borderRadius: 12,
    backgroundColor: '#1d4ed8',
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf: 'flex-start',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  secondaryButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '700',
  },
  disabledButton: {
    opacity: 0.45,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileAvatar: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#dbeafe',
  },
  profileAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e3a8a',
  },
  profileAvatarFallbackText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '800',
  },
  profileInfo: {
    flex: 1,
    gap: 3,
  },
  profileName: {
    color: '#0f172a',
    fontSize: 19,
    fontWeight: '800',
  },
  profileMeta: {
    color: '#64748b',
    fontSize: 13,
  },
  rowButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  rowReverse: {
    flexDirection: 'row-reverse',
  },
  familyChildrenList: {
    gap: 8,
  },
  familyChildCard: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 12,
    backgroundColor: '#f8fbff',
    padding: 10,
  },
  familyChildCardActive: {
    borderColor: '#1d4ed8',
  },
  familyChildPhotoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  familyChildPhoto: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#dbeafe',
  },
  familyChildMeta: {
    flex: 1,
  },
  familyChildName: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
  },
  familyChildClass: {
    color: '#64748b',
    fontSize: 12,
    marginTop: 2,
  },
  childEditorBlock: {
    marginTop: 10,
    gap: 6,
  },
  childEditorLabel: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '700',
  },
  childEditorInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#0f172a',
  },
  childLanguageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  childLanguageChip: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 999,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  childLanguageChipActive: {
    borderColor: '#1d4ed8',
    backgroundColor: '#dbeafe',
  },
  childLanguageChipText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '700',
  },
  childLanguageChipTextActive: {
    color: '#1e3a8a',
  },
  pendingWrap: {
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    padding: 10,
    gap: 6,
  },
  pendingTitle: {
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: '800',
  },
  pendingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  pendingText: {
    flex: 1,
    color: '#1e293b',
    fontSize: 13,
    fontWeight: '600',
  },
  pendingStatus: {
    color: '#2563eb',
    fontSize: 12,
    fontWeight: '700',
  },
  staffCategoryBlock: {
    gap: 8,
  },
  staffCategoryTitle: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '800',
  },
  staffGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  staffGridItem: {
    width: '30%',
    minWidth: 82,
    alignItems: 'center',
    gap: 6,
  },
  staffPhoto: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#dbeafe',
  },
  staffGridName: {
    color: '#334155',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
  },
  bottomTabBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
    paddingHorizontal: 6,
    shadowColor: '#1e3a8a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 9,
  },
  bottomTabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  bottomTabLabel: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '700',
  },
  bottomTabLabelActive: {
    color: '#1d4ed8',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 26,
    gap: 10,
    maxHeight: '72%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#cbd5e1',
    marginBottom: 2,
  },
  sheetTitle: {
    color: '#0f172a',
    fontSize: 17,
    fontWeight: '800',
  },
  sheetInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
  },
  sheetList: {
    maxHeight: 280,
  },
  sheetCandidate: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 8,
    gap: 3,
  },
  sheetCandidateActive: {
    borderColor: '#1d4ed8',
    backgroundColor: '#eff6ff',
  },
  sheetCandidateName: {
    color: '#0f172a',
    fontSize: 14,
    fontWeight: '700',
  },
  sheetCandidateClass: {
    color: '#64748b',
    fontSize: 12,
  },
  staffModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  staffModalCard: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: '24%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#ffffff',
    padding: 16,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 16,
  },
  staffModalPhoto: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#dbeafe',
  },
  staffModalName: {
    color: '#0f172a',
    fontSize: 19,
    fontWeight: '800',
  },
  staffModalRole: {
    color: '#475569',
    fontSize: 13,
    textAlign: 'center',
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
