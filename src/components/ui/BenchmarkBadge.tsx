import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, radius, spacing, type } from '../../theme';
import { Icon } from './Icon';

export interface BenchmarkMetrics {
  detectionMs?: number;
  livenessMs?: number;
  inferenceMs?: number;
  matchingMs?: number;
  totalMs: number;
}

interface BenchmarkBadgeProps {
  metrics: BenchmarkMetrics | null;
  latencyMs?: number | null;
}

export function BenchmarkBadge({ metrics, latencyMs }: BenchmarkBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  const displayTotal = metrics?.totalMs ?? latencyMs;
  if (displayTotal == null) return null;

  const isFast = displayTotal < 1000;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => setExpanded((prev) => !prev)}
        style={[styles.badge, isFast ? styles.fastBadge : styles.slowBadge]}
      >
        <Icon name="check" size="sm" color={isFast ? colors.success : colors.warning} />
        <Text style={styles.badgeText}>
          ⚡ {displayTotal}ms Total | Target &lt;1000ms {isFast ? '✓' : ''}
        </Text>
        <Icon
          name="info"
          size="sm"
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {expanded && metrics && (
        <View style={styles.detailsBox}>
          <Text style={styles.detailsTitle}>Benchmark Performance Breakdown</Text>
          {metrics.detectionMs != null && (
            <View style={styles.row}>
              <Text style={styles.label}>Landmark & Detection:</Text>
              <Text style={styles.value}>{metrics.detectionMs} ms</Text>
            </View>
          )}
          {metrics.livenessMs != null && (
            <View style={styles.row}>
              <Text style={styles.label}>Liveness Challenge:</Text>
              <Text style={styles.value}>{metrics.livenessMs} ms</Text>
            </View>
          )}
          {metrics.inferenceMs != null && (
            <View style={styles.row}>
              <Text style={styles.label}>TFLite Model Embedding:</Text>
              <Text style={styles.value}>{metrics.inferenceMs} ms</Text>
            </View>
          )}
          {metrics.matchingMs != null && (
            <View style={styles.row}>
              <Text style={styles.label}>Cosine Similarity Search:</Text>
              <Text style={styles.value}>{metrics.matchingMs} ms</Text>
            </View>
          )}
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Total Recognition Latency:</Text>
            <Text style={[styles.totalValue, { color: isFast ? colors.success : colors.warning }]}>
              {displayTotal} ms
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginVertical: spacing.xs,
    zIndex: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 1,
    gap: spacing.xs,
  },
  fastBadge: {
    borderColor: colors.successBorder,
  },
  slowBadge: {
    borderColor: colors.warningBorder,
  },
  badgeText: {
    ...type.numeric,
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  detailsBox: {
    marginTop: spacing.xs,
    width: '90%',
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  detailsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  value: {
    ...type.numeric,
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  totalRow: {
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },
  totalValue: {
    ...type.numeric,
    fontSize: 13,
    fontWeight: '800',
  },
});
