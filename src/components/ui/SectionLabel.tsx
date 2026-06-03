import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors, spacing } from '../../theme';

/** Uppercase section divider label. */
export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: -spacing.xs,
  },
});
