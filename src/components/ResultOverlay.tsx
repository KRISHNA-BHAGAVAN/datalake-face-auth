import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, motion, radius, spacing, type } from '../theme';
import { config } from '../utils/config';
import { AppButton } from './ui/AppButton';
import { Card } from './ui/Card';
import { DataRow } from './ui/List';
import { Icon } from './ui/Icon';
import { ConfidenceMeter } from './ConfidenceMeter';
import { BenchmarkBadge, BenchmarkMetrics } from './ui/BenchmarkBadge';
import { FaceMatchComparison } from './FaceMatchComparison';

interface Props {
  status: 'SUCCESS' | 'FAILED';
  title: string;
  message: string;
  /** Match score 0..1 (verify only). */
  confidence?: number | null;
  threshold?: number;
  /** End-to-end recognition time in ms (verify only). */
  latencyMs?: number | null;
  benchmarkMetrics?: BenchmarkMetrics | null;
  matchedImageUri?: string | null;
  probeImageUri?: string | null;
  capturedFrameUris?: string[];
  onRetry?: () => void;
  onDone: () => void;
}

/**
 * Result sheet covering the preview. Outcome first, then evidence, then the way
 * out — with the actions pinned to the bottom so the thumb always lands in the
 * same place whether or not metrics are shown.
 */
export function ResultOverlay({
  status,
  title,
  message,
  confidence,
  threshold = config.recognition.cosineSimilarityThreshold,
  latencyMs,
  benchmarkMetrics,
  matchedImageUri,
  probeImageUri,
  capturedFrameUris,
  onRetry,
  onDone,
}: Props) {
  const enter = useRef(new Animated.Value(0)).current;
  const success = status === 'SUCCESS';
  const accent = success ? colors.success : colors.danger;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: motion.base,
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });

  return (
    <View style={styles.overlay}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Animated.View style={[styles.body, { opacity: enter, transform: [{ translateY }] }]}>
          <View
            style={[
              styles.statusIcon,
              { backgroundColor: success ? colors.successSoft : colors.dangerSoft },
            ]}
          >
            <Icon name={success ? 'check' : 'close'} size="xl" color={accent} />
          </View>

          <View style={styles.copy}>
            <Text style={[type.title, { color: accent, textAlign: 'center' }]} accessibilityRole="header">
              {title}
            </Text>
            <Text style={[type.secondary, styles.message]}>{message}</Text>
          </View>

          {/* Face match evidence comparison OR 3-frame enrollment burst */}
          {(matchedImageUri || probeImageUri || (capturedFrameUris && capturedFrameUris.length > 0)) && (
            <FaceMatchComparison
              matchedImageUri={matchedImageUri}
              probeImageUri={probeImageUri}
              capturedFrameUris={capturedFrameUris}
            />
          )}

          {(confidence != null || latencyMs != null || benchmarkMetrics != null) && (
            <Card style={styles.metrics}>
              {confidence != null && <ConfidenceMeter value={confidence} threshold={threshold} />}
              <BenchmarkBadge metrics={benchmarkMetrics || null} latencyMs={latencyMs} />
            </Card>
          )}
        </Animated.View>

        <View style={styles.actions}>
          {!success && onRetry && <AppButton title="Try again" icon="retry" onPress={onRetry} />}
          <AppButton title="Done" variant={success ? 'primary' : 'secondary'} onPress={onDone} />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlayScrim,
    zIndex: 40,
  },
  safe: { flex: 1, paddingHorizontal: spacing.lg },
  body: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xl,
  },
  statusIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { gap: spacing.xs, alignItems: 'center' },
  message: { textAlign: 'center', maxWidth: 320 },
  metrics: { alignSelf: 'stretch', gap: spacing.lg },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  actions: { gap: spacing.md, paddingBottom: spacing.lg },
});

