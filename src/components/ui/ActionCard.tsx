import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../../theme';

interface Props {
  glyph: string;
  title: string;
  subtitle: string;
  onPress?: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'success';
}

/** Large tappable card for the primary home actions (Enroll / Verify). */
export function ActionCard({ glyph, title, subtitle, onPress, disabled, tone = 'primary' }: Props) {
  const accent = tone === 'success' ? colors.success : colors.primary;
  const accentDim = tone === 'success' ? colors.successDim : colors.primaryDim;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.card,
        { borderColor: disabled ? colors.hairlineSoft : colors.hairline },
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: accentDim }]}>
        <Text style={[styles.glyph, { color: accent }]}>{glyph}</Text>
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <Text style={[styles.chevron, { color: accent }]}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { fontSize: 24 },
  textWrap: { flex: 1, gap: 3 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 13, fontWeight: '500', color: colors.textSecondary },
  chevron: { fontSize: 28, fontWeight: '400', marginTop: -2 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.45 },
});
