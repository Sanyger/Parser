import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SectionCard } from '../components/SectionCard';
import { ScheduleWeekView } from '../components/ScheduleWeekView';
import { effectiveRoleId } from '../components/RoleLabel';
import {
  feedbackStatusName,
  isRtlLanguage,
  localizeLessonSubject,
  roleCompactNameById,
  roleNameById,
  t,
} from '../lib/i18n';
import { className, lessonsForUser } from '../lib/selectors';
import { formatTime } from '../lib/time';
import { DatabaseSnapshot, Feedback, RoleId, User } from '../types/models';
import { ScreenShell } from './ScreenShell';

const roleCycle: RoleId[] = [3, 4, 5, 6, 2];

function nextRole(roleId: RoleId): RoleId {
  const position = roleCycle.indexOf(roleId);
  return roleCycle[(position + 1) % roleCycle.length];
}

function toggleVisibilityRoles(feedback: Feedback): RoleId[] {
  if (feedback.visibility_roles.includes(4)) {
    return feedback.visibility_roles.filter((roleId) => roleId !== 4);
  }
  return Array.from(new Set([...feedback.visibility_roles, 4]));
}

export function DirectorScreen({
  user,
  snapshot,
  showOriginal,
  onToggleOriginal,
  onRefresh,
  onLogout,
  onAssignHomeroom,
  onUpdateRole,
  onPublishAnnouncement,
  onUpdateFeedback,
  onPublishScheduleUpdate,
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
  onPublishScheduleUpdate: (params: {
    lessonId: string;
    subject: string;
    room: string;
    reason: string;
  }) => Promise<void>;
}) {
  const [announcementText, setAnnouncementText] = useState('');
  const language = user.preferred_language;
  const rtl = isRtlLanguage(language);

  const allLessons = useMemo(() => lessonsForUser(user, snapshot), [snapshot, user]);
  const teacher = snapshot.users.find((entry) => entry.login === 'teacher1');
  const classModel = snapshot.classes.find((entry) => entry.id === 'class_g1');
  const feedbackNewCount = snapshot.feedback.filter((entry) => entry.status === 'new').length;

  const roleManageUsers = snapshot.users.filter((entry) => entry.id !== user.id);

  const publishAnnouncement = async () => {
    if (!announcementText.trim()) {
      return;
    }
    await onPublishAnnouncement({ text: announcementText.trim() });
    setAnnouncementText('');
    Alert.alert(
      t(language, {
        ru: 'Объявление опубликовано',
        en: 'Announcement published',
        he: 'הודעה פורסמה',
      }),
      t(language, {
        ru: 'Объявление директора отправлено всем пользователям.',
        en: 'Director announcement was sent to all users.',
        he: 'הודעת המנהל נשלחה לכל המשתמשים.',
      }),
    );
  };

  const publishScheduleChange = async () => {
    const baseLesson = allLessons.find((entry) => entry.status === 'normal');
    if (!baseLesson) {
      return;
    }

    const subject = t(language, {
      ru: 'Заменяющий семинар',
      en: 'Substitute Seminar',
      he: 'סמינר חלופי',
    });
    const room = t(language, {
      ru: 'Конференц-зал',
      en: 'Conference Room',
      he: 'חדר ישיבות',
    });
    const reason = t(language, {
      ru: 'Обновление расписания от директора',
      en: 'Director-published schedule update',
      he: 'עדכון מערכת שפורסם על ידי המנהל',
    });

    await onPublishScheduleUpdate({
      lessonId: baseLesson.id,
      subject,
      room,
      reason,
    });
    Alert.alert(
      t(language, {
        ru: 'Расписание изменено',
        en: 'Schedule changed',
        he: 'המערכת עודכנה',
      }),
      t(language, {
        ru: `Урок ${localizeLessonSubject(baseLesson.subject, language)} в ${formatTime(baseLesson.start_datetime, language)} был обновлён.`,
        en: `Lesson ${localizeLessonSubject(baseLesson.subject, language)} at ${formatTime(baseLesson.start_datetime, language)} was updated.`,
        he: `השיעור ${localizeLessonSubject(baseLesson.subject, language)} בשעה ${formatTime(baseLesson.start_datetime, language)} עודכן.`,
      }),
    );
  };

  return (
    <ScreenShell
      user={user}
      showOriginal={showOriginal}
      onToggleOriginal={onToggleOriginal}
      onRefresh={onRefresh}
      onLogout={onLogout}
    >
      <SectionCard
        title={t(language, {
          ru: 'Список классов',
          en: 'Classes list',
          he: 'רשימת כיתות',
        })}
      >
        {snapshot.classes.map((entry) => {
          const teacherName = snapshot.users.find((userEntry) => userEntry.id === entry.homeroom_teacher_id)?.name;
          return (
            <View key={entry.id} style={styles.rowBetween}>
              <Text style={[styles.primaryText, rtl && styles.textRtl]}>
                {entry.name} ({entry.grade})
              </Text>
              <Text style={[styles.secondaryText, rtl && styles.textRtl]}>
                {teacherName
                  ? `${t(language, {
                      ru: 'Классный руководитель',
                      en: 'Homeroom',
                      he: 'מחנך',
                    })}: ${teacherName}`
                  : t(language, {
                      ru: 'Классный руководитель не назначен',
                      en: 'Homeroom: unassigned',
                      he: 'לא הוקצה מחנך',
                    })}
              </Text>
            </View>
          );
        })}
      </SectionCard>

      <SectionCard
        title={t(language, {
          ru: 'Назначить классного руководителя',
          en: 'Assign homeroom teacher',
          he: 'הקצאת מחנך כיתה',
        })}
      >
        {teacher && classModel ? (
          <View style={styles.rowWrap}>
            <Text style={[styles.secondaryText, rtl && styles.textRtl]}>
              {teacher.name}{' '}
              {t(language, {
                ru: 'для класса',
                en: 'for class',
                he: 'עבור כיתה',
              })}{' '}
              {classModel.name}
            </Text>
            <Pressable
              style={styles.primaryButton}
              onPress={() => onAssignHomeroom(teacher.id, classModel.id, !teacher.is_homeroom)}
            >
              <Text style={[styles.primaryButtonText, rtl && styles.textRtl]}>
                {teacher.is_homeroom
                  ? t(language, {
                      ru: 'Снять флаг классного руководителя',
                      en: 'Remove homeroom flag',
                      he: 'הסר תפקיד מחנך',
                    })
                  : t(language, {
                      ru: 'Назначить классным руководителем',
                      en: 'Assign as homeroom',
                      he: 'הקצה כמחנך',
                    })}
              </Text>
            </Pressable>
          </View>
        ) : (
          <Text style={[styles.secondaryText, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Не найден тестовый учитель или класс',
              en: 'Teacher/class seed not found',
              he: 'לא נמצאו נתוני מורה/כיתה',
            })}
          </Text>
        )}
      </SectionCard>

      <SectionCard
        title={`${t(language, {
          ru: 'Новых отзывов',
          en: 'Feedback counter',
          he: 'מונה משובים חדשים',
        })}: ${feedbackNewCount}`}
      >
        {snapshot.feedback.map((entry) => (
          <View key={entry.id} style={styles.feedbackItem}>
            <Text style={[styles.primaryText, rtl && styles.textRtl]}>{entry.text_original}</Text>
            <Text style={[styles.secondaryText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Статус',
                en: 'Status',
                he: 'סטטוס',
              })}
              : {feedbackStatusName(entry.status, language)}
            </Text>
            <Text style={[styles.secondaryText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Видимые роли',
                en: 'Visible roles',
                he: 'תפקידים גלויים',
              })}
              : {entry.visibility_roles.map((roleId) => roleNameById(roleId, language)).join(', ')}
            </Text>
            <View style={styles.feedbackActions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() =>
                  onUpdateFeedback({
                    feedbackId: entry.id,
                    status: entry.status === 'new' ? 'reviewed' : 'planned',
                  })
                }
              >
                <Text style={[styles.secondaryButtonText, rtl && styles.textRtl]}>
                  {t(language, {
                    ru: 'Следующий статус',
                    en: 'Advance status',
                    he: 'סטטוס הבא',
                  })}
                </Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={() =>
                  onUpdateFeedback({
                    feedbackId: entry.id,
                    visibilityRoles: toggleVisibilityRoles(entry),
                  })
                }
              >
                <Text style={[styles.secondaryButtonText, rtl && styles.textRtl]}>
                  {t(language, {
                    ru: 'Показать/скрыть для родителя',
                    en: 'Toggle parent visibility',
                    he: 'הצג/הסתר להורה',
                  })}
                </Text>
              </Pressable>
            </View>
          </View>
        ))}
      </SectionCard>

      <SectionCard
        title={t(language, {
          ru: 'Управление ролями',
          en: 'Manage roles',
          he: 'ניהול תפקידים',
        })}
      >
        {roleManageUsers.map((managedUser) => {
          const roleId = effectiveRoleId(managedUser) as RoleId;
          return (
            <View key={managedUser.id} style={styles.roleRow}>
              <Text style={[styles.primaryText, rtl && styles.textRtl]}>{managedUser.name}</Text>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => onUpdateRole(managedUser.id, nextRole(roleId))}
              >
                <Text style={[styles.secondaryButtonText, rtl && styles.textRtl]}>
                  {roleCompactNameById(roleId, language)} → {roleCompactNameById(nextRole(roleId), language)}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </SectionCard>

      <SectionCard
        title={t(language, {
          ru: 'Создать объявление',
          en: 'Create announcement',
          he: 'יצירת הודעה',
        })}
      >
        <TextInput
          style={[styles.input, rtl && styles.textRtl]}
          placeholder={t(language, {
            ru: 'Текст объявления директора',
            en: 'Director announcement',
            he: 'הודעת מנהל',
          })}
          placeholderTextColor="#7a90af"
          value={announcementText}
          onChangeText={setAnnouncementText}
          multiline
        />
        <Pressable style={styles.primaryButton} onPress={publishAnnouncement}>
          <Text style={[styles.primaryButtonText, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Опубликовать',
              en: 'Publish',
              he: 'פרסם',
            })}
          </Text>
        </Pressable>
      </SectionCard>

      <SectionCard
        title={t(language, {
          ru: 'Push об изменении расписания',
          en: 'Schedule change push',
          he: 'התראת שינוי מערכת',
        })}
      >
        <Pressable style={styles.primaryButton} onPress={publishScheduleChange}>
          <Text style={[styles.primaryButtonText, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Опубликовать пример изменения',
              en: 'Publish sample schedule change',
              he: 'פרסם דוגמת שינוי מערכת',
            })}
          </Text>
        </Pressable>
      </SectionCard>

      <SectionCard
        title={`${t(language, {
          ru: 'Общее расписание',
          en: 'Global schedule',
          he: 'מערכת כללית',
        })} (${className(snapshot, 'class_g1', language)})`}
      >
        <ScheduleWeekView lessons={allLessons} language={language} />
      </SectionCard>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  rowBetween: {
    marginBottom: 8,
  },
  rowWrap: {
    gap: 8,
  },
  primaryText: {
    color: '#0a2b55',
    fontWeight: '700',
  },
  secondaryText: {
    color: '#476287',
  },
  primaryButton: {
    backgroundColor: '#0b2a53',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#9db3d3',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  secondaryButtonText: {
    color: '#1d3f69',
    fontWeight: '600',
    fontSize: 12,
  },
  feedbackItem: {
    borderWidth: 1,
    borderColor: '#d8e2f0',
    borderRadius: 10,
    padding: 8,
    marginBottom: 8,
    backgroundColor: '#f8fbff',
    gap: 2,
  },
  feedbackActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  roleRow: {
    marginBottom: 8,
    gap: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#c3d2e9',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 60,
    textAlignVertical: 'top',
    color: '#0a2b55',
    marginBottom: 8,
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
