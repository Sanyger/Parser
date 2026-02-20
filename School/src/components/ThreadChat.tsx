import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { isRtlLanguage, t } from '../lib/i18n';
import { getLocalizedText } from '../lib/translation';
import { formatDate, formatTime } from '../lib/time';
import { AppLanguage, Message, Thread, User } from '../types/models';

interface ThreadChatProps {
  thread: Thread;
  messages: Message[];
  users: User[];
  currentUser: User;
  userLanguage: AppLanguage;
  showOriginal: boolean;
  allowSend: boolean;
  onSend: (text: string, attachments: string[]) => Promise<void>;
  onAttach: () => Promise<string | null>;
}

export function ThreadChat({
  thread,
  messages,
  users,
  currentUser,
  userLanguage,
  showOriginal,
  allowSend,
  onSend,
  onAttach,
}: ThreadChatProps) {
  const rtl = isRtlLanguage(userLanguage);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);

  const messagesInThread = useMemo(
    () =>
      messages
        .filter((entry) => entry.thread_id === thread.id)
        .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()),
    [messages, thread.id],
  );

  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  const onPickAttachment = async () => {
    const uri = await onAttach();
    if (uri) {
      setAttachments((entry) => [...entry, uri]);
    }
  };

  const onSendPress = async () => {
    const content = text.trim();
    if (!content && attachments.length === 0) {
      return;
    }
    await onSend(content, attachments);
    setText('');
    setAttachments([]);
  };

  return (
    <View style={[styles.wrapper, rtl && styles.wrapperRtl]}>
      <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
        {messagesInThread.map((message) => {
          const mine = message.sender_id === currentUser.id;
          const sender = userMap.get(message.sender_id);
          return (
            <View key={message.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
              <Text style={[styles.sender, rtl && styles.textRtl]}>
                {sender?.name ??
                  t(userLanguage, {
                    ru: 'Неизвестный',
                    en: 'Unknown',
                    he: 'לא ידוע',
                  })}
              </Text>
              <Text style={[styles.text, rtl && styles.textRtl]}>
                {getLocalizedText(
                  message.text_original,
                  message.translations,
                  userLanguage,
                  showOriginal,
                )}
              </Text>
              {message.attachments.length > 0 ? (
                <Text style={[styles.attachmentLabel, rtl && styles.textRtl]}>
                  {t(userLanguage, {
                    ru: 'Вложение',
                    en: 'Attachment',
                    he: 'קובץ מצורף',
                  })}
                  : {message.attachments.length}
                </Text>
              ) : null}
              <Text style={[styles.meta, rtl && styles.textRtl]}>
                {formatDate(message.created_at, userLanguage)} {formatTime(message.created_at, userLanguage)}
              </Text>
              {mine ? (
                <Text style={[styles.seen, rtl && styles.textRtl]}>
                  {t(userLanguage, {
                    ru: 'Просмотрели пользователи',
                    en: 'Seen by users',
                    he: 'נצפה על ידי משתמשים',
                  })}
                  : {message.read_by.length}
                </Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      {!allowSend ? (
        <Text style={[styles.readOnly, rtl && styles.textRtl]}>
          {t(userLanguage, {
            ru: 'Режим только чтения: объявления и сообщения недоступны для отправки.',
            en: 'Read-only mode: announcements/messages are not editable.',
            he: 'מצב קריאה בלבד: אי אפשר לשלוח הודעות או לערוך הודעות.',
          })}
        </Text>
      ) : (
        <View style={styles.composer}>
          <TextInput
            style={[styles.input, rtl && styles.textRtl]}
            placeholder={t(userLanguage, {
              ru: 'Введите сообщение',
              en: 'Type message',
              he: 'הקלד הודעה',
            })}
            placeholderTextColor="#6f86a8"
            value={text}
            onChangeText={setText}
            multiline
          />
          <View style={styles.actionsRow}>
            <Pressable onPress={onPickAttachment} style={styles.attachButton}>
              <Text style={[styles.attachText, rtl && styles.textRtl]}>
                {t(userLanguage, {
                  ru: '+ Вложение',
                  en: '+ Attachment',
                  he: '+ קובץ מצורף',
                })}
              </Text>
            </Pressable>
            <Pressable onPress={onSendPress} style={styles.sendButton}>
              <Text style={[styles.sendText, rtl && styles.textRtl]}>
                {t(userLanguage, {
                  ru: 'Отправить',
                  en: 'Send',
                  he: 'שלח',
                })}
              </Text>
            </Pressable>
          </View>
          {attachments.length > 0 ? (
            <Text style={[styles.pendingAttachments, rtl && styles.textRtl]}>
              {t(userLanguage, {
                ru: 'Вложения к отправке',
                en: 'Pending attachments',
                he: 'קבצים שממתינים לשליחה',
              })}
              : {attachments.length}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    maxHeight: 430,
  },
  wrapperRtl: {
    direction: 'rtl',
  },
  messages: {
    maxHeight: 280,
    borderWidth: 1,
    borderColor: '#dce5f3',
    borderRadius: 12,
    backgroundColor: '#f8fbff',
  },
  messagesContent: {
    padding: 10,
    gap: 8,
  },
  bubble: {
    maxWidth: '90%',
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: '#e7f2ff',
    borderColor: '#bfd8ff',
  },
  bubbleOther: {
    alignSelf: 'flex-start',
    backgroundColor: '#ffffff',
    borderColor: '#d5e2f7',
  },
  sender: {
    fontSize: 11,
    color: '#375275',
    marginBottom: 2,
  },
  text: {
    color: '#0b2a53',
    fontWeight: '500',
  },
  attachmentLabel: {
    marginTop: 4,
    fontSize: 12,
    color: '#285f27',
  },
  meta: {
    marginTop: 4,
    color: '#607799',
    fontSize: 11,
  },
  seen: {
    marginTop: 2,
    color: '#3f5f88',
    fontSize: 11,
  },
  composer: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#d7e2f0',
    borderRadius: 12,
    padding: 8,
    backgroundColor: '#ffffff',
  },
  input: {
    minHeight: 56,
    maxHeight: 110,
    textAlignVertical: 'top',
    color: '#0b2a53',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  attachButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#9db2cf',
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  attachText: {
    color: '#0b2a53',
    fontWeight: '600',
  },
  sendButton: {
    borderRadius: 10,
    backgroundColor: '#0b2a53',
    paddingVertical: 7,
    paddingHorizontal: 16,
  },
  sendText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  pendingAttachments: {
    marginTop: 5,
    color: '#3d5f89',
    fontSize: 12,
  },
  readOnly: {
    marginTop: 8,
    color: '#6a7e9d',
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
