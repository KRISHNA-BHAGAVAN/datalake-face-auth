import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../theme';

type Tone = 'neutral' | 'accent' | 'success' | 'danger' | 'warning';

interface Props {
  label: string;
  tone?: Tone;
}

const TONES: Record<Tone, { bg: string; fg: string; border: string }> = {
  neutral: { bg: colors.surfaceSunken, fg: colors.textSecondary, border: colors.border },
  accent: { bg: colors.primarySoft, fg: colors.primary, border: colors.primaryBorder },
  success: { bg: colors.successSoft, fg: colors.success, border: colors.successBorder },
  danger: { bg: colors.dangerSoft, fg: colors.danger, border: colors.dangerBorder },
  warning: { bg: colors.warningSoft, fg: colors.warning, border: colors.warningBorder },
};

/**
 * Count or status pill. Sentence case — a badge is read, not shouted, so the
 * label carries the meaning without relying on colour alone.
 */
export function Badge({ label, tone = 'neutral' }: Props) {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Text style={[styles.label, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingVertical: 3,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
