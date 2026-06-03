import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../../theme';

interface Props {
  children: React.ReactNode;
  /** "glass" = translucent, for layering over the camera. "solid" = opaque surface. */
  variant?: 'solid' | 'glass';
  /** Accent border tone. */
  tone?: 'default' | 'primary' | 'success' | 'danger';
  style?: ViewStyle;
}

const borderByTone = {
  default: colors.hairline,
  primary: colors.primary,
  success: colors.success,
  danger: colors.danger,
};

/** Rounded card with a faint accent border. The "glass" feel without iOS-only APIs. */
export function Card({ children, variant = 'solid', tone = 'default', style }: Props) {
  return (
    <View
      style={[
        styles.base,
        { backgroundColor: variant === 'glass' ? colors.surfaceTranslucent : colors.surface },
        { borderColor: borderByTone[tone] },
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
    borderWidth: 1,
    padding: spacing.lg,
  },
});
