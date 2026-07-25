import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing, type } from '../theme';
import { Card, DataRow, Icon, IconName, Screen, SectionLabel, StatChip } from '../components/ui';

const PIPELINE: { icon: IconName; title: string; desc: string }[] = [
  {
    icon: 'antiSpoof',
    title: 'Anti-spoofing',
    desc: 'MiniFASNet V2 rejects photos and screen replays before anything else runs.',
  },
  {
    icon: 'liveness',
    title: 'Liveness',
    desc: 'Blink, smile and head-turn challenges confirm a live person is present.',
  },
  {
    icon: 'verify',
    title: 'Recognition',
    desc: 'MobileFaceNet embeddings matched by cosine similarity against local templates.',
  },
];

export default function AboutScreen() {
  return (
    <Screen scroll contentStyle={styles.content} edges={['bottom']}>
      <View style={styles.intro}>
        <Text style={type.title}>How it works</Text>
        <Text style={type.secondary}>
          Three checks run in sequence on the device. Nothing leaves the phone during
          authentication, and no network connection is required.
        </Text>
      </View>

      <SectionLabel>Pipeline</SectionLabel>
      <Card flush>
        {PIPELINE.map((step, i) => (
          <View key={step.title} style={[styles.step, i > 0 && styles.stepDivided]}>
            <View style={styles.stepIcon}>
              <Icon name={step.icon} size="lg" color={colors.primary} />
            </View>
            <View style={styles.stepText}>
              <View style={styles.stepTitleRow}>
                <Text style={type.caption}>Step {i + 1}</Text>
              </View>
              <Text style={type.bodyStrong}>{step.title}</Text>
              <Text style={type.secondary}>{step.desc}</Text>
            </View>
          </View>
        ))}
      </Card>

      <SectionLabel trailing="Quantized TFLite">Model size</SectionLabel>
      <View style={styles.tiles}>
        <StatChip label="Recognition" value="5.2 MB" />
        <StatChip label="Anti-spoof" value="1.8 MB" />
        <StatChip label="Total" value="7 MB" />
      </View>

      <SectionLabel>Performance</SectionLabel>
      <Card style={styles.rows}>
        <DataRow label="Recognition time" value="Under 1s" tone="success" />
        <View style={styles.divider} />
        <DataRow label="Match threshold" value="48%" />
        <View style={styles.divider} />
        <DataRow label="Minimum RAM" value="3 GB" />
        <View style={styles.divider} />
        <DataRow label="Minimum OS" value="iOS 12 / A8" />
      </Card>

      <SectionLabel>Storage and sync</SectionLabel>
      <Card style={styles.notes}>
        <View style={styles.note}>
          <Icon name="privacy" size="lg" color={colors.textTertiary} />
          <Text style={[type.secondary, styles.noteText]}>
            Templates are encrypted on the device and matched locally.
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.note}>
          <Icon name="upload" size="lg" color={colors.textTertiary} />
          <Text style={[type.secondary, styles.noteText]}>
            Uploads are manual. Duplicates are rejected server-side, and local copies are only
            removed when you ask for it.
          </Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.note}>
          <Icon name="offline" size="lg" color={colors.textTertiary} />
          <Text style={[type.secondary, styles.noteText]}>
            Enrollment and verification work with no connectivity at all.
          </Text>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.md, paddingBottom: spacing.huge },
  intro: { gap: spacing.sm },
  step: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg },
  stepDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  stepIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { flex: 1, gap: 2 },
  stepTitleRow: { flexDirection: 'row' },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  rows: { gap: spacing.xs },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  notes: { gap: spacing.lg },
  note: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  noteText: { flex: 1 },
});
