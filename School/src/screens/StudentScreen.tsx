import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { HomeworkList } from '../components/HomeworkList';
import { ScheduleWeekView } from '../components/ScheduleWeekView';
import { SectionCard } from '../components/SectionCard';
import { ThreadChat } from '../components/ThreadChat';
import { isRtlLanguage, localizeLessonReason, localizeLessonSubject, t } from '../lib/i18n';
import { announcementThreads, lessonsForUser, threadTitle } from '../lib/selectors';
import { formatDate, formatTime } from '../lib/time';
import { DatabaseSnapshot, Thread, User } from '../types/models';
import { ScreenShell } from './ScreenShell';

type StudentTab = 'schedule' | 'homework' | 'announcements';
const studentTabs: StudentTab[] = ['schedule', 'homework', 'announcements'];

function studentTabLabel(tab: StudentTab, language: User['preferred_language']): string {
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
  return t(language, {
    ru: 'Объявления',
    en: 'Announcements',
    he: 'הודעות',
  });
}

export function StudentScreen({
  user,
  snapshot,
  showOriginal,
  onToggleOriginal,
  onRefresh,
  onLogout,
  onMarkRead,
}: {
  user: User;
  snapshot: DatabaseSnapshot;
  showOriginal: boolean;
  onToggleOriginal: () => void;
  onRefresh: () => Promise<void>;
  onLogout: () => void;
  onMarkRead: (threadId: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<StudentTab>('schedule');
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const language = user.preferred_language;
  const rtl = isRtlLanguage(language);

  const lessons = useMemo(() => lessonsForUser(user, snapshot), [snapshot, user]);
  const homework = snapshot.homework.filter((entry) => user.class_ids.includes(entry.class_id));

  const announcementOnly = useMemo(() => announcementThreads(user, snapshot), [snapshot, user]);
  const selectedThread: Thread | undefined = announcementOnly.find((entry) => entry.id === selectedThreadId);

  React.useEffect(() => {
    if (!selectedThreadId && announcementOnly.length > 0) {
      setSelectedThreadId(announcementOnly[0].id);
    }
  }, [selectedThreadId, announcementOnly]);

  return (
    <ScreenShell
      user={user}
      showOriginal={showOriginal}
      onToggleOriginal={onToggleOriginal}
      onRefresh={onRefresh}
      onLogout={onLogout}
    >
      <View style={[styles.tabsRow, rtl && styles.tabsRowRtl]}>
        {studentTabs.map((entry) => (
          <Pressable
            key={entry}
            style={[styles.tabButton, tab === entry && styles.tabButtonActive]}
            onPress={() => setTab(entry)}
          >
            <Text
              style={[styles.tabText, tab === entry && styles.tabTextActive, rtl && styles.textRtl]}
            >
              {studentTabLabel(entry, language)}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'schedule' ? (
        <SectionCard
          title={t(language, {
            ru: 'Расписание на неделю',
            en: 'Weekly schedule',
            he: 'מערכת שבועית',
          })}
        >
          <ScheduleWeekView
            lessons={lessons}
            language={language}
            onSelectLesson={(lesson) => {
              Alert.alert(
                localizeLessonSubject(lesson.subject, language),
                `${t(language, {
                  ru: 'Время',
                  en: 'Time',
                  he: 'שעה',
                })}: ${formatDate(lesson.start_datetime, language)} ${formatTime(lesson.start_datetime, language)}-${formatTime(lesson.end_datetime, language)}\n${t(language, {
                  ru: 'Причина',
                  en: 'Reason',
                  he: 'סיבה',
                })}: ${localizeLessonReason(lesson.change_reason, language) || '—'}`,
              );
            }}
          />
        </SectionCard>
      ) : null}

      {tab === 'homework' ? (
        <SectionCard
          title={t(language, {
            ru: 'Домашние задания',
            en: 'Homework',
            he: 'שיעורי בית',
          })}
        >
          <HomeworkList homework={homework} lessons={lessons} language={language} />
        </SectionCard>
      ) : null}

      {tab === 'announcements' ? (
        <>
          <SectionCard
            title={t(language, {
              ru: 'Чаты объявлений',
              en: 'Announcement threads',
              he: 'שיחות הודעות',
            })}
          >
            <View style={styles.threadTabs}>
              {announcementOnly.map((thread) => (
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
                allowSend={false}
                onAttach={async () => null}
                onSend={async () => {
                  return;
                }}
              />
            </SectionCard>
          ) : null}
        </>
      ) : null}
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
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
