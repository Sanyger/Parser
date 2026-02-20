import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LanguageSelector } from '../components/LanguageSelector';
import { isRtlLanguage, t } from '../lib/i18n';
import { AppLanguage } from '../types/models';

const TEST_USERS = [
  { login: 'director1', role: 'director' as const },
  { login: 'teacher1', role: 'teacher' as const },
  { login: 'parent1', role: 'parent' as const },
  { login: 'student1', role: 'student' as const },
  { login: 'staff1', role: 'staff' as const },
];

export function LoginScreen({
  onLogin,
  loading,
}: {
  onLogin: (params: { login: string; password: string; language: AppLanguage }) => Promise<void>;
  loading: boolean;
}) {
  const [login, setLogin] = useState('director1');
  const [password, setPassword] = useState('1234');
  const [language, setLanguage] = useState<AppLanguage>('ru');
  const [error, setError] = useState<string | null>(null);
  const rtl = isRtlLanguage(language);

  const submit = async () => {
    setError(null);
    try {
      await onLogin({ login, password, language });
    } catch {
      setError(
        t(language, {
          ru: 'Не удалось войти',
          en: 'Login failed',
          he: 'ההתחברות נכשלה',
        }),
      );
    }
  };

  const roleLabel = (role: (typeof TEST_USERS)[number]['role']): string => {
    if (role === 'director') {
      return t(language, {
        ru: 'Директор',
        en: 'Director',
        he: 'מנהל',
      });
    }
    if (role === 'teacher') {
      return t(language, {
        ru: 'Учитель',
        en: 'Teacher',
        he: 'מורה',
      });
    }
    if (role === 'parent') {
      return t(language, {
        ru: 'Родитель',
        en: 'Parent',
        he: 'הורה',
      });
    }
    if (role === 'student') {
      return t(language, {
        ru: 'Ученик',
        en: 'Student',
        he: 'תלמיד',
      });
    }
    return t(language, {
      ru: 'Сотрудник',
      en: 'Staff',
      he: 'סגל',
    });
  };

  return (
    <View style={[styles.container, rtl && styles.containerRtl]}>
      <Text style={[styles.title, rtl && styles.textRtl]}>
        {t(language, {
          ru: 'Школьный кабинет MVP',
          en: 'School Israel MVP',
          he: 'מערכת בית ספר MVP',
        })}
      </Text>
      <Text style={[styles.subtitle, rtl && styles.textRtl]}>
        {t(language, {
          ru: 'Вход',
          en: 'Login',
          he: 'התחברות',
        })}
      </Text>

      <TextInput
        style={[styles.input, rtl && styles.textRtl]}
        placeholder={t(language, {
          ru: 'Логин',
          en: 'Login',
          he: 'שם משתמש',
        })}
        autoCapitalize="none"
        placeholderTextColor="#7289a9"
        value={login}
        onChangeText={setLogin}
      />
      <TextInput
        style={[styles.input, rtl && styles.textRtl]}
        placeholder={t(language, {
          ru: 'Пароль',
          en: 'Password',
          he: 'סיסמה',
        })}
        placeholderTextColor="#7289a9"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      <Text style={[styles.label, rtl && styles.textRtl]}>
        {t(language, {
          ru: 'Язык',
          en: 'Language',
          he: 'שפה',
        })}
      </Text>
      <LanguageSelector value={language} onChange={setLanguage} uiLanguage={language} />

      <Pressable onPress={submit} style={styles.button} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text style={[styles.buttonText, rtl && styles.textRtl]}>
            {t(language, {
              ru: 'Войти',
              en: 'Login',
              he: 'התחבר',
            })}
          </Text>
        )}
      </Pressable>

      {error ? <Text style={[styles.error, rtl && styles.textRtl]}>{error}</Text> : null}

      <View style={styles.quickPanel}>
        <Text style={[styles.quickTitle, rtl && styles.textRtl]}>
          {t(language, {
            ru: 'Тестовые пользователи (пароль 1234)',
            en: 'Test users (password 1234)',
            he: 'משתמשי בדיקה (סיסמה 1234)',
          })}
        </Text>
        <View style={[styles.quickButtons, rtl && styles.quickButtonsRtl]}>
          {TEST_USERS.map((entry) => (
            <Pressable key={entry.login} onPress={() => setLogin(entry.login)} style={styles.quickButton}>
              <Text style={[styles.quickButtonText, rtl && styles.textRtl]}>{roleLabel(entry.role)}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#f2f7ff',
  },
  containerRtl: {
    direction: 'rtl',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#062149',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 18,
    color: '#1f4778',
    marginBottom: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: '#b7cae4',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    backgroundColor: '#ffffff',
    color: '#062149',
  },
  label: {
    marginBottom: 6,
    color: '#12335d',
    fontWeight: '600',
  },
  button: {
    marginTop: 12,
    backgroundColor: '#062149',
    borderRadius: 12,
    alignItems: 'center',
    paddingVertical: 12,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
  },
  error: {
    marginTop: 10,
    color: '#a22020',
  },
  quickPanel: {
    marginTop: 18,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ccd9ed',
    backgroundColor: '#ffffff',
  },
  quickTitle: {
    color: '#1e406c',
    marginBottom: 8,
    fontWeight: '600',
  },
  quickButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickButtonsRtl: {
    flexDirection: 'row-reverse',
  },
  quickButton: {
    borderWidth: 1,
    borderColor: '#9fb5d4',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  quickButtonText: {
    color: '#0d325e',
    fontWeight: '600',
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
