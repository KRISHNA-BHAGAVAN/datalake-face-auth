import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type } from '../theme';
import { LivenessChallengeType, LivenessState } from '../types';
import { Card } from './ui/Card';
import { Icon, IconName } from './ui/Icon';

interface Props {
  state: LivenessState;
  /** Active status / quality feedback message from useFaceAuthVision. */
  message?: string;
  /** Total challenges in this run, used for the step counter and progress bar. */
  total: number;
  /** Recognition is running. Replaces the instruction rather than stacking on it. */
  processing?: boolean;
  /**
   * Subscribe to shutter events, so the working indicator ticks on each real
   * photo. A subscription rather than a prop value on purpose — re-rendering the
   * camera owner mid-burst rebinds the capture session.
   */
  subscribeCapture?: (fn: () => void) => () => void;
}

const CHALLENGE_COPY: Record<LivenessChallengeType, { icon: IconName; text: string }> = {
  BLINK: { icon: 'liveness', text: 'Blink your eyes' },
  SMILE: { icon: 'smile', text: 'Smile' },
  TURN_HEAD_LEFT: { icon: 'turnLeft', text: 'Turn your head left' },
  TURN_HEAD_RIGHT: { icon: 'turnRight', text: 'Turn your head right' },
};

/**
 * Instruction card above the face frame. Progress first, then the one thing to
 * do right now — a person mid-task can only act on a single instruction.
 *
 * Every animation here answers a state change that already happened (a step
 * completed, the instruction changed, recognition started) rather than
 * running on a timer for its own sake.
 */
