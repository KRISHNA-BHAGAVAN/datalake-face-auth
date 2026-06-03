import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import { LivenessChallengeType, LivenessState } from '../types';
import { Card } from './ui/Card';

interface Props {
  state: LivenessState;
  /** Total challenges in this run, to render the step dots. */
  total: number;
}

const CHALLENGE_COPY: Record<LivenessChallengeType, { glyph: string; text: string }> = {
  BLINK: { glyph: '\u{1F441}', text: 'Blink your eyes' },
  SMILE: { glyph: '\u{1F642}', text: 'Smile for the camera' },
  TURN_HEAD_LEFT: { glyph: '\u{2B05}', text: 'Slowly turn your head left' },
  TURN_HEAD_RIGHT: { glyph: '\u{27A1}', text: 'Slowly turn your head right' },
};

/** Top overlay card: liveness step progress + current instruction + anti-spoof tag. */
export function ChallengeCard({ state, total }: Props) {
  const { status, currentChallenge, challengesRemaining, message } = state;

  const stepsLeft = challengesRemaining.length + (currentChallenge ? 1 : 0);
  const completed = status === 'PASSED' ? total : Math.max(0, total - stepsLeft);
  const activeIndex = completed;

  const copy = currentChallenge ? CHALLENGE_COPY[currentChallenge] : null;
  const headline =
    status === 'PASSED' ? 'Liveness confirmed' : copy ? copy.text : message || 'Position your face in the frame';

  return (
    <Card variant="glass" tone={status === 'PASSED' ? 'success' : 'primary'} style={styles.card}>
      <View style={styles.dots}>
        {Array.from({ length: total }).map((_, i) => {
          const done = i < completed;
          const active = i === activeIndex && status === 'IN_PROGRESS';
          return (
            <View
              key={i}
              style={[
                styles.dot,
                done && styles.dotDone,
                active && styles.dotActive,
                total === 1 && styles.dotWide,
              ]}
            />
          );
        })}
      </View>

      <View style={styles.headlineRow}>
        {copy && status !== 'PASSED' ? <Text style={styles.glyph}>{copy.glyph}</Text> : null}
        <Text style={styles.headline}>{status === 'PASSED' ? '✓  ' + headline : headline}</Text>
      </View>

      <View style={styles.spoofRow}>
        <View style={styles.spoofDot} />
        <Text style={styles.spoofText}>Anti-spoof active · on-device</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'center' },
  dot: {
    width: 26,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.hairlineSoft,
  },
  dotWide: { width: 80 },
  dotDone: { backgroundColor: colors.success },
  dotActive: { backgroundColor: colors.primary },
  headlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  glyph: { fontSize: 22 },
  headline: { fontSize: 19, fontWeight: '800', color: colors.text, textAlign: 'center' },
  spoofRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  spoofDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  spoofText: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, letterSpacing: 0.3 },
});
