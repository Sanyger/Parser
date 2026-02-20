import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isRtlLanguage, localizeLessonSubject, t } from '../lib/i18n';
import { formatDate } from '../lib/time';
import { AppLanguage, Homework, Lesson } from '../types/models';

interface HomeworkListProps {
  homework: Homework[];
  lessons: Lesson[];
  language: AppLanguage;
  editable?: boolean;
  onEdit?: (item: Homework) => void;
}

export function HomeworkList({ homework, lessons, language, editable, onEdit }: HomeworkListProps) {
  const rtl = isRtlLanguage(language);

  if (!homework.length) {
    return (
      <Text style={[styles.empty, rtl && styles.textRtl]}>
        {t(language, {
          ru: 'Домашних заданий пока нет',
          en: 'No homework yet',
          he: 'עדיין אין שיעורי בית',
        })}
      </Text>
    );
  }

  const lessonsById = new Map(lessons.map((lesson) => [lesson.id, lesson]));

  return (
    <View style={styles.container}>
      {homework
        .slice()
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .map((item) => {
          const lesson = lessonsById.get(item.lesson_id);
          return (
            <Pressable
              key={item.id}
              disabled={!editable}
              onPress={() => onEdit?.(item)}
              style={[styles.item, editable && styles.editableItem]}
            >
              <Text style={[styles.text, rtl && styles.textRtl]}>{item.text}</Text>
              <Text style={[styles.meta, rtl && styles.textRtl]}>
                {lesson
                  ? `${localizeLessonSubject(lesson.subject, language)} · ${formatDate(lesson.start_datetime, language)}`
                  : t(language, {
                      ru: 'Неизвестный урок',
                      en: 'Unknown lesson',
                      he: 'שיעור לא ידוע',
                    })}
              </Text>
              <Text style={[styles.meta, rtl && styles.textRtl]}>
                {t(language, {
                  ru: 'Источник',
                  en: 'Source',
                  he: 'מקור',
                })}
                :{' '}
                {item.source === 'photo_ocr'
                  ? t(language, {
                      ru: 'Фото + OCR',
                      en: 'Photo + OCR',
                      he: 'תמונה + OCR',
                    })
                  : t(language, {
                      ru: 'Вручную',
                      en: 'Manual',
                      he: 'ידני',
                    })}
              </Text>
              {item.attachments.length > 0 ? (
                <Text style={[styles.attachments, rtl && styles.textRtl]}>
                  {t(language, {
                    ru: 'Вложения',
                    en: 'Attachments',
                    he: 'קבצים מצורפים',
                  })}
                  : {item.attachments.length}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  empty: {
    color: '#6180a8',
    fontSize: 13,
  },
  item: {
    borderWidth: 1,
    borderColor: '#d7e1ef',
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#ffffff',
  },
  editableItem: {
    borderColor: '#0b2a53',
  },
  text: {
    color: '#0b2a53',
    fontWeight: '600',
    marginBottom: 4,
  },
  meta: {
    color: '#4f6587',
    fontSize: 12,
  },
  attachments: {
    color: '#245f2d',
    fontSize: 12,
    marginTop: 3,
  },
  textRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
  },
});
