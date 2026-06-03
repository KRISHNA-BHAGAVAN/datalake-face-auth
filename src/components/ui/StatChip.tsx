import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../theme';

interface Props {
  /** Small caps label above the value, e.g. "SPEED". */
  label: string;
  value: string;
  tone?: 'default' | 'primary' | 'success';
}

const valueColor = {
  default: colors.text,
  primary: colors.primary,
  success: colors.success,
};

/** Compact label/value chip used for benchmark + result metrics. */
export function StatChip({ label, value, tone = 'default' }: Props) {
  return (
    <View style={styles.chip}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color: valueColor[tone] }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.hairlineSoft,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: 4,
  },
  label: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: colors.textMuted },
  value: { fontSize: 18, fontWeight: '800' },
});
