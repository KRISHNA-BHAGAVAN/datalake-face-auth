import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, type } from '../../theme';

interface Props {
  children: string;
  /** Right-aligned counterpart, e.g. a count or unit. */
  trailing?: string;
}

/** Header above a grouped list or card section. */
export function SectionLabel({ children, trailing }: Props) {
  return (
    <View style={styles.row}>
      <Text style={type.sectionHeader} accessibilityRole="header">
        {children}
      </Text>
      {trailing ? <Text style={type.caption}>{trailing}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.xxl,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
});
