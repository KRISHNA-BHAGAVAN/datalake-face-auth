import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, elevation, radius, spacing, type } from '../../theme';
import { Icon, IconName } from './Icon';

interface Props {
  icon: IconName;
  title: string;
  subtitle: string;
  onPress?: () => void;
  disabled?: boolean;
  /** The screen's single most likely next step gets the filled treatment. */
  emphasis?: 'filled' | 'outlined';
}

/**
 * Primary task entry point. Only one filled card per screen — the emphasis is
 * what tells a first-time user where to start.
 */
export function ActionCard({ icon, title, subtitle, onPress, disabled, emphasis = 'outlined' }: Props) {
  const filled = emphasis === 'filled' && !disabled;

  const fg = filled ? colors.onPrimary : colors.text;
  const subFg = filled ? 'rgba(255,255,255,0.82)' : colors.textSecondary;
  const iconFg = filled ? colors.onPrimary : colors.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityState={{ disabled: !!disabled }}
      android_ripple={{ color: filled ? colors.primaryHover : colors.surfacePressed }}
      style={({ pressed }) => [
        styles.card,
        filled
          ? { backgroundColor: colors.primary, borderColor: colors.primary }
          : { backgroundColor: colors.surface, borderColor: colors.border },
        pressed && !disabled && (filled ? styles.pressedFilled : styles.pressedPlain),
        disabled && styles.disabled,
        elevation.level1,
      ]}
    >
      <View
        style={[
          styles.iconWrap,
          { backgroundColor: filled ? 'rgba(255,255,255,0.16)' : colors.primarySoft },
        ]}
      >
        <Icon name={icon} size="lg" color={disabled ? colors.textTertiary : iconFg} />
      </View>

      <View style={styles.text}>
        <Text style={[type.heading, { color: fg }]}>{title}</Text>
        <Text style={[type.caption, { color: subFg }]} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>

      <Icon name="chevron" size="md" color={filled ? 'rgba(255,255,255,0.7)' : colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  pressedFilled: { backgroundColor: colors.primaryHover },
  pressedPlain: { backgroundColor: colors.surfacePressed },
  disabled: { opacity: 0.45 },
});
