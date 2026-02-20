import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { HomeworkList } from '../components/HomeworkList';
import { ScheduleWeekView } from '../components/ScheduleWeekView';
import { SectionCard } from '../components/SectionCard';
import { ThreadChat } from '../components/ThreadChat';
import { isRtlLanguage, localizeLessonReason, localizeLessonRoom, localizeLessonSubject, t } from '../lib/i18n';
import {
  currentLesson,
  latestIncomingCount,
  lessonsForUser,
  threadTitle,
  threadsForUser,
  todayLessons,
} from '../lib/selectors';
import { formatDate, formatTime } from '../lib/time';
import { DatabaseSnapshot, Feedback, Homework, Thread, User } from '../types/models';
import { ScreenShell } from './ScreenShell';

type TeacherTab = 'today' | 'schedule' | 'messages' | 'homework';
const teacherTabs: TeacherTab[] = ['today', 'schedule', 'messages', 'homework'];

function teacherTabLabel(tab: TeacherTab, language: User['preferred_language']): string {
  if (tab === 'today') {
    return t(language, {
      ru: 'Сегодня',
      en: 'Today',
      he: 'היום',
    });
  }
  if (tab === 'schedule') {
    return t(language, {
      ru: 'Расписание',
      en: 'Schedule',
      he: 'מערכת שעות',
    });
  }
  if (tab === 'messages') {
    return t(language, {
      ru: 'Сообщения',
      en: 'Messages',
      he: 'הודעות',
    });
  }
  return t(language, {
    ru: 'Домашнее',
    en: 'Homework',
    he: 'שיעורי בית',
  });
}

