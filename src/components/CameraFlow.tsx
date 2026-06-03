import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraType } from 'expo-camera';
import { CameraPreview } from '../camera/CameraPreview';
import { useFaceAuth } from '../hooks/useFaceAuth';
import { config } from '../utils/config';
import { colors, radius, spacing } from '../theme';
import { ChallengeCard } from './ChallengeCard';
import { ScanOverlay } from './ScanOverlay';
import { ResultOverlay } from './ResultOverlay';

interface Props {
  mode: 'ENROLL' | 'VERIFY';
}

// Must match the challenge lists started in useFaceAuth (enroll: 3, verify: 1).
const TOTAL_CHALLENGES = { ENROLL: 3, VERIFY: 1 } as const;

/** Shared camera experience for enrollment and verification. */
export function CameraFlow({ mode }: Props) {
  const router = useRouter();
  const {
    livenessState,
    authStatus,
    message,
    isProcessing,
    confidence,
    latencyMs,
    cameraRef,
    startEnrollment,
    startVerification,
    reset,
  } = useFaceAuth();

  const [facing, setFacing] = useState<CameraType>('front');
  const toggleFacing = () => setFacing((f) => (f === 'front' ? 'back' : 'front'));

  const start = mode === 'ENROLL' ? startEnrollment : startVerification;

  // Start once on mount; reset on unmount. Empty deps so the liveness challenge
  // sequence is not restarted on every render.
  useEffect(() => {
    start();
    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = authStatus === 'SUCCESS' || authStatus === 'FAILED';
  const livenessStatus = livenessState.status;

  const accent =
    livenessStatus === 'PASSED' ? colors.success : livenessStatus === 'FAILED' ? colors.danger : colors.primary;
  const scanning = !done && livenessStatus !== 'PASSED' && livenessStatus !== 'FAILED';

  const resultTitle =
    authStatus === 'SUCCESS'
      ? mode === 'ENROLL'
        ? 'Enrolled'
        : 'Verified'
      : 'Not Verified';

  return (
    <View style={styles.container}>
      <CameraPreview ref={cameraRef} facing={facing} />

      <ScanOverlay accent={accent} scanning={scanning} />

      {!done && (
        <Pressable
          style={({ pressed }) => [styles.flipBtn, pressed && styles.flipPressed]}
          hitSlop={10}
          onPress={toggleFacing}
        >
          <Text style={styles.flipGlyph}>⟲</Text>
          <Text style={styles.flipLabel}>{facing === 'front' ? 'Front' : 'Back'}</Text>
        </Pressable>
      )}

      {!done && (
        <View style={styles.top} pointerEvents="none">
          <ChallengeCard state={livenessState} total={TOTAL_CHALLENGES[mode]} />
        </View>
      )}

      {!done && isProcessing && (
        <View style={styles.processing} pointerEvents="none">
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.processingText}>Analyzing frame…</Text>
        </View>
      )}

      {done && (
        <ResultOverlay
          status={authStatus as 'SUCCESS' | 'FAILED'}
          title={resultTitle}
          message={message}
          confidence={mode === 'VERIFY' ? confidence : null}
          latencyMs={mode === 'VERIFY' ? latencyMs : null}
          threshold={config.recognition.cosineSimilarityThreshold}
          onRetry={() => {
            reset();
            start();
          }}
          onDone={() => router.back()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  top: { position: 'absolute', top: spacing.xxxl, left: spacing.lg, right: spacing.lg, zIndex: 20 },
  processing: {
    position: 'absolute',
    bottom: spacing.xxxl,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceTranslucent,
    borderColor: colors.hairline,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    zIndex: 20,
  },
  processingText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  flipBtn: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surfaceTranslucent,
    borderColor: colors.hairline,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    zIndex: 25,
  },
  flipPressed: { opacity: 0.7 },
  flipGlyph: { color: colors.primary, fontSize: 20, fontWeight: '700' },
  flipLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
});
