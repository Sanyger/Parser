import { BlurView } from 'expo-blur';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputContentSizeChangeEventData,
  View,
} from 'react-native';
import { isRtlLanguage, localeByLanguage, t } from '../lib/i18n';
import { getLocalizedText, localizePersonName } from '../lib/translation';
import { formatTime, toJerusalemDateInput } from '../lib/time';
import { AppLanguage, Message, Thread, User } from '../types/models';

const INPUT_MIN_HEIGHT = 48;
const INPUT_MAX_HEIGHT = 118;
const IOS_COLLAPSED_BOTTOM_INSET = 12;
const ANDROID_COLLAPSED_BOTTOM_INSET = 8;

interface ThreadChatProps {
  thread: Thread;
  messages: Message[];
  users: User[];
  currentUser: User;
  userLanguage: AppLanguage;
  showOriginal: boolean;
  allowSend: boolean;
  keyboardAvoidingEnabled?: boolean;
  layoutMode?: 'inline' | 'immersive';
  onSend: (text: string, attachments: string[]) => Promise<void>;
  onAttach: () => Promise<string | null>;
}

type ChatItem =
  | {
      type: 'date';
      key: string;
      label: string;
    }
  | {
      type: 'message';
      key: string;
      message: Message;
    };

function parseDateInput(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function addDays(dateInput: string, days: number): string {
  const parsed = parseDateInput(dateInput);
  if (!parsed) {
    return dateInput;
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function dateDividerLabel(dateInput: string, language: AppLanguage): string {
  const today = toJerusalemDateInput(new Date().toISOString());
  if (dateInput === today) {
    return t(language, { ru: 'Сегодня', en: 'Today', he: 'היום' });
  }
  if (dateInput === addDays(today, -1)) {
    return t(language, { ru: 'Вчера', en: 'Yesterday', he: 'אתמול' });
  }

  const parsed = parseDateInput(dateInput);
  if (!parsed) {
    return dateInput;
  }

  return new Intl.DateTimeFormat(localeByLanguage(language), {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'long',
  }).format(parsed);
}

export function ThreadChat({
  thread,
  messages,
  users,
  currentUser,
  userLanguage,
  showOriginal,
  allowSend,
  keyboardAvoidingEnabled = true,
  layoutMode = 'inline',
  onSend,
  onAttach,
}: ThreadChatProps) {
  const rtl = isRtlLanguage(userLanguage);
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [inputHeight, setInputHeight] = useState(INPUT_MIN_HEIGHT);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [composerHeight, setComposerHeight] = useState(132);
  const messagesRef = useRef<ScrollView | null>(null);
  const isInitialRender = useRef(true);

  const messagesInThread = useMemo(
    () =>
      messages
        .filter((entry) => entry.thread_id === thread.id)
        .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()),
    [messages, thread.id],
  );

  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  const chatItems = useMemo<ChatItem[]>(() => {
    const items: ChatItem[] = [];
    let previousDateKey = '';

    for (const message of messagesInThread) {
      const dateKey = toJerusalemDateInput(message.created_at);
      if (dateKey !== previousDateKey) {
        previousDateKey = dateKey;
        items.push({
          type: 'date',
          key: `date_${dateKey}`,
          label: dateDividerLabel(dateKey, userLanguage),
        });
      }
      items.push({
        type: 'message',
        key: message.id,
        message,
      });
    }

    return items;
  }, [messagesInThread, userLanguage]);

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      messagesRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
      scrollToBottom(true);
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollToBottom]);

  useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      scrollToBottom(false);
      return;
    }
    scrollToBottom(true);
  }, [chatItems.length, scrollToBottom]);

  const onInputContentSizeChange = (
    event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>,
  ) => {
    const nextHeight = Math.min(
      INPUT_MAX_HEIGHT,
      Math.max(INPUT_MIN_HEIGHT, Math.ceil(event.nativeEvent.contentSize.height)),
    );
    if (nextHeight !== inputHeight) {
      setInputHeight(nextHeight);
    }
  };

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
    setInputHeight(INPUT_MIN_HEIGHT);
    scrollToBottom(true);
  };

  const isTwoPartyDialog =
    (thread.type === 'direct' || thread.type === 'parent_teacher') && thread.participants.length <= 2;

  const composerBottomInset = keyboardVisible
    ? 0
    : Platform.OS === 'ios'
      ? IOS_COLLAPSED_BOTTOM_INSET
      : ANDROID_COLLAPSED_BOTTOM_INSET;

  const isImmersive = layoutMode === 'immersive';

  return (
    <KeyboardAvoidingView
      style={[
        styles.wrapper,
        isImmersive ? styles.wrapperImmersive : styles.wrapperInline,
        rtl && styles.wrapperRtl,
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      enabled={keyboardAvoidingEnabled}
    >
      <ScrollView
        ref={messagesRef}
        style={[styles.messages, isImmersive && styles.messagesImmersive]}
        contentContainerStyle={[
          styles.messagesContent,
          isImmersive && allowSend ? { paddingBottom: composerHeight + 18 } : null,
        ]}
        keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
      >
        {chatItems.map((item) => {
          if (item.type === 'date') {
            return (
              <View key={item.key} style={styles.dateDividerWrap}>
                <View style={styles.dateDividerLine} />
                <Text style={[styles.dateDividerText, rtl && styles.textRtl]}>{item.label}</Text>
                <View style={styles.dateDividerLine} />
              </View>
            );
          }

          const message = item.message;
          const mine = message.sender_id === currentUser.id;
          const sender = userMap.get(message.sender_id);
          const seenByOther = message.read_by.some((entry) => entry !== currentUser.id);
          const deliveryMark = seenByOther ? '✓✓' : '✓';
          const canShowSenderName = !isTwoPartyDialog && !mine;
          const messageText = getLocalizedText(
            message.text_original,
            message.translations,
            userLanguage,
            showOriginal,
          );

          return (
            <View
              key={item.key}
              style={[styles.bubbleWrap, mine ? styles.bubbleWrapMine : styles.bubbleWrapOther]}
            >
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                {canShowSenderName ? (
                  <Text style={[styles.senderName, rtl && styles.textRtl]}>
                    {sender
                      ? localizePersonName(sender.name, userLanguage)
                      : t(userLanguage, { ru: 'Неизвестный', en: 'Unknown', he: 'לא ידוע' })}
                  </Text>
                ) : null}

                <Text style={[styles.messageText, mine ? styles.messageTextMine : styles.messageTextOther, rtl && styles.textRtl]}>
                  {messageText}
                </Text>

                {message.attachments.length > 0 ? (
                  <Text style={[styles.attachmentMeta, mine ? styles.attachmentMetaMine : styles.attachmentMetaOther, rtl && styles.textRtl]}>
                    {t(userLanguage, { ru: 'Вложений', en: 'Attachments', he: 'קבצים' })}: {message.attachments.length}
                  </Text>
                ) : null}

                <View style={[styles.messageMetaRow, mine ? styles.messageMetaRowMine : styles.messageMetaRowOther]}>
                  <Text style={[styles.timeMeta, mine ? styles.timeMetaMine : styles.timeMetaOther]}>
                    {formatTime(message.created_at, userLanguage)}
                  </Text>
                  {mine ? (
                    <Text style={[styles.deliveryMark, seenByOther ? styles.deliveryMarkSeen : styles.deliveryMarkPending]}>
                      {deliveryMark}
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>

      {!allowSend ? (
        <View style={[styles.readOnlyBox, isImmersive && styles.readOnlyBoxImmersive]}>
          <Text style={[styles.readOnlyText, rtl && styles.textRtl]}>
            {t(userLanguage, {
              ru: 'Режим только чтения',
              en: 'Read-only mode',
              he: 'מצב קריאה בלבד',
            })}
          </Text>
        </View>
      ) : isImmersive ? (
        <View
          style={[styles.composerStickyShell, { paddingBottom: composerBottomInset }]}
          onLayout={(event) => {
            const measured = Math.ceil(event.nativeEvent.layout.height);
            if (measured > 0 && measured !== composerHeight) {
              setComposerHeight(measured);
            }
          }}
        >
          <BlurView intensity={70} tint="light" style={styles.composerBlur}>
            <TextInput
              style={[styles.input, { height: inputHeight }, rtl && styles.textRtl]}
              placeholder={t(userLanguage, {
                ru: 'Введите сообщение',
                en: 'Type message',
                he: 'הקלד הודעה',
              })}
              placeholderTextColor="#6f86a8"
              value={text}
              onChangeText={setText}
              onFocus={() => scrollToBottom(true)}
              onContentSizeChange={onInputContentSizeChange}
              scrollEnabled={inputHeight >= INPUT_MAX_HEIGHT}
              multiline
            />
            <View style={styles.actionsRow}>
              <Pressable onPress={onPickAttachment} style={styles.attachButton}>
                <Text style={[styles.attachText, rtl && styles.textRtl]}>
                  {t(userLanguage, {
                    ru: '+ Вложение',
                    en: '+ Attachment',
                    he: '+ קובץ',
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
                  ru: 'К отправке',
                  en: 'Pending',
                  he: 'ממתין לשליחה',
                })}
                : {attachments.length}
              </Text>
            ) : null}
          </BlurView>
        </View>
      ) : (
        <View style={styles.composerInlineShell}>
          <BlurView intensity={55} tint="light" style={styles.composerBlur}>
            <TextInput
              style={[styles.input, { height: inputHeight }, rtl && styles.textRtl]}
              placeholder={t(userLanguage, {
                ru: 'Введите сообщение',
                en: 'Type message',
                he: 'הקלד הודעה',
              })}
              placeholderTextColor="#6f86a8"
              value={text}
              onChangeText={setText}
              onFocus={() => scrollToBottom(true)}
              onContentSizeChange={onInputContentSizeChange}
              scrollEnabled={inputHeight >= INPUT_MAX_HEIGHT}
              multiline
            />
            <View style={styles.actionsRow}>
              <Pressable onPress={onPickAttachment} style={styles.attachButton}>
                <Text style={[styles.attachText, rtl && styles.textRtl]}>
                  {t(userLanguage, {
                    ru: '+ Вложение',
                    en: '+ Attachment',
                    he: '+ קובץ',
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
                  ru: 'К отправке',
                  en: 'Pending',
                  he: 'ממתין לשליחה',
                })}
                : {attachments.length}
              </Text>
            ) : null}
          </BlurView>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  wrapperInline: {
    minHeight: 360,
    maxHeight: 560,
  },
  wrapperImmersive: {
    flex: 1,
    minHeight: 0,
  },
  wrapperRtl: {
    direction: 'rtl',
  },
  messages: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dce5f3',
    borderRadius: 14,
    backgroundColor: '#f8fbff',
  },
  messagesImmersive: {
    borderColor: '#e2e8f0',
    borderRadius: 0,
  },
  messagesContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 8,
  },
  dateDividerWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    marginBottom: 2,
  },
  dateDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#dbe4ef',
  },
  dateDividerText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '700',
  },
  bubbleWrap: {
    width: '100%',
  },
  bubbleWrapMine: {
    alignItems: 'flex-end',
  },
  bubbleWrapOther: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '86%',
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  bubbleMine: {
    backgroundColor: '#1e3a8a',
    borderTopRightRadius: 6,
  },
  bubbleOther: {
    backgroundColor: '#f1f5f9',
    borderTopLeftRadius: 6,
  },
  senderName: {
    fontSize: 11,
    color: '#475569',
    fontWeight: '700',
    marginBottom: 3,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 19,
  },
  messageTextMine: {
    color: '#ffffff',
  },
  messageTextOther: {
    color: '#0f172a',
  },
  attachmentMeta: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '600',
  },
  attachmentMetaMine: {
    color: '#dbeafe',
  },
  attachmentMetaOther: {
    color: '#64748b',
  },
  messageMetaRow: {
    flexDirection: 'row',
    marginTop: 4,
    gap: 6,
    alignItems: 'center',
  },
  messageMetaRowMine: {
    justifyContent: 'flex-end',
  },
  messageMetaRowOther: {
    justifyContent: 'flex-start',
  },
  timeMeta: {
    fontSize: 10,
    fontWeight: '600',
  },
  timeMetaMine: {
    color: '#bfdbfe',
  },
  timeMetaOther: {
    color: '#64748b',
  },
  deliveryMark: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  deliveryMarkSeen: {
    color: '#60a5fa',
  },
  deliveryMarkPending: {
    color: '#cbd5e1',
  },
  composerInlineShell: {
    marginTop: 10,
  },
  composerStickyShell: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  composerBlur: {
    borderTopWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.3)',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
  },
  input: {
    minHeight: INPUT_MIN_HEIGHT,
    maxHeight: INPUT_MAX_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d7e2f0',
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 10,
    textAlignVertical: 'top',
    lineHeight: 20,
    color: '#0b2a53',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 8,
  },
  attachButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#9db2cf',
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: '#ffffff',
  },
  attachText: {
    color: '#0b2a53',
    fontWeight: '600',
  },
  sendButton: {
    borderRadius: 10,
    backgroundColor: '#1e3a8a',
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
  readOnlyBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#dbe4ef',
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  readOnlyBoxImmersive: {
    marginTop: 0,
    borderRadius: 0,
    borderWidth: 0,
    borderTopWidth: 1,
  },
  readOnlyText: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
