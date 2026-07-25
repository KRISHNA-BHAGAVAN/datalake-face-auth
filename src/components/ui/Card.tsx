import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors, elevation, radius, spacing } from '../../theme';

interface Props {
  children: React.ReactNode;
  /** Tinted variants signal state. They are not decoration. */
  tone?: 'default' | 'accent' | 'success' | 'danger';
  /** Raise the card above the camera preview instead of the canvas. */
  floating?: boolean;
  /** Drop the internal padding when the card holds its own rows. */
  flush?: boolean;
  style?: ViewStyle;
}

const TONES = {
  default: { backgroundColor: colors.surface, borderColor: colors.border },
  accent: { backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder },
  success: { backgroundColor: colors.successSoft, borderColor: colors.successBorder },
  danger: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerBorder },
};

export function Card({ children, tone = 'default', floating, flush, style }: Props) {
  return (
    <View
      style={[
        styles.base,
        TONES[tone],
        !flush && styles.padded,
        floating ? elevation.level2 : elevation.level1,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  padded: { padding: spacing.lg },
});
