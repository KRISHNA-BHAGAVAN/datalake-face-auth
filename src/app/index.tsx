import React, { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { OfflineStore } from '../storage/OfflineStore';
import { SyncManager } from '../sync/SyncManager';
import { colors, spacing, type } from '../theme';
import { ActionCard, AppButton, Badge, Card, Screen, SectionLabel } from '../components/ui';

export default function HomeScreen() {
  const router = useRouter();
  const [templateCount, setTemplateCount] = useState(0);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [syncedCount, setSyncedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => {
    OfflineStore.getTemplates().then((t) => {
      setTemplateCount(t.length);
      setUnsyncedCount(t.filter((x) => !x.isSynced).length);
      setSyncedCount(t.filter((x) => x.isSynced).length);
    });
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const onSync = async () => {
    setSyncing(true);
    try {
      const result = await SyncManager.sync();
      refresh();
      if (result.error) {
        Alert.alert('Sync failed', result.error);
      } else if (result.synced === 0 && !result.duplicates) {
        Alert.alert('Nothing to sync', 'No unsynced templates on this device.');
      } else {
        const dupLine = result.duplicates
          ? `\n${result.duplicates} skipped — already in the datalake.`
          : '';
        Alert.alert(
          'Sync complete',
          `${result.synced} new template(s) uploaded to AWS.${dupLine}\n\nLocal copies kept — use "Purge Local" to remove synced ones.`
        );
      }
    } finally {
      setSyncing(false);
    }
  };

  const onPurge = () => {
    if (syncedCount === 0) return;
    Alert.alert(
      'Purge synced templates?',
      `Deletes ${syncedCount} synced template(s) from this device. They remain in AWS. Unsynced templates are kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Purge',
          style: 'destructive',
          onPress: async () => {
            const removed = await SyncManager.purgeLocal();
            refresh();
            Alert.alert('Purged', `${removed} synced template(s) removed from this device.`);
          },
        },
      ]
    );
  };

  const onClear = () => {
    if (templateCount === 0) return;
    Alert.alert('Clear all data?', 'This permanently deletes every enrolled face template on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await OfflineStore.clearAll();
          setTemplateCount(0);
        },
      },
    ]);
  };

  return (
    <Screen scroll contentStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.logo}>
            <Text style={styles.logoGlyph}>◈</Text>
          </View>
          <Pressable style={styles.about} onPress={() => router.push('/about' as any)}>
            <Text style={styles.aboutText}>About ›</Text>
          </Pressable>
        </View>
        <Text style={type.display}>Datalake Face Auth</Text>
        <Text style={type.secondary}>Offline biometric attendance for field personnel</Text>
        <View style={styles.badges}>
          <Badge label="OFFLINE READY" tone="success" />
          <Badge label="ON-DEVICE AI" tone="primary" />
        </View>
      </View>

      {/* Enrolled stat */}
      <Card tone="primary" style={styles.statCard}>
        <View>
          <Text style={type.label}>Enrolled Templates</Text>
          <Text style={type.metric}>{templateCount}</Text>
        </View>
        <View style={styles.statSide}>
          <Text style={styles.statSideValue}>{templateCount === 0 ? 'Empty' : 'Ready'}</Text>
          <Text style={type.secondary}>Stored encrypted on device</Text>
        </View>
      </Card>

      {/* Primary actions */}
      <SectionLabel>Authenticate</SectionLabel>
      <ActionCard
        glyph="＋"
        title="Enroll New Face"
        subtitle="Capture a template with liveness checks"
        tone="primary"
        onPress={() => router.push('/enroll' as any)}
      />
      <ActionCard
        glyph="⛨"
        title="Verify Face"
        subtitle={templateCount === 0 ? 'Enroll a face first' : 'Match against enrolled templates'}
        tone="success"
        disabled={templateCount === 0}
        onPress={() => router.push('/verify' as any)}
      />

      {/* Data management */}
      <SectionLabel>Data</SectionLabel>
      <AppButton
        title={unsyncedCount > 0 ? `Sync to AWS (${unsyncedCount})` : 'Sync to AWS'}
        glyph="☁"
        variant="secondary"
        loading={syncing}
        disabled={unsyncedCount === 0}
        onPress={onSync}
      />
      <AppButton
        title={syncedCount > 0 ? `Purge Local Synced (${syncedCount})` : 'Purge Local Synced'}
        glyph="⤓"
        variant="secondary"
        disabled={syncedCount === 0}
        onPress={onPurge}
      />
      <AppButton
        title="Clear All Data"
        glyph="🗑"
        variant="danger"
        disabled={templateCount === 0}
        onPress={onClear}
      />

      <Text style={styles.footer}>100% on-device · no network required · sync de-dups in AWS · purge on demand</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  header: { gap: spacing.sm },
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xs },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primaryDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoGlyph: { color: colors.primary, fontSize: 22, fontWeight: '800' },
  about: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm },
  aboutText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  badges: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  statCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.sm },
  statSide: { alignItems: 'flex-end', maxWidth: '50%' },
  statSideValue: { color: colors.success, fontSize: 16, fontWeight: '800', marginBottom: 2 },
  footer: { color: colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: spacing.lg, lineHeight: 18 },
});
