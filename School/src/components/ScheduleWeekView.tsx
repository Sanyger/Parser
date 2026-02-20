import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isRtlLanguage, lessonTypeName, t, weekDayName } from '../lib/i18n';
import { getDayIndexInJerusalem, formatDate, formatTime, WEEK_DAYS } from '../lib/time';
import { AppLanguage, Lesson } from '../types/models';

interface ScheduleWeekViewProps {
  lessons: Lesson[];
  language: AppLanguage;
  onSelectLesson?: (lesson: Lesson) => void;
}

function lessonRange(lesson: Lesson, language: AppLanguage): string {
  return `${formatTime(lesson.start_datetime, language)}-${formatTime(lesson.end_datetime, language)}`;
}

export function ScheduleWeekView({ lessons, language, onSelectLesson }: ScheduleWeekViewProps) {
  const rtl = isRtlLanguage(language);

  const lessonsByDay = useMemo(() => {
    const grouped = new Map<number, Lesson[]>();
    for (const day of WEEK_DAYS) {
      grouped.set(day.key, []);
    }

    for (const lesson of lessons) {
      const dayKey = getDayIndexInJerusalem(lesson.start_datetime);
      const dayEntries = grouped.get(dayKey) ?? [];
      dayEntries.push(lesson);
      grouped.set(dayKey, dayEntries);
    }

    for (const day of WEEK_DAYS) {
      const sorted = (grouped.get(day.key) ?? []).sort(
        (left, right) =>
          new Date(left.start_datetime).getTime() - new Date(right.start_datetime).getTime(),
      );
      grouped.set(day.key, sorted);
    }

    return grouped;
  }, [lessons]);

  return (
    <View style={[styles.container, rtl && styles.containerRtl]}>
      {WEEK_DAYS.map((day) => {
        const dayLessons = lessonsByDay.get(day.key) ?? [];
        const consumed = new Set<string>();

        return (
          <View
            key={day.key}
            style={[styles.dayCard, !day.enabled && styles.dayCardDisabled]}
          >
            <View style={[styles.dayHeaderRow, rtl && styles.dayHeaderRowRtl]}>
              <Text style={[styles.dayLabel, !day.enabled && styles.disabledText]}>
                {weekDayName(day.key, language)}
              </Text>
              {dayLessons[0] ? (
                <Text style={[styles.dayDate, !day.enabled && styles.disabledText]}>
                  {formatDate(dayLessons[0].start_datetime, language)}
                </Text>
              ) : null}
            </View>

            {!day.enabled ? (
              <Text style={styles.disabledHint}>
                {t(language, {
                  ru: 'Выходной (обучение отключено)',
                  en: 'No school (disabled)',
                  he: 'אין לימודים (מושבת)',
                })}
              </Text>
            ) : dayLessons.length === 0 ? (
              <Text style={styles.emptyText}>
                {t(language, {
                  ru: 'Нет уроков',
                  en: 'No lessons',
                  he: 'אין שיעורים',
                })}
              </Text>
            ) : (
              dayLessons.map((lesson) => {
                if (consumed.has(lesson.id)) {
                  return null;
                }

                if (lesson.status === 'changed' && lesson.original_reference_id) {
                  return null;
                }

                if (lesson.status === 'canceled') {
                  const replacement = dayLessons.find(
                    (candidate) =>
                      candidate.status === 'changed' && candidate.original_reference_id === lesson.id,
                  );

                  if (replacement) {
                    consumed.add(replacement.id);
                    return (
                      <Pressable
                        key={lesson.id}
                        onPress={() => onSelectLesson?.(replacement)}
                        style={styles.lessonChangedWrapper}
                      >
                        <Text style={styles.rangeText}>{lessonRange(lesson, language)}</Text>
                        <Text style={styles.lessonCanceledText}>
                          {lesson.subject} ({lesson.room})
                        </Text>
                        <Text style={styles.arrowText}>
                          {t(language, {
                            ru: '↓ Изменено на',
                            en: '↓ Changed to',
                            he: '↓ שונה ל־',
                          })}
                        </Text>
                        <Text style={styles.lessonChangedText}>
                          {replacement.subject} ({replacement.room})
                        </Text>
                        <Text style={styles.reasonText}>{replacement.change_reason ?? ''}</Text>
                      </Pressable>
                    );
                  }
                }

                return (
                  <Pressable
                    key={lesson.id}
                    onPress={() => onSelectLesson?.(lesson)}
                    style={styles.lessonRow}
                  >
                    <Text style={styles.rangeText}>{lessonRange(lesson, language)}</Text>
                    <Text style={styles.lessonText}>
                      {lesson.subject} ({lesson.room})
                    </Text>
                    {lesson.type !== 'lesson' ? (
                      <Text style={styles.typeChip}>{lessonTypeName(lesson.type, language)}</Text>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  containerRtl: {
    direction: 'rtl',
  },
  dayCard: {
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#d7e2f0',
    backgroundColor: '#fbfcff',
  },
  dayCardDisabled: {
    backgroundColor: '#f0f1f4',
    borderColor: '#dadde3',
  },
  dayHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  dayHeaderRowRtl: {
    flexDirection: 'row-reverse',
  },
  dayLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#14325a',
  },
  dayDate: {
    fontSize: 12,
    color: '#345887',
  },
  disabledText: {
    color: '#8d94a1',
  },
  disabledHint: {
    color: '#8d94a1',
    fontSize: 12,
  },
  emptyText: {
    color: '#6480a6',
    fontSize: 12,
  },
  lessonRow: {
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: '#e5ecf6',
  },
  lessonChangedWrapper: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5ecf6',
  },
  rangeText: {
    color: '#1f416f',
    fontSize: 12,
    marginBottom: 2,
  },
  lessonText: {
    color: '#0b2a53',
    fontWeight: '600',
  },
  lessonCanceledText: {
    color: '#687b98',
    textDecorationLine: 'line-through',
  },
  lessonChangedText: {
    color: '#0f6e35',
    fontWeight: '700',
  },
  arrowText: {
    color: '#1f416f',
    fontSize: 12,
    marginVertical: 2,
  },
  reasonText: {
    color: '#4f5f78',
    fontSize: 12,
    marginTop: 2,
  },
  typeChip: {
    marginTop: 3,
    fontSize: 11,
    color: '#7a4a00',
  },
});
