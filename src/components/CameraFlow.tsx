import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Camera } from 'react-native-vision-camera';
import { useFaceAuthVision } from '../hooks/useFaceAuthVision';
import { config } from '../utils/config';
import { colors, radius, spacing, type } from '../theme';
import { AppButton } from './ui/AppButton';
import { Icon, IconName } from './ui/Icon';
import { IconButton } from './ui/IconButton';
import { ChallengeCard } from './ChallengeCard';
import { ScanOverlay } from './ScanOverlay';
import { ResultOverlay } from './ResultOverlay';

interface Props {
  mode: 'ENROLL' | 'VERIFY';
}

// Must match the challenge lists started in useFaceAuthVision (enroll: 3, verify: 1).
const TOTAL_CHALLENGES = { ENROLL: 3, VERIFY: 1 } as const;

/** Shared VisionCamera experience for enrollment and verification. */
export function CameraFlow({ mode }: Props) {
  const router = useRouter();
  const {
    livenessState,
    authStatus,
    message,
    isProcessing,
    subscribeCapture,
    confidence,
    latencyMs,
    benchmarkMetrics,
    matchedImageUri,
    probeImageUri,
    capturedFrameUris,
    modelsReady,
    modelError,
    device,
    hasPermission,
    requestPermission,
    facing,
    toggleFacing,
    isActive,
    faceOutput,
    photoOutput,
    startEnrollment,
    startVerification,
    reset,
  } = useFaceAuthVision();

  const start = mode === 'ENROLL' ? startEnrollment : startVerification;
  const startedRef = useRef(false);

  // Reset on unmount. The flow itself starts only after the native camera and
  // ML models are ready, so the liveness timeout does not run during startup.
  useEffect(() => {
    return () => reset();
  }, [reset]);

  useEffect(() => {
    if (startedRef.current || !hasPermission || !device || !modelsReady || modelError) return;
    startedRef.current = true;
    start();
  }, [device, hasPermission, modelError, modelsReady, start]);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const outputs = useMemo(() => [faceOutput, photoOutput], [faceOutput, photoOutput]);

  const done = authStatus === 'SUCCESS' || authStatus === 'FAILED';
  const livenessStatus = livenessState.status;
  const resolved =
    livenessStatus === 'PASSED' ? 'success' : livenessStatus === 'FAILED' ? 'danger' : null;
  const scanning = !done && resolved === null;
  const cameraReady = hasPermission && device && modelsReady && !modelError;

  const isDuplicateEnroll = message.includes('Already enrolled');
  const resultTitle =
    authStatus === 'SUCCESS'
      ? isDuplicateEnroll
        ? 'Already Enrolled'
        : mode === 'ENROLL'
        ? 'Enrolled'
        : 'Verified'
      : 'Not verified';

  return (
    <View style={styles.container}>
      {hasPermission && device ? (
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={isActive}
          outputs={outputs}
        />
      ) : null}

      {cameraReady && (
        <ScanOverlay
          resolved={resolved}
          scanning={scanning}
          subscribeCapture={subscribeCapture}
          currentChallenge={livenessState.currentChallenge}
        />
      )}

      {/* Blocking states get the canvas rather than a dark scrim, so the whole
          app reads as one light surface. */}
      {!cameraReady && (
        <View style={[StyleSheet.absoluteFill, styles.blocking]}>
          {!hasPermission ? (
            <Gate
              icon="camera"
              title="Camera access needed"
              body="Face authentication runs entirely on this device. The camera feed is never uploaded."
              action={<AppButton title="Allow camera access" onPress={requestPermission} />}
            />
          ) : !device ? (
            <Gate
              icon="flipCamera"
              title="No camera available"
              body={`This device has no ${facing} camera. Try the other one.`}
              action={
                <AppButton
                  title={`Use the ${facing === 'front' ? 'back' : 'front'} camera`}
                  variant="secondary"
                  onPress={toggleFacing}
                />
              }
            />
          ) : modelError ? (
            /* No action: nothing here is retryable, and Cancel is already
               reachable in the corner. */
            <Gate icon="antiSpoof" tone="danger" title="Face engine unavailable" body={modelError} />
          ) : (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <Text style={type.secondary}>Preparing face engine</Text>
            </View>
          )}
        </View>
      )}

      {/* Controls pin to the top, the instruction card to the bottom, with a
          flexible spacer between — the face frame occupies the middle and
          nothing can overlap it regardless of card height or device size. */}
      {!done && (
        <SafeAreaView style={styles.chrome} edges={['top', 'bottom']} pointerEvents="box-none">
          <View style={styles.controls} pointerEvents="box-none">
            <IconButton
              name="close"
              accessibilityLabel="Cancel and go back"
              variant="floating"
              onPress={() => router.back()}
            />
            {cameraReady && <FlipCameraButton facing={facing} onPress={toggleFacing} />}
          </View>

          <View style={styles.spacer} pointerEvents="none" />

          {cameraReady && (
            <View style={styles.prompt} pointerEvents="none">
              <ChallengeCard
                state={livenessState}
                message={message}
                total={TOTAL_CHALLENGES[mode]}
                processing={isProcessing}
                subscribeCapture={subscribeCapture}
              />
            </View>
          )}
        </SafeAreaView>
      )}

      {done && (
        <ResultOverlay
          status={authStatus as 'SUCCESS' | 'FAILED'}
          title={resultTitle}
          message={message}
          confidence={confidence}
          latencyMs={latencyMs}
          benchmarkMetrics={benchmarkMetrics}
          matchedImageUri={matchedImageUri}
          probeImageUri={probeImageUri}
          capturedFrameUris={capturedFrameUris}
          threshold={config.recognition.cosineSimilarityThreshold}
          onRetry={() => {
            reset();
            startedRef.current = true;
            start();
          }}
          onDone={() => router.back()}
        />
      )}
    </View>
  );
}

