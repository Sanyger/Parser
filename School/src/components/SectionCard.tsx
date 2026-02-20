import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

export function SectionCard({
  title,
  children,
  style,
}: {
  title: string;
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.title}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#dbe4f2',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0b2a53',
    marginBottom: 8,
  },
});
