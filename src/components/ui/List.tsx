import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, elevation, hitTarget, radius, spacing, type } from '../../theme';
import { Badge } from './Badge';
import { Icon, IconName } from './Icon';

/**
 * Inset grouped list — one card, hairline-separated rows. Preferred over a
 * stack of standalone buttons: it reads as a single settings surface and keeps
 * related actions visually subordinate to the screen's primary action.
 */
export function ListGroup({ children }: { children: React.ReactNode }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.group}>
      {rows.map((row, i) => (
        <View key={i}>
          {i > 0 && <View style={styles.separator} />}
          {row}
        </View>
      ))}
    </View>
  );
}

interface RowProps {
  icon?: IconName;
  title: string;
  /** Secondary line. Keep it to a single short clause. */
  subtitle?: string;
  /** Right-aligned value, rendered with tabular figures. */
  value?: string;
  /** Right-aligned count pill, e.g. pending items. */
  badge?: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** Renders the label and icon in the danger colour. */
  destructive?: boolean;
  /** Hide the chevron on rows that act in place rather than navigate. */
  hideChevron?: boolean;
}

export function ListRow({
  icon,
  title,
  subtitle,
  value,
  badge,
  onPress,
  disabled,
  loading,
  destructive,
  hideChevron,
}: RowProps) {
  const isDisabled = disabled || loading;
  const fg = destructive ? colors.danger : colors.text;
  const iconColor = isDisabled
    ? colors.textTertiary
    : destructive
      ? colors.danger
      : colors.primary;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      android_ripple={{ color: colors.surfacePressed }}
      style={({ pressed }) => [
        styles.row,
        pressed && !isDisabled && styles.rowPressed,
        isDisabled && styles.rowDisabled,
      ]}
    >
      {icon && (
        <View style={styles.iconSlot}>
          <Icon name={icon} size="lg" color={iconColor} />
        </View>
      )}

      <View style={styles.rowText}>
        <Text style={[type.body, { color: fg }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={type.caption} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator size="small" color={colors.textTertiary} />
      ) : (
        <>
          {value ? <Text style={type.numeric}>{value}</Text> : null}
          {badge ? <Badge label={badge} tone="accent" /> : null}
          {!hideChevron && onPress ? (
            <Icon name="chevron" size="md" color={colors.textTertiary} />
          ) : null}
        </>
      )}
    </Pressable>
  );
}

/** Read-only label/value pair. Used for specs and result metrics. */
export function DataRow({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'success' | 'danger';
}) {
  const valueColor =
    tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.text;
  return (
    <View style={styles.dataRow}>
      <Text style={type.secondary} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[type.metricSm, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    ...elevation.level1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    // Start the rule at the text, not the icon — standard grouped-list inset.
    marginLeft: spacing.lg + 24 + spacing.md,
  },
  row: {
    minHeight: hitTarget + 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  rowPressed: { backgroundColor: colors.surfacePressed },
  rowDisabled: { opacity: 0.4 },
  iconSlot: { width: 24, alignItems: 'center' },
  rowText: { flex: 1, gap: 2 },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    minHeight: 36,
  },
});
