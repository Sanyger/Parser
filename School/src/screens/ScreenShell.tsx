import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RoleLabel } from '../components/RoleLabel';
import { isRtlLanguage, t } from '../lib/i18n';
import { nowInJerusalemLabel } from '../lib/time';
import { User } from '../types/models';

interface ScreenShellProps {
  user: User;
  showOriginal: boolean;
  onToggleOriginal: () => void;
  onRefresh: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export function ScreenShell({
  user,
  showOriginal,
  onToggleOriginal,
  onRefresh,
  onLogout,
  children,
}: ScreenShellProps) {
  const language = user.preferred_language;
  const rtl = isRtlLanguage(language);

  return (
    <View style={[styles.root, rtl && styles.rootRtl]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.userName, rtl && styles.textRtl]}>{user.name}</Text>
          <RoleLabel user={user} />
          <Text style={[styles.timeText, rtl && styles.textRtl]}>
            {nowInJerusalemLabel(language)} ·{' '}
            {t(language, {
              ru: 'Часовой пояс',
              en: 'Time zone',
              he: 'אזור זמן',
            })}
            : Asia/Jerusalem
          </Text>
        </View>
        <View style={[styles.headerActions, rtl && styles.headerActionsRtl]}>
          <Pressable style={styles.actionButton} onPress={onToggleOriginal}>
            <Text style={[styles.actionText, rtl && styles.textRtl]}>
              {showOriginal
                ? t(language, {
                    ru: 'Оригинал: включен',
                    en: 'Original: ON',
                    he: 'מקור: מופעל',
                  })
                : t(language, {
                    ru: 'Оригинал: выключен',
                    en: 'Original: OFF',
                    he: 'מקור: כבוי',
                  })}
            </Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={onRefresh}>
            <Text style={[styles.actionText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Обновить',
                en: 'Refresh',
                he: 'רענון',
              })}
            </Text>
          </Pressable>
          <Pressable style={[styles.actionButton, styles.logoutButton]} onPress={onLogout}>
            <Text style={[styles.actionText, styles.logoutText, rtl && styles.textRtl]}>
              {t(language, {
                ru: 'Выйти',
                en: 'Logout',
                he: 'יציאה',
              })}
            </Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#eef4ff',
  },
  rootRtl: {
    direction: 'rtl',
  },
  header: {
    backgroundColor: '#0a2550',
    paddingTop: 46,
    paddingBottom: 14,
    paddingHorizontal: 14,
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    gap: 10,
  },
  userName: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 20,
    marginBottom: 8,
  },
  timeText: {
    color: '#d0def6',
    marginTop: 6,
    fontSize: 12,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  headerActionsRtl: {
    flexDirection: 'row-reverse',
  },
  actionButton: {
    borderWidth: 1,
    borderColor: '#8ea8cf',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#173867',
  },
  actionText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 12,
  },
  logoutButton: {
    borderColor: '#ffb8b8',
    backgroundColor: '#6f1b1b',
  },
  logoutText: {
    color: '#ffdede',
  },
  content: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    paddingBottom: 36,
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
