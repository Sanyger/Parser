import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { HomeworkList } from '../components/HomeworkList';
import { ScheduleWeekView } from '../components/ScheduleWeekView';
import { SectionCard } from '../components/SectionCard';
import { ThreadChat } from '../components/ThreadChat';
import { isRtlLanguage, t } from '../lib/i18n';
import { childUsers, threadTitle } from '../lib/selectors';
import { formatDate, formatTime } from '../lib/time';
import { DatabaseSnapshot, Thread, User } from '../types/models';
import { ScreenShell } from './ScreenShell';

type ParentTab = 'schedule' | 'homework' | 'messages' | 'absence';
const parentTabs: ParentTab[] = ['schedule', 'homework', 'messages', 'absence'];

function parentTabLabel(tab: ParentTab, language: User['preferred_language']): string {
  if (tab === 'schedule') {
    return t(language, {
      ru: 'Расписание',
      en: 'Schedule',
      he: 'מערכת שעות',
    });
  }
  if (tab === 'homework') {
    return t(language, {
      ru: 'Домашнее',
      en: 'Homework',
      he: 'שיעורי בית',
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
    ru: 'Отсутствие',
    en: 'Absence',
    he: 'היעדרות',
  });
}

export function ParentScreen({
  user,
  snapshot,
  showOriginal,
  onToggleOriginal,
  onRefresh,
  onLogout,
  onSendAbsence,
  onSendMessage,
  onMarkRead,
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
}) {
  const [tab, setTab] = useState<ParentTab>('schedule');
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedAbsenceLessonId, setSelectedAbsenceLessonId] = useState<string>('');
  const [absenceNote, setAbsenceNote] = useState('');
  const language = user.preferred_language;
  const rtl = isRtlLanguage(language);

  const children = useMemo(() => childUsers(user, snapshot), [snapshot, user]);

  useEffect(() => {
    if (!selectedChildId && children.length > 0) {
      setSelectedChildId(children[0].id);
    }
  }, [selectedChildId, children]);

  const selectedChild = children.find((entry) => entry.id === selectedChildId);
  const childClassIds = selectedChild?.class_ids ?? [];

  const lessons = snapshot.lessons.filter((lesson) => childClassIds.includes(lesson.class_id));
  const homework = snapshot.homework.filter((item) => childClassIds.includes(item.class_id));

  const parentThreads = snapshot.threads.filter((thread) => thread.participants.includes(user.id));
  const selectedThread: Thread | undefined = parentThreads.find((entry) => entry.id === selectedThreadId);

  useEffect(() => {
    if (!selectedThreadId && parentThreads.length > 0) {
      setSelectedThreadId(parentThreads[0].id);
    }
  }, [selectedThreadId, parentThreads]);

  useEffect(() => {
    if (!selectedAbsenceLessonId && lessons.length > 0) {
      setSelectedAbsenceLessonId(lessons[0].id);
    }
  }, [selectedAbsenceLessonId, lessons]);

  const pickImage = async (): Promise<string | null> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (result.canceled || !result.assets[0]) {
      return null;
    }
    return result.assets[0].uri;
  };

  const submitAbsence = async () => {
    if (!selectedChildId || !selectedAbsenceLessonId || !absenceNote.trim()) {
      return;
    }

    await onSendAbsence({
      studentId: selectedChildId,
      lessonId: selectedAbsenceLessonId,
      note: absenceNote.trim(),
    });

    setAbsenceNote('');
    Alert.alert(
      t(language, {
        ru: 'Отправлено',
        en: 'Absence sent',
        he: 'נשלח',
      }),
      t(language, {
        ru: 'Уведомление об отсутствии отправлено в школу.',
        en: 'Absence notice was submitted to the school.',
        he: 'דיווח היעדרות נשלח לבית הספר.',
      }),
    );
  };

  const changedLessonCount = lessons.filter((entry) => entry.status !== 'normal').length;

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
          ru: 'Выбор ребёнка',
          en: 'Child selector',
          he: 'בחירת ילד',
        })}
      >
        {children.length === 0 ? (
          <Text style={[styles.secondaryText, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Нет привязанных детей',
              en: 'No linked children',
              he: 'אין ילדים מקושרים',
            })}
          </Text>
        ) : (
          <View style={[styles.childPickRow, rtl && styles.childPickRowRtl]}>
            {children.map((child) => (
              <Pressable
                key={child.id}
                onPress={() => setSelectedChildId(child.id)}
                style={[
                  styles.childPick,
                  selectedChildId === child.id && styles.childPickActive,
                ]}
              >
                <Text
                  style={[
                    styles.childPickText,
                    selectedChildId === child.id && styles.childPickTextActive,
                    rtl && styles.textRtl,
                  ]}
                >
                  {child.name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </SectionCard>

      <View style={[styles.tabsRow, rtl && styles.tabsRowRtl]}>
        {parentTabs.map((entry) => (
          <Pressable
            key={entry}
            style={[styles.tabButton, tab === entry && styles.tabButtonActive]}
            onPress={() => setTab(entry)}
          >
            <Text style={[styles.tabText, tab === entry && styles.tabTextActive, rtl && styles.textRtl]}>
              {parentTabLabel(entry, language)}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'schedule' ? (
        <SectionCard
          title={`${t(language, {
            ru: 'Расписание на неделю',
            en: 'Weekly schedule',
            he: 'מערכת שבועית',
          })} (${t(language, {
            ru: 'изменено',
            en: 'changed',
            he: 'שונה',
          })}: ${changedLessonCount})`}
        >
          <ScheduleWeekView
            lessons={lessons}
            language={language}
            onSelectLesson={(lesson) => {
              Alert.alert(
                lesson.subject,
                `${t(language, {
                  ru: 'Время',
                  en: 'Time',
                  he: 'שעה',
                })}: ${formatDate(lesson.start_datetime, language)} ${formatTime(lesson.start_datetime, language)}-${formatTime(lesson.end_datetime, language)}\n${t(language, {
                  ru: 'Причина',
                  en: 'Reason',
                  he: 'סיבה',
                })}: ${lesson.change_reason ?? '—'}`,
              );
            }}
          />
        </SectionCard>
      ) : null}

      {tab === 'homework' ? (
        <SectionCard
          title={t(language, {
            ru: 'Список домашнего задания',
            en: 'Homework list',
            he: 'רשימת שיעורי בית',
          })}
        >
          <HomeworkList homework={homework} lessons={lessons} language={language} />
        </SectionCard>
      ) : null}

      {tab === 'messages' ? (
        <>
          <SectionCard
            title={t(language, {
              ru: 'Чаты',
              en: 'Threads',
              he: 'שיחות',
            })}
          >
            <View style={styles.threadTabs}>
              {parentThreads.map((thread) => (
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
                onSend={(text, attachments) =>
                  onSendMessage({
                    threadId: selectedThread.id,
                    text,
                    attachments,
                  })
                }
              />
            </SectionCard>
          ) : null}
        </>
      ) : null}

      {tab === 'absence' ? (
        <SectionCard
          title={t(language, {
            ru: 'Отправить уведомление об отсутствии',
            en: 'Send absence notice',
            he: 'שליחת הודעת היעדרות',
          })}
        >
          <Text style={[styles.secondaryText, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Выбор урока',
              en: 'Lesson selection',
              he: 'בחירת שיעור',
            })}
          </Text>
          <View style={styles.lessonPickContainer}>
            {lessons.map((lesson) => (
              <Pressable
                key={lesson.id}
                onPress={() => setSelectedAbsenceLessonId(lesson.id)}
                style={[
                  styles.lessonPick,
                  selectedAbsenceLessonId === lesson.id && styles.lessonPickActive,
                ]}
              >
                <Text
                  style={[
                    styles.lessonPickText,
                    selectedAbsenceLessonId === lesson.id && styles.lessonPickTextActive,
                    rtl && styles.textRtl,
                  ]}
                >
                  {formatDate(lesson.start_datetime, language)} {formatTime(lesson.start_datetime, language)}{' '}
                  {lesson.subject}
                </Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            style={[styles.input, rtl && styles.textRtl]}
            multiline
            placeholder={t(language, {
              ru: 'Комментарий от родителя',
              en: 'Note from parent',
              he: 'הערה מהורה',
            })}
            placeholderTextColor="#7086a6"
            value={absenceNote}
            onChangeText={setAbsenceNote}
          />
          <Pressable style={styles.primaryButton} onPress={submitAbsence}>
            <Text style={[styles.primaryButtonText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Отправить',
                en: 'Send absence',
                he: 'שלח היעדרות',
              })}
            </Text>
          </Pressable>
        </SectionCard>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  secondaryText: {
    color: '#486183',
    fontSize: 13,
  },
  childPickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  childPickRowRtl: {
    flexDirection: 'row-reverse',
  },
  childPick: {
    borderWidth: 1,
    borderColor: '#9bb1d0',
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: '#ffffff',
  },
  childPickActive: {
    backgroundColor: '#0b2a53',
    borderColor: '#0b2a53',
  },
  childPickText: {
    color: '#1d3f6c',
    fontWeight: '700',
  },
  childPickTextActive: {
    color: '#ffffff',
  },
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
  lessonPickContainer: {
    gap: 6,
    marginVertical: 8,
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
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
