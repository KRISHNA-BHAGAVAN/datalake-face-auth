import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { colors, hitTarget, radius, spacing, type } from '../../theme';
import { Icon, IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost';

interface Props {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  /** Screen-reader label when the title alone is ambiguous. */
  accessibilityLabel?: string;
  style?: ViewStyle;
}

const VARIANTS: Record<Variant, { bg: string; fg: string; border: string; pressedBg: string }> = {
  primary: {
    bg: colors.primary,
    fg: colors.onPrimary,
    border: colors.primary,
    pressedBg: colors.primaryHover,
  },
  secondary: {
    bg: colors.surface,
    fg: colors.text,
    border: colors.borderStrong,
    pressedBg: colors.surfacePressed,
  },
  destructive: {
    bg: colors.surface,
    fg: colors.danger,
    border: colors.dangerBorder,
    pressedBg: colors.dangerSoft,
  },
  ghost: {
    bg: 'transparent',
    fg: colors.primary,
    border: 'transparent',
    pressedBg: colors.primarySoft,
  },
};

/**
 * Pressed feedback is a background change rather than a transform, so the
 * button never shifts the layout around it.
 */
export function AppButton({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  accessibilityLabel,
  style,
}: Props) {
  const v = VARIANTS[variant];
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      android_ripple={{ color: colors.border }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: v.bg, borderColor: v.border },
        pressed && !isDisabled && { backgroundColor: v.pressedBg },
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} size="small" />
      ) : (
        <View style={styles.row}>
          {icon && <Icon name={icon} size="md" color={v.fg} />}
          <Text style={[type.bodyStrong, { color: v.fg }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: Math.max(hitTarget, 50),
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  disabled: { opacity: 0.4 },
});
