import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { colors, elevation, hitTarget, radius } from '../../theme';
import { Icon, IconName } from './Icon';

interface Props {
  name: IconName;
  /** Required — an icon-only control is unusable to a screen reader without it. */
  accessibilityLabel: string;
  onPress?: () => void;
  /** `floating` sits over the camera preview and needs its own surface. */
  variant?: 'plain' | 'floating';
}

export function IconButton({ name, accessibilityLabel, onPress, variant = 'plain' }: Props) {
  const floating = variant === 'floating';
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      android_ripple={{ color: colors.border, borderless: true, radius: hitTarget / 2 }}
      style={({ pressed }) => [
        styles.base,
        floating && [styles.floating, elevation.level2],
        pressed && (floating ? styles.floatingPressed : styles.plainPressed),
      ]}
    >
      <Icon name={name} size="lg" color={floating ? colors.text : colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    width: hitTarget,
    height: hitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  floating: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  plainPressed: { backgroundColor: colors.primarySoft },
  floatingPressed: { backgroundColor: colors.surfacePressed },
});
