import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScheduleWeekView } from '../components/ScheduleWeekView';
import { SectionCard } from '../components/SectionCard';
import { ThreadChat } from '../components/ThreadChat';
import { isRtlLanguage, t } from '../lib/i18n';
import { announcementThreads, lessonsForUser, threadTitle } from '../lib/selectors';
import { DatabaseSnapshot, Thread, User } from '../types/models';
import { ScreenShell } from './ScreenShell';

export function StaffScreen({
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
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const language = user.preferred_language;
  const rtl = isRtlLanguage(language);

  const assignedLessons = useMemo(() => lessonsForUser(user, snapshot), [snapshot, user]);
  const threads = useMemo(() => announcementThreads(user, snapshot), [snapshot, user]);
  const selectedThread: Thread | undefined = threads.find((entry) => entry.id === selectedThreadId);

  React.useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    }
  }, [selectedThreadId, threads]);

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
          ru: 'Назначенное расписание',
          en: 'Limited assigned schedule',
          he: 'מערכת משובצת',
        })}
      >
        {assignedLessons.length > 0 ? (
          <ScheduleWeekView lessons={assignedLessons} language={language} />
        ) : (
          <Text style={styles.secondaryText}>
            {t(language, {
              ru: 'Нет назначенных уроков',
              en: 'No assigned schedule entries',
              he: 'אין שיעורים משובצים',
            })}
          </Text>
        )}
      </SectionCard>

      <SectionCard
        title={t(language, {
          ru: 'Объявления',
          en: 'Announcements',
          he: 'הודעות',
        })}
      >
        <View style={styles.threadTabs}>
          {threads.map((thread) => (
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
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
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
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
