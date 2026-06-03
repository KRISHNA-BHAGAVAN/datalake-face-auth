import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';

interface Props {
  /** Match score 0..1. */
  value: number;
  /** Pass threshold 0..1, drawn as a tick on the track. */
  threshold: number;
}

/** Horizontal match-confidence meter with a threshold marker (no SVG dep). */
export function ConfidenceMeter({ value, threshold }: Props) {
  const fill = useRef(new Animated.Value(0)).current;
  const pct = Math.round(value * 100);
  const pass = value >= threshold;
  const accent = pass ? colors.success : colors.danger;

  useEffect(() => {
    Animated.timing(fill, {
      toValue: Math.max(0, Math.min(1, value)),
      duration: 700,
      useNativeDriver: false,
    }).start();
  }, [value, fill]);

  const widthInterp = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>MATCH CONFIDENCE</Text>
        <Text style={[styles.pct, { color: accent }]}>{pct}%</Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width: widthInterp, backgroundColor: accent }]} />
        <View style={[styles.threshTick, { left: `${threshold * 100}%` }]} />
      </View>
      <Text style={styles.threshLabel}>
        Pass threshold {Math.round(threshold * 100)}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: spacing.sm },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.textMuted },
  pct: { fontSize: 26, fontWeight: '800' },
  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.hairlineSoft,
    overflow: 'visible',
    justifyContent: 'center',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: radius.pill },
  threshTick: {
    position: 'absolute',
    top: -3,
    width: 2,
    height: 16,
    backgroundColor: colors.text,
    opacity: 0.7,
  },
  threshLabel: { fontSize: 11, color: colors.textMuted, fontWeight: '500' },
});
