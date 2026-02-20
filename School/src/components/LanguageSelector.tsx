import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isRtlLanguage, languageName } from '../lib/i18n';
import { AppLanguage } from '../types/models';

const options: AppLanguage[] = ['he', 'ru', 'en'];

export function LanguageSelector({
  value,
  onChange,
  uiLanguage,
}: {
  value: AppLanguage;
  onChange: (language: AppLanguage) => void;
  uiLanguage?: AppLanguage;
}) {
  const activeLanguage = uiLanguage ?? value;
  const rtl = isRtlLanguage(activeLanguage);

  return (
    <View style={[styles.row, rtl && styles.rowRtl]}>
      {options.map((option) => (
        <Pressable
          key={option}
          onPress={() => onChange(option)}
          style={[styles.option, value === option && styles.optionActive]}
        >
          <Text style={[styles.optionText, value === option && styles.optionTextActive]}>
            {languageName(option, activeLanguage)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  option: {
    borderWidth: 1,
    borderColor: '#9fb1cc',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    minWidth: 54,
    alignItems: 'center',
    backgroundColor: '#f3f6fb',
  },
  optionActive: {
    borderColor: '#0b2a53',
    backgroundColor: '#0b2a53',
  },
  optionText: {
    color: '#0b2a53',
    fontWeight: '600',
  },
  optionTextActive: {
    color: '#ffffff',
  },
});
