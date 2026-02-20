import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { roleNameById } from '../lib/i18n';
import { RoleId, User } from '../types/models';

export function effectiveRoleId(user: User): RoleId {
  if (user.role_id === 3 && user.is_homeroom) {
    return 2;
  }
  return user.role_id;
}

export function roleName(user: User): string {
  return roleNameById(effectiveRoleId(user), user.preferred_language);
}

export function RoleLabel({ user }: { user: User }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.text}>{roleName(user)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#0b2a53',
  },
  text: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
});