export function ChallengeCard({ state, message, total, processing, subscribeCapture }: Props) {
  const { status, currentChallenge, challengesRemaining, message: stateMessage } = state;

  const stepsLeft = challengesRemaining.length + (currentChallenge ? 1 : 0);
  const completed = status === 'PASSED' ? total : Math.max(0, total - stepsLeft);

  const passed = status === 'PASSED';
  const copy = currentChallenge && !passed ? CHALLENGE_COPY[currentChallenge] : null;
  const headline = processing
    ? 'Matching your face'
    : passed
      ? 'Liveness confirmed'
      : (copy?.text ?? stateMessage ?? 'Center your face in the frame');

  // Subtext guidance / feedback (quality checks, missing face, hold steady, etc.)
  const rawFeedback = message || stateMessage;
  const cleanFeedback = rawFeedback
    ? rawFeedback.replace(/^Good!\s*Now,\s*/i, '').replace(/^Please\s+/i, '')
    : null;

  const isDistinct =
    cleanFeedback &&
    cleanFeedback.toLowerCase() !== headline.toLowerCase() &&
    !headline.toLowerCase().includes(cleanFeedback.toLowerCase());

  const subHeadline = processing
    ? (isDistinct ? cleanFeedback : 'Hold steady during capture')
    : passed
      ? 'Processing biometric template...'
      : (isDistinct ? cleanFeedback : null);

  const isWarning =
    subHeadline &&
    /no face|dark|bright|steady|closer|level|camera|timeout|failed|attack/i.test(subHeadline);

  // One Animated.Value per progress segment: 0 = pending, 0.5 = active (the
  // step in progress right now), 1 = done. Driving fill + colour off the same
  // value keeps the two in lockstep with no separate timing to desync.
  const fills = useRef(Array.from({ length: total }, () => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.parallel(
      fills.map((v, i) => {
        const target = i < completed ? 1 : i === completed && status === 'IN_PROGRESS' ? 0.5 : 0;
        return Animated.spring(v, {
          toValue: target,
          friction: 9,
          tension: 70,
          useNativeDriver: false, // width + backgroundColor aren't native-driver props
        });
      })
    ).start();
  }, [completed, status, fills]);

  // Headline crossfade + rise whenever the instruction text actually changes —
  // visible for step-to-step transitions, invisible on re-renders that don't
  // change what's being asked of the user.
  const headlineAnim = useRef(new Animated.Value(1)).current;
  const prevHeadline = useRef(headline);
  useEffect(() => {
    if (prevHeadline.current === headline) return;
    prevHeadline.current = headline;
    headlineAnim.setValue(0);
    Animated.timing(headlineAnim, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [headline, headlineAnim]);

  // Checkmark pops in once, exactly on the pass transition.
  const checkScale = useRef(new Animated.Value(1)).current;
  const wasPassed = useRef(passed);
  useEffect(() => {
    if (passed && !wasPassed.current) {
      checkScale.setValue(0.4);
      Animated.spring(checkScale, {
        toValue: 1,
        friction: 4.5,
        tension: 160,
        useNativeDriver: true,
      }).start();
    }
    wasPassed.current = passed;
  }, [passed, checkScale]);

  return (
    <Card floating style={styles.card}>
      <View style={styles.progressRow}>
        <View style={styles.track}>
          {fills.map((v, i) => (
            <View key={i} style={[styles.segment, total === 1 && styles.segmentWide]}>
              <Animated.View
                style={[
                  styles.segmentFill,
                  {
                    width: v.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: ['0%', '55%', '100%'],
                    }),
                    backgroundColor: v.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [colors.surfaceSunken, colors.primary, colors.success],
                    }),
                  },
                ]}
              />
            </View>
          ))}
        </View>
        {total > 1 && (
          <Text style={type.caption}>
            {Math.min(completed + 1, total)} of {total}
          </Text>
        )}
      </View>

      <View style={styles.headlineRow}>
        {processing ? (
          <View style={styles.iconSlot}>
            <ProcessingDots subscribeCapture={subscribeCapture} />
          </View>
        ) : passed ? (
          <Animated.View style={[styles.iconSlot, { transform: [{ scale: checkScale }] }]}>
            <Icon name="check" size="lg" color={colors.success} />
          </Animated.View>
        ) : (
          <Icon name={copy?.icon ?? 'verify'} size="lg" color={colors.primary} />
        )}
        <Animated.View
          style={[
            styles.headline,
            {
              opacity: headlineAnim,
              transform: [
                { translateY: headlineAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
              ],
            },
          ]}
        >
          <Text
            style={[type.title, passed && !processing && { color: colors.success }]}
            numberOfLines={1}
            accessibilityLiveRegion="polite"
          >
            {headline}
          </Text>
          {subHeadline ? (
            <View style={styles.subRow}>
              <Icon
                name={isWarning ? 'info' : 'check'}
                size="sm"
                color={isWarning ? colors.warning : colors.textSecondary}
              />
              <Text
                style={[
                  type.secondary,
                  styles.subText,
                  isWarning && { color: colors.warning, fontWeight: '500' },
                ]}
                numberOfLines={1}
              >
                {subHeadline}
              </Text>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Card>
  );
}

/** Three dots breathing in sequence — a custom "working on it" that fits the
 * card rather than the OS spinner. The whole group flares briefly on each real
 * photo, so a multi-shot burst is visible rather than looking like a hang. */
function ProcessingDots({
  subscribeCapture,
}: {
  subscribeCapture?: (fn: () => void) => () => void;
}) {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  const flare = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!subscribeCapture) return;
    return subscribeCapture(() => {
      flare.stopAnimation();
      flare.setValue(0);
      Animated.sequence([
        Animated.timing(flare, { toValue: 1, duration: 90, useNativeDriver: true }),
        Animated.timing(flare, {
          toValue: 0,
          duration: 320,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    });
  }, [subscribeCapture, flare]);

  useEffect(() => {
    const loops = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 140),
          Animated.timing(v, {
            toValue: 1,
            duration: 280,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 0,
            duration: 280,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.delay((2 - i) * 140),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [dots]);

  return (
    <Animated.View
      style={[
        styles.dotsRow,
        { transform: [{ scale: flare.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }] },
      ]}
    >
      {dots.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            styles.dot,
            {
              opacity: Animated.add(
                v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
                flare.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] })
              ),
              transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }],
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  track: { flex: 1, flexDirection: 'row', gap: spacing.xs },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    overflow: 'hidden',
  },
  segmentWide: { flex: undefined, width: 80 },
  segmentFill: { height: '100%', borderRadius: radius.pill },
  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconSlot: { width: 24, alignItems: 'center' },
  headline: { flex: 1 },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  subText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  dotsRow: { flexDirection: 'row', gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
});
