import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, type } from '../theme';
import { Badge, Card, Screen, SectionLabel, StatChip } from '../components/ui';

const PIPELINE = [
  {
    glyph: '🛡',
    title: '1 · Anti-Spoof',
    desc: 'MiniFASNet V2 rejects photos and screens before anything else runs.',
  },
  {
    glyph: '👁',
    title: '2 · Liveness',
    desc: 'Active challenges (blink, smile, head turn) prove a live person is present.',
  },
  {
    glyph: '◈',
    title: '3 · Recognition',
    desc: 'MobileFaceNet embeddings matched by cosine similarity against the local template.',
  },
];

export default function AboutScreen() {
  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.intro}>
        <Text style={type.title}>How it works</Text>
        <Text style={type.secondary}>
          A fully offline face-auth pipeline that runs entirely on the device — no network, no
          cloud inference.
        </Text>
        <View style={styles.badges}>
          <Badge label="OPEN SOURCE" tone="primary" />
          <Badge label="OFFLINE" tone="success" />
          <Badge label="ANDROID + iOS" tone="muted" />
        </View>
      </View>

      <SectionLabel>Pipeline</SectionLabel>
      {PIPELINE.map((p) => (
        <Card key={p.title} style={styles.stepCard}>
          <Text style={styles.stepGlyph}>{p.glyph}</Text>
          <View style={styles.stepText}>
            <Text style={type.heading}>{p.title}</Text>
            <Text style={type.secondary}>{p.desc}</Text>
          </View>
        </Card>
      ))}

      <SectionLabel>Model Footprint</SectionLabel>
      <Card tone="primary">
        <Text style={type.secondary}>
          Total on-device AI payload — well under the 20&nbsp;MB target.
        </Text>
        <View style={styles.chipRow}>
          <StatChip label="RECOGNITION" value="5.2 MB" tone="primary" />
          <StatChip label="ANTI-SPOOF" value="1.8 MB" tone="primary" />
          <StatChip label="TOTAL" value="~7 MB" tone="success" />
        </View>
        <Text style={styles.note}>MobileFaceNet · MiniFASNet V2 — both quantized TFLite.</Text>
      </Card>

      <SectionLabel>Benchmarks</SectionLabel>
      <Card>
        <View style={styles.chipRow}>
          <StatChip label="RECOGNIZE + LIVENESS" value="< 1s" tone="success" />
          <StatChip label="MATCH THRESHOLD" value="65%" tone="default" />
        </View>
        <View style={[styles.chipRow, { marginTop: spacing.md }]}>
          <StatChip label="MIN RAM" value="3 GB" tone="default" />
          <StatChip label="MIN OS" value="A8 / iOS12" tone="default" />
        </View>
      </Card>

      <SectionLabel>Sync & Privacy</SectionLabel>
      <Card>
        <Text style={type.body}>Offline-first with sync-then-purge.</Text>
        <Text style={[type.secondary, styles.para]}>
          Templates are stored encrypted on the device and used for matching locally. When
          connectivity returns, unsynced templates upload to AWS and are purged from local storage.
        </Text>
      </Card>

      <Text style={styles.footer}>Datalake 3.0 · Hackathon 7 prototype</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  intro: { gap: spacing.sm },
  badges: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  stepCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  stepGlyph: { fontSize: 28 },
  stepText: { flex: 1, gap: 3 },
  chipRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  note: { color: colors.textMuted, fontSize: 12, marginTop: spacing.md },
  para: { marginTop: spacing.sm, lineHeight: 20 },
  footer: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: spacing.lg },
});
