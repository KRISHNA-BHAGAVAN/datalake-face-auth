import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, motion, radius, spacing, type } from '../theme';

interface Props {
  /** Match score 0..1. */
  value: number;
  /** Pass threshold 0..1, drawn as a marker on the track. */
  threshold: number;
}

/**
 * Match score against the pass threshold. The threshold marker is what makes
 * the number meaningful — a bare percentage tells the user nothing about
 * whether it was close.
 */
export function ConfidenceMeter({ value, threshold }: Props) {
  const fill = useRef(new Animated.Value(0)).current;
  const clamped = Math.max(0, Math.min(1, value));
  const pass = value >= threshold;
  const accent = pass ? colors.success : colors.danger;

  useEffect(() => {
    Animated.timing(fill, {
      toValue: clamped,
      duration: motion.slow,
      useNativeDriver: false,
    }).start();
  }, [clamped, fill]);

  const width = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View
      style={styles.wrap}
      accessibilityRole="progressbar"
      accessibilityLabel={`Match score ${Math.round(clamped * 100)} percent, ${
        pass ? 'above' : 'below'
      } the ${Math.round(threshold * 100)} percent threshold`}
    >
      <View style={styles.labelRow}>
        <Text style={type.secondary}>Match score</Text>
        <Text style={[styles.value, { color: accent }]}>{Math.round(clamped * 100)}%</Text>
      </View>

      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width, backgroundColor: accent }]} />
        <View style={[styles.marker, { left: `${threshold * 100}%` }]} />
      </View>

      <Text style={type.caption}>Passes at {Math.round(threshold * 100)}%</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  value: { fontSize: 22, lineHeight: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    justifyContent: 'center',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: radius.pill },
  marker: {
    position: 'absolute',
    top: -3,
    width: 2,
    height: 14,
    borderRadius: 1,
    backgroundColor: colors.textSecondary,
  },
});
