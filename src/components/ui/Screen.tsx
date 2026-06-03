import React from 'react';
import { ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme';

interface Props {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
}

/** Dark, safe-area-aware page wrapper. Pass scroll for long content. */
export function Screen({ children, scroll, contentStyle }: Props) {
  const inner = (
    <View style={[styles.content, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {inner}
        </ScrollView>
      ) : (
        inner
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1 },
  content: { flex: 1, paddingHorizontal: spacing.xl, gap: spacing.lg },
});