/** Flip-camera control that spins a half turn on every press — a tactile echo
 * of the action, not just an instant facing swap. Turns accumulate, so a rapid
 * double-tap keeps spinning forward rather than snapping back. */
function FlipCameraButton({
  facing,
  onPress,
}: {
  facing: 'front' | 'back';
  onPress: () => void;
}) {
  const spin = useRef(new Animated.Value(0)).current;
  const turns = useRef(0);

  const handlePress = () => {
    turns.current += 1;
    Animated.spring(spin, {
      toValue: turns.current,
      friction: 7,
      tension: 55,
      useNativeDriver: true,
    }).start();
    onPress();
  };

  // Extrapolates linearly past the [0,1] pair, so each additional turn keeps
  // adding another 180deg rather than wrapping back to the start.
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });

  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <IconButton
        name="flipCamera"
        accessibilityLabel={`Switch to ${facing === 'front' ? 'back' : 'front'} camera`}
        variant="floating"
        onPress={handlePress}
      />
    </Animated.View>
  );
}

/** Permission / failure state: explain, then offer the one useful action. */
function Gate({
  icon,
  title,
  body,
  tone = 'accent',
  action,
}: {
  icon: IconName;
  title: string;
  body: string;
  tone?: 'accent' | 'danger';
  action?: React.ReactNode;
}) {
  const danger = tone === 'danger';
  return (
    <View style={styles.gate}>
      <View
        style={[
          styles.gateIcon,
          { backgroundColor: danger ? colors.dangerSoft : colors.primarySoft },
        ]}
      >
        <Icon name={icon} size="xl" color={danger ? colors.danger : colors.primary} />
      </View>
      <Text style={[type.title, styles.centered]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[type.secondary, styles.centered]}>{body}</Text>
      {action && <View style={styles.gateAction}>{action}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  blocking: { backgroundColor: colors.canvas, zIndex: 30 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: spacing.md },
  gate: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xxl,
  },
  gateIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  gateAction: { alignSelf: 'stretch', marginTop: spacing.lg },
  centered: { textAlign: 'center' },
  // Above the blocking layer: Cancel must stay reachable while models load.
  chrome: { ...StyleSheet.absoluteFill, zIndex: 35 },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  spacer: { flex: 1 },
  // Sits in the clear band below the face frame.
  prompt: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
});
