import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { OfflineStore } from '../storage/OfflineStore';
import { SyncManager } from '../sync/SyncManager';
import { colors, spacing, type } from '../theme';
import {
  ActionCard,
  Card,
  DataRow,
  IconButton,
  ListGroup,
  ListRow,
  Screen,
  SectionLabel,
} from '../components/ui';

export default function HomeScreen() {
  const router = useRouter();
  const [templateCount, setTemplateCount] = useState(0);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [syncedCount, setSyncedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [downloading, setDownloading] = useState(false);

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
        Alert.alert('Nothing to sync', 'Every template on this device is already uploaded.');
      } else {
        const duplicates = result.duplicates
          ? `\n${result.duplicates} already existed and were skipped.`
          : '';
        Alert.alert(
          'Sync complete',
          `${result.synced} uploaded.${duplicates}\n\nLocal copies are kept until you remove them.`
        );
      }
    } finally {
      setSyncing(false);
    }
  };

  const onDownloadCloud = async () => {
    setDownloading(true);
    try {
      const res = await SyncManager.downloadCloudTemplates();
      refresh();
      if (res.error) {
        Alert.alert('Download failed', res.error);
      } else {
        Alert.alert(
          'Cloud Cache Updated',
          `Fetched ${res.downloaded} cloud templates (${res.added} new templates added to local store for offline verification).`
        );
      }
    } finally {
      setDownloading(false);
    }
  };

  const onRemoveSynced = () => {
    Alert.alert(
      'Remove synced copies?',
      `${syncedCount} template${syncedCount === 1 ? '' : 's'} and corresponding image${syncedCount === 1 ? '' : 's'} will be removed from this device. They remain safe in AWS.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const removed = await SyncManager.purgeLocal();
            refresh();
            Alert.alert('Removed', `${removed} template${removed === 1 ? '' : 's'} and face image${removed === 1 ? '' : 's'} removed from local storage.`);
          },
        },
      ]
    );
  };

  const onDeleteAll = () => {
    Alert.alert(
      'Delete all templates & images?',
      'Every enrolled face template and corresponding image on this device will be permanently deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await OfflineStore.clearAll();
            refresh();
          },
        },
      ]
    );
  };

  const isEmpty = templateCount === 0;

  return (
    <Screen scroll contentStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={type.display}>DataLake 3.0</Text>
          <Text style={type.secondary}>Offline biometric attendance</Text>
        </View>
        <IconButton
          name="info"
          accessibilityLabel="About this app"
          onPress={() => router.push('/about' as any)}
        />
      </View>

      <Card>
        <Text style={type.fieldLabel}>Enrolled on this device</Text>
        <Text style={type.metric}>{templateCount}</Text>
        <View style={styles.breakdown}>
          {isEmpty ? (
            <Text style={type.caption}>No faces enrolled yet</Text>
          ) : (
            <>
              <DataRow label="Uploaded" value={String(syncedCount)} />
              <DataRow label="Pending upload" value={String(unsyncedCount)} />
            </>
          )}
        </View>
      </Card>

      <SectionLabel>Quick Actions</SectionLabel>
      <View style={styles.actions}>
        <ActionCard
          icon="enroll"
          title="Enroll a face"
          subtitle="Capture a new template with liveness checks"
          emphasis={isEmpty ? 'filled' : 'outlined'}
          onPress={() => router.push('/enroll' as any)}
        />
        <ActionCard
          icon="verify"
          title="Verify a face"
          subtitle={isEmpty ? 'Enroll a face to enable this' : 'Match against enrolled templates'}
          emphasis={isEmpty ? 'outlined' : 'filled'}
          disabled={isEmpty}
          onPress={() => router.push('/verify' as any)}
        />
      </View>

      <SectionLabel>Templates & Cloud Sync</SectionLabel>
      <ListGroup>
        <ListRow
          icon="upload"
          title="Upload to cloud"
          subtitle={
            unsyncedCount === 0 ? 'Nothing pending upload' : 'Store local templates and images in AWS'
          }
          badge={unsyncedCount > 0 ? String(unsyncedCount) : undefined}
          loading={syncing}
          disabled={unsyncedCount === 0}
          onPress={onSync}
          hideChevron
        />
        <ListRow
          icon="download"
          title="Download from cloud"
          subtitle="Download templates and images from AWS"
          loading={downloading}
          onPress={onDownloadCloud}
          hideChevron
        />
        <ListRow
          icon="removeLocal"
          title="Remove synced copies"
          subtitle={
            syncedCount === 0 ? 'Nothing uploaded yet' : 'Remove synced templates and images locally'
          }
          value={syncedCount > 0 ? String(syncedCount) : undefined}
          disabled={syncedCount === 0}
          onPress={onRemoveSynced}
          hideChevron
        />
        <ListRow
          icon="delete"
          title="Delete all templates"
          subtitle="Delete all templates and their corresponding images locally"
          destructive
          disabled={isEmpty}
          onPress={onDeleteAll}
          hideChevron
        />
      </ListGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: spacing.md, paddingBottom: spacing.huge },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  headerText: { flex: 1, gap: spacing.xs },
  breakdown: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  actions: { gap: spacing.md },
});
