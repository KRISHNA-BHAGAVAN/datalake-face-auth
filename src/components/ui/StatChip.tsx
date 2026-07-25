import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type } from '../../theme';
import { Icon, IconName } from './Icon';

interface Props {
  label: string;
  value: string;
  icon?: IconName;
}

/**
 * Compact metric tile for side-by-side specs. Label first, value second — the
 * label anchors the reading order, the tabular value carries the weight.
 */
export function StatChip({ label, value, icon }: Props) {
  return (
    <View style={styles.tile}>
      {icon && <Icon name={icon} size="md" color={colors.textTertiary} />}
      <Text style={type.fieldLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={type.metricSm}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minWidth: 92,
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
});
