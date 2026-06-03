import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../theme';

type Tone = 'success' | 'primary' | 'danger' | 'warn' | 'muted';

interface Props {
  label: string;
  tone?: Tone;
  /** Show a leading status dot. */
  dot?: boolean;
}

const toneColor: Record<Tone, string> = {
  success: colors.success,
  primary: colors.primary,
  danger: colors.danger,
  warn: colors.warn,
  muted: colors.textMuted,
};

const toneBg: Record<Tone, string> = {
  success: colors.successDim,
  primary: colors.primaryDim,
  danger: colors.dangerDim,
  warn: 'rgba(255, 200, 87, 0.12)',
  muted: 'rgba(255,255,255,0.06)',
};

/** Small status pill, e.g. "OFFLINE READY". */
export function Badge({ label, tone = 'muted', dot = true }: Props) {
  const c = toneColor[tone];
  return (
    <View style={[styles.badge, { backgroundColor: toneBg[tone] }]}>
      {dot && <View style={[styles.dot, { backgroundColor: c }]} />}
      <Text style={[styles.label, { color: c }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs + 2,
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
});