export function TeacherScreen({
  user,
  snapshot,
  showOriginal,
  onToggleOriginal,
  onRefresh,
  onLogout,
  onSaveHomework,
  onSendMessage,
  onPublishAnnouncement,
  onMarkRead,
  onUpdateFeedback,
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
    attachments: string[];
    source: 'manual' | 'photo_ocr';
    ocrRawText: string | null;
  }) => Promise<void>;
  onSendMessage: (params: { threadId: string; text: string; attachments: string[] }) => Promise<void>;
  onPublishAnnouncement: (params: { text: string; classId?: string }) => Promise<void>;
  onMarkRead: (threadId: string) => Promise<void>;
  onUpdateFeedback: (params: { feedbackId: string; status?: Feedback['status'] }) => Promise<void>;
}) {
  const [tab, setTab] = useState<TeacherTab>('today');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const [editingHomeworkId, setEditingHomeworkId] = useState<string | undefined>(undefined);
  const [selectedLessonId, setSelectedLessonId] = useState<string>('');
  const [homeworkText, setHomeworkText] = useState('');
  const [homeworkAttachments, setHomeworkAttachments] = useState<string[]>([]);
  const [ocrRawText, setOcrRawText] = useState<string | null>(null);

  const [announcementText, setAnnouncementText] = useState('');

  const language = user.preferred_language;
  const rtl = isRtlLanguage(language);

  const teacherLessons = useMemo(() => lessonsForUser(user, snapshot), [snapshot, user]);
  const todaysLessons = useMemo(() => todayLessons(user, snapshot), [snapshot, user]);
  const activeLesson = useMemo(() => currentLesson(user, snapshot), [snapshot, user]);
  const incomingCount = useMemo(() => latestIncomingCount(user, snapshot), [snapshot, user]);
  const students = snapshot.users.filter((entry) => entry.role_id === 5);

  const teacherThreads = useMemo(() => threadsForUser(user, snapshot), [snapshot, user]);
  const selectedThread: Thread | undefined = teacherThreads.find((entry) => entry.id === selectedThreadId);

  const teacherHomework = snapshot.homework.filter((entry) => entry.teacher_id === user.id);

  useEffect(() => {
    if (!selectedThreadId && teacherThreads.length > 0) {
      setSelectedThreadId(teacherThreads[0].id);
    }
  }, [selectedThreadId, teacherThreads]);

  useEffect(() => {
    if (!selectedLessonId && teacherLessons.length > 0) {
      setSelectedLessonId(teacherLessons[0].id);
    }
  }, [selectedLessonId, teacherLessons]);

  const pickImage = async (): Promise<string | null> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: false,
      quality: 0.7,
    });

    if (result.canceled || !result.assets[0]) {
      return null;
    }
    return result.assets[0].uri;
  };

  const attachHomeworkPhoto = async () => {
    const uri = await pickImage();
    if (!uri) {
      return;
    }

    setHomeworkAttachments((entry) => [...entry, uri]);
    const fileName = uri.split('/').slice(-1)[0];
    const extracted = t(language, {
      ru: `OCR (редактируемо): текст извлечён из ${fileName}`,
      en: `OCR (editable): text extracted from ${fileName}`,
      he: `OCR (ניתן לעריכה): טקסט חולץ מתוך ${fileName}`,
    });
    setOcrRawText(extracted);
    if (!homeworkText.trim()) {
      setHomeworkText(extracted);
    }
  };

  const saveHomework = async () => {
    if (!selectedLessonId || !homeworkText.trim()) {
      return;
    }

    await onSaveHomework({
      homeworkId: editingHomeworkId,
      lessonId: selectedLessonId,
      text: homeworkText.trim(),
      attachments: homeworkAttachments,
      source: homeworkAttachments.length > 0 ? 'photo_ocr' : 'manual',
      ocrRawText,
    });

    setEditingHomeworkId(undefined);
    setHomeworkText('');
    setHomeworkAttachments([]);
    setOcrRawText(null);
    Alert.alert(
      t(language, {
        ru: 'Сохранено',
        en: 'Saved',
        he: 'נשמר',
      }),
      t(language, {
        ru: 'Домашнее задание успешно сохранено.',
        en: 'Homework was saved successfully.',
        he: 'שיעורי הבית נשמרו בהצלחה.',
      }),
    );
  };

  const editHomework = (item: Homework) => {
    setTab('homework');
    setEditingHomeworkId(item.id);
    setSelectedLessonId(item.lesson_id);
    setHomeworkText(item.text);
    setHomeworkAttachments(item.attachments);
    setOcrRawText(item.ocr_raw_text);
  };

  const sendAnnouncement = async () => {
    if (!announcementText.trim()) {
      return;
    }

    await onPublishAnnouncement({
      text: announcementText.trim(),
      classId: user.class_ids[0],
    });
    setAnnouncementText('');
    Alert.alert(
      t(language, {
        ru: 'Опубликовано',
        en: 'Published',
        he: 'פורסם',
      }),
      t(language, {
        ru: 'Объявление для класса отправлено.',
        en: 'Class announcement sent.',
        he: 'הודעה כיתתית נשלחה.',
      }),
    );
  };

  const renderToday = () => (
    <>
      <SectionCard
        title={t(language, {
          ru: 'Текущий урок',
          en: 'Current Lesson block',
          he: 'השיעור הנוכחי',
        })}
      >
        {activeLesson ? (
          <Text style={[styles.primaryText, rtl && styles.textRtl]}>
            {localizeLessonSubject(activeLesson.subject, language)} · {formatTime(activeLesson.start_datetime, language)}-
            {formatTime(activeLesson.end_datetime, language)}
          </Text>
        ) : (
          <Text style={[styles.secondaryText, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Сейчас нет активного урока.',
              en: 'No lesson is currently active.',
              he: 'כרגע אין שיעור פעיל.',
            })}
          </Text>
        )}
      </SectionCard>

      <SectionCard
        title={`${t(language, {
          ru: 'Уроки на сегодня',
          en: "Today's lessons",
          he: 'שיעורים להיום',
        })} (${todaysLessons.length})`}
      >
        {todaysLessons.length === 0 ? (
          <Text style={[styles.secondaryText, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Сегодня уроков нет',
              en: 'No lessons today',
              he: 'אין שיעורים היום',
            })}
          </Text>
        ) : (
          todaysLessons.map((lesson) => (
            <Text key={lesson.id} style={[styles.primaryText, rtl && styles.textRtl]}>
              {formatTime(lesson.start_datetime, language)} {localizeLessonSubject(lesson.subject, language)} ({localizeLessonRoom(lesson.room, language)})
            </Text>
          ))
        )}
      </SectionCard>

      <SectionCard
        title={t(language, {
          ru: 'Список учеников по урокам',
          en: 'Student list per lesson',
          he: 'רשימת תלמידים לפי שיעור',
        })}
      >
        {todaysLessons.length === 0 ? (
          <Text style={[styles.secondaryText, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Для сегодняшнего дня нет актуального состава класса.',
              en: 'No active lesson roster for today.',
              he: 'אין רשימת נוכחות פעילה להיום.',
            })}
          </Text>
        ) : (
          todaysLessons.map((lesson) => {
            const lessonStudents = students.filter((student) =>
              student.class_ids.includes(lesson.class_id),
            );
            return (
              <View key={lesson.id} style={styles.feedbackItem}>
                <Text style={[styles.primaryText, rtl && styles.textRtl]}>
                  {localizeLessonSubject(lesson.subject, language)} ({formatTime(lesson.start_datetime, language)})
                </Text>
                <Text style={[styles.secondaryText, rtl && styles.textRtl]}>
                  {lessonStudents.map((student) => student.name).join(', ') ||
                    t(language, {
                      ru: 'Нет назначенных учеников',
                      en: 'No students assigned',
                      he: 'אין תלמידים משובצים',
                    })}
                </Text>
              </View>
            );
          })
        )}
      </SectionCard>

      <SectionCard
        title={t(language, {
          ru: 'Входящие сообщения от родителей',
          en: 'Incoming parent messages',
          he: 'הודעות נכנסות מהורים',
        })}
      >
        <Text style={[styles.primaryText, rtl && styles.textRtl]}>
          {incomingCount}{' '}
          {t(language, {
            ru: 'непрочитанных сообщений',
            en: 'unread message(s)',
            he: 'הודעות שלא נקראו',
          })}
        </Text>
      </SectionCard>

      {user.is_homeroom ? (
        <SectionCard
          title={t(language, {
            ru: 'Инструменты классного руководителя',
            en: 'Homeroom tools',
            he: 'כלי מחנך כיתה',
          })}
        >
          <TextInput
            style={[styles.input, rtl && styles.textRtl]}
            value={announcementText}
            onChangeText={setAnnouncementText}
            placeholder={t(language, {
              ru: 'Опубликовать объявление для класса',
              en: 'Publish class announcement',
              he: 'פרסם הודעה כיתתית',
            })}
            placeholderTextColor="#7086a6"
            multiline
          />
          <Pressable style={styles.primaryButton} onPress={sendAnnouncement}>
            <Text style={[styles.primaryButtonText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Опубликовать объявление',
                en: 'Publish class announcement',
                he: 'פרסם הודעה כיתתית',
              })}
            </Text>
          </Pressable>

          <View style={styles.feedbackApproveContainer}>
            {snapshot.feedback
              .filter((entry) => entry.status === 'new')
              .map((entry) => (
                <View key={entry.id} style={styles.feedbackItem}>
                  <Text style={[styles.secondaryText, rtl && styles.textRtl]}>{entry.text_original}</Text>
                  <Pressable
                    style={styles.secondaryButton}
                    onPress={() => onUpdateFeedback({ feedbackId: entry.id, status: 'reviewed' })}
                  >
                    <Text style={[styles.secondaryButtonText, rtl && styles.textRtl]}>
                      {t(language, {
                        ru: 'Подтвердить публичный отзыв',
                        en: 'Approve public feedback',
                        he: 'אשר משוב פומבי',
                      })}
                    </Text>
                  </Pressable>
                </View>
              ))}
          </View>
        </SectionCard>
      ) : null}
    </>
  );

  const renderSchedule = () => (
    <SectionCard
      title={t(language, {
        ru: 'Расписание: воскресенье-пятница (суббота выходной)',
        en: 'Schedule Sunday-Friday (Saturday disabled)',
        he: 'מערכת: ראשון-שישי (שבת מושבתת)',
      })}
    >
      <ScheduleWeekView
        lessons={teacherLessons}
        language={language}
        onSelectLesson={(lesson) => {
          Alert.alert(
            localizeLessonSubject(lesson.subject, language),
            `${t(language, {
              ru: 'Кабинет',
              en: 'Room',
              he: 'כיתה',
            })}: ${localizeLessonRoom(lesson.room, language)}\n${formatDate(lesson.start_datetime, language)} ${formatTime(lesson.start_datetime, language)}-${formatTime(lesson.end_datetime, language)}\n${t(language, {
              ru: 'Причина',
              en: 'Reason',
              he: 'סיבה',
            })}: ${localizeLessonReason(lesson.change_reason, language) || '—'}`,
          );
        }}
      />
    </SectionCard>
  );

  const renderMessages = () => (
    <>
      <SectionCard
        title={t(language, {
          ru: 'Чаты',
          en: 'Threads',
          he: 'שיחות',
        })}
      >
        <View style={styles.threadTabs}>
          {teacherThreads.map((thread) => (
            <Pressable
              key={thread.id}
              style={[styles.threadButton, selectedThreadId === thread.id && styles.threadButtonActive]}
              onPress={() => {
                setSelectedThreadId(thread.id);
                onMarkRead(thread.id);
              }}
            >
              <Text
                style={[
                  styles.threadButtonText,
                  selectedThreadId === thread.id && styles.threadButtonTextActive,
                  rtl && styles.textRtl,
                ]}
              >
                {threadTitle(thread, snapshot, language)}
              </Text>
            </Pressable>
          ))}
        </View>
      </SectionCard>

      {selectedThread ? (
        <SectionCard title={threadTitle(selectedThread, snapshot, language)}>
          <ThreadChat
            thread={selectedThread}
            messages={snapshot.messages}
            users={snapshot.users}
            currentUser={user}
            userLanguage={language}
            showOriginal={showOriginal}
            allowSend
            onAttach={pickImage}
            onSend={async (text, attachments) => {
              await onSendMessage({
                threadId: selectedThread.id,
                text,
                attachments,
              });
            }}
          />
        </SectionCard>
      ) : null}
    </>
  );

  const renderHomework = () => (
    <>
      <SectionCard
        title={t(language, {
          ru: 'Добавить/редактировать домашнее задание',
          en: 'Add/Edit homework',
          he: 'הוספה/עריכת שיעורי בית',
        })}
      >
        <Text style={[styles.secondaryText, rtl && styles.textRtl]}>
          {t(language, {
            ru: 'Урок',
            en: 'Lesson',
            he: 'שיעור',
          })}
        </Text>
        <View style={styles.lessonPickContainer}>
          {teacherLessons.map((lesson) => (
            <Pressable
              key={lesson.id}
              onPress={() => setSelectedLessonId(lesson.id)}
              style={[styles.lessonPick, selectedLessonId === lesson.id && styles.lessonPickActive]}
            >
              <Text
                style={[
                  styles.lessonPickText,
                  selectedLessonId === lesson.id && styles.lessonPickTextActive,
                  rtl && styles.textRtl,
                ]}
                >
                  {formatDate(lesson.start_datetime, language)} {formatTime(lesson.start_datetime, language)}{' '}
                  {localizeLessonSubject(lesson.subject, language)}
                </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          style={[styles.input, rtl && styles.textRtl]}
          value={homeworkText}
          onChangeText={setHomeworkText}
          multiline
          placeholder={t(language, {
            ru: 'Текст домашнего задания',
            en: 'Homework text',
            he: 'טקסט שיעורי הבית',
          })}
          placeholderTextColor="#7086a6"
        />

        {ocrRawText ? (
          <Text style={[styles.ocrText, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Сырой текст OCR',
              en: 'OCR raw text',
              he: 'טקסט OCR גולמי',
            })}
            : {ocrRawText}
          </Text>
        ) : null}
        {homeworkAttachments.length > 0 ? (
          <Text style={[styles.secondaryText, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Выбрано вложений',
              en: 'Attachments selected',
              he: 'קבצים מצורפים נבחרו',
            })}
            : {homeworkAttachments.length}
          </Text>
        ) : null}

        <View style={styles.actionsRow}>
          <Pressable style={styles.secondaryButton} onPress={attachHomeworkPhoto}>
            <Text style={[styles.secondaryButtonText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Добавить фото + OCR',
                en: 'Add photo + OCR',
                he: 'הוסף תמונה + OCR',
              })}
            </Text>
          </Pressable>
          <Pressable style={styles.primaryButton} onPress={saveHomework}>
            <Text style={[styles.primaryButtonText, rtl && styles.textRtl]}>
              {editingHomeworkId
                ? t(language, {
                    ru: 'Обновить',
                    en: 'Update',
                    he: 'עדכן',
                  })
                : t(language, {
                    ru: 'Сохранить',
                    en: 'Save',
                    he: 'שמור',
                  })}
            </Text>
          </Pressable>
        </View>
      </SectionCard>

      <SectionCard
        title={t(language, {
          ru: 'Существующие домашние задания',
          en: 'Existing homework',
          he: 'שיעורי בית קיימים',
        })}
      >
        <HomeworkList
          homework={teacherHomework}
          lessons={teacherLessons}
          language={language}
          editable
          onEdit={editHomework}
        />
      </SectionCard>
    </>
  );

  return (
    <ScreenShell
      user={user}
      showOriginal={showOriginal}
      onToggleOriginal={onToggleOriginal}
      onRefresh={onRefresh}
      onLogout={onLogout}
    >
      <View style={[styles.tabsRow, rtl && styles.tabsRowRtl]}>
        {teacherTabs.map((entry) => (
          <Pressable
            key={entry}
            style={[styles.tabButton, tab === entry && styles.tabButtonActive]}
            onPress={() => setTab(entry)}
          >
            <Text style={[styles.tabText, tab === entry && styles.tabTextActive, rtl && styles.textRtl]}>
              {teacherTabLabel(entry, language)}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'today' && renderToday()}
      {tab === 'schedule' && renderSchedule()}
      {tab === 'messages' && renderMessages()}
      {tab === 'homework' && renderHomework()}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  tabsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  tabsRowRtl: {
    flexDirection: 'row-reverse',
  },
  tabButton: {
    borderWidth: 1,
    borderColor: '#9bb1d0',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: '#ffffff',
  },
  tabButtonActive: {
    backgroundColor: '#0b2a53',
    borderColor: '#0b2a53',
  },
  tabText: {
    color: '#1c406e',
    fontWeight: '700',
    fontSize: 12,
  },
  tabTextActive: {
    color: '#ffffff',
  },
  primaryText: {
    color: '#0c2a53',
    fontWeight: '700',
    marginBottom: 5,
  },
  secondaryText: {
    color: '#486183',
    fontSize: 13,
  },
  threadTabs: {
    gap: 6,
  },
  threadButton: {
    borderWidth: 1,
    borderColor: '#c2d2e8',
    borderRadius: 10,
    padding: 8,
    backgroundColor: '#ffffff',
  },
  threadButtonActive: {
    borderColor: '#0b2a53',
    backgroundColor: '#e9f0fb',
  },
  threadButtonText: {
    color: '#2a4b74',
    fontWeight: '600',
  },
  threadButtonTextActive: {
    color: '#0b2a53',
  },
  input: {
    borderWidth: 1,
    borderColor: '#c3d2e9',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 74,
    textAlignVertical: 'top',
    color: '#0a2b55',
    marginVertical: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: '#0b2a53',
    borderRadius: 10,
    paddingVertical: 8,
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
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  secondaryButtonText: {
    color: '#1d3f69',
    fontWeight: '600',
    fontSize: 12,
  },
  feedbackApproveContainer: {
    marginTop: 12,
    gap: 8,
  },
  feedbackItem: {
    borderWidth: 1,
    borderColor: '#d7e1ef',
    borderRadius: 10,
    padding: 8,
    gap: 6,
  },
  lessonPickContainer: {
    gap: 5,
    marginVertical: 7,
  },
  lessonPick: {
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#c4d4ea',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#ffffff',
  },
  lessonPickActive: {
    borderColor: '#0b2a53',
    backgroundColor: '#ebf2fd',
  },
  lessonPickText: {
    color: '#2d4f76',
    fontSize: 12,
  },
  lessonPickTextActive: {
    color: '#0b2a53',
    fontWeight: '700',
  },
  ocrText: {
    color: '#0d4f2b',
    fontSize: 12,
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
