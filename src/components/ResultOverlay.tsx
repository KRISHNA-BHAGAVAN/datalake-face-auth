import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import { AppButton } from './ui/AppButton';
import { StatChip } from './ui/StatChip';
import { ConfidenceMeter } from './ConfidenceMeter';

interface Props {
  status: 'SUCCESS' | 'FAILED';
  title: string;
  message: string;
  /** Match score 0..1 (verify only). */
  confidence?: number | null;
  threshold?: number;
  /** End-to-end recognition time in ms (verify only). */
  latencyMs?: number | null;
  onRetry?: () => void;
  onDone: () => void;
}

/** Full-screen result: animated ✓/✗ badge, optional confidence + speed metrics. */
export function ResultOverlay({
  status,
  title,
  message,
  confidence,
  threshold = 0.65,
  latencyMs,
  onRetry,
  onDone,
}: Props) {
  const pop = useRef(new Animated.Value(0)).current;
  const success = status === 'SUCCESS';
  const accent = success ? colors.success : colors.danger;

  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }).start();
  }, [pop]);

  const scale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  const showMetrics = confidence != null;
  const underSecond = latencyMs != null && latencyMs <= 1000;

  return (
    <View style={styles.overlay}>
      <Animated.View style={[styles.badge, { borderColor: accent, transform: [{ scale }] }]}>
        <Text style={[styles.badgeGlyph, { color: accent }]}>{success ? '✓' : '✕'}</Text>
      </Animated.View>

      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>

      {showMetrics && (
        <View style={styles.metrics}>
          <ConfidenceMeter value={confidence as number} threshold={threshold} />
          {latencyMs != null && (
            <View style={styles.chips}>
              <StatChip
                label="SPEED"
                value={`${(latencyMs / 1000).toFixed(2)}s`}
                tone={underSecond ? 'success' : 'default'}
              />
              <StatChip label="MODE" value="Offline" tone="primary" />
            </View>
          )}
          {underSecond && <Text style={styles.fast}>⚡ Under the 1-second target</Text>}
        </View>
      )}

      <View style={styles.actions}>
        {!success && onRetry && <AppButton title="Try Again" glyph="↻" onPress={onRetry} />}
        <AppButton
          title="Done"
          variant={success ? 'primary' : 'secondary'}
          onPress={onDone}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(6, 9, 14, 0.94)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
    zIndex: 40,
  },
  badge: {
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  badgeGlyph: { fontSize: 52, fontWeight: '800', lineHeight: 58 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' },
  message: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  metrics: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  chips: { flexDirection: 'row', gap: spacing.md },
  fast: { fontSize: 13, fontWeight: '700', color: colors.success, textAlign: 'center' },
  actions: { width: '100%', gap: spacing.md, marginTop: spacing.sm },
});
