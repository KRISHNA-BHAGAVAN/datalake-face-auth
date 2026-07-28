import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';

interface Props {
  matchedImageUri?: string | null;
  probeImageUri?: string | null;
  capturedFrameUris?: string[];
}

/**
 * Visual face match and capture evidence component for post-enrollment & verification.
 * - First-time Enrollment: Displays all 3 captured burst frames side-by-side.
 * - Verification / Match Found: Displays side-by-side comparison (Saved Photo vs New Scan).
 */
export function FaceMatchComparison({
  matchedImageUri,
  probeImageUri,
  capturedFrameUris = [],
}: Props) {
  const isMatchView = Boolean(matchedImageUri);

  // --- Match Comparison View (Verification OR Duplicate Enrollment Match) ---
  if (isMatchView) {
    return (
      <View style={styles.container}>
        <Text style={styles.sectionHeader}>FACE MATCH COMPARISON</Text>
        <View style={styles.grid}>
          {/* Left: Saved Enrolled Photo */}
          <View style={styles.card}>
            <View style={styles.imageFrame}>
              <Image source={{ uri: matchedImageUri! }} style={styles.faceImage} resizeMode="cover" />
              <View style={[styles.badge, styles.enrolledBadge]}>
                <Text style={styles.badgeText}>SAVED</Text>
              </View>
            </View>
            <Text style={styles.label}>Saved Photo</Text>
          </View>

          {/* Divider Indicator */}
          <View style={styles.vsContainer}>
            <Text style={styles.vsText}>VS</Text>
          </View>

          {/* Right: New Scan Capture */}
          <View style={styles.card}>
            <View style={styles.imageFrame}>
              <Image
                source={{ uri: probeImageUri || matchedImageUri! }}
                style={styles.faceImage}
                resizeMode="cover"
              />
              <View style={[styles.badge, styles.probeBadge]}>
                <Text style={styles.badgeText}>NEW</Text>
              </View>
            </View>
            <Text style={styles.label}>New Scan</Text>
          </View>
        </View>
      </View>
    );
  }

  // --- First-time Enrollment View: Display 3 Captured Burst Frames ---
  const framesToDisplay = capturedFrameUris.length > 0 ? capturedFrameUris : probeImageUri ? [probeImageUri] : [];
  if (framesToDisplay.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.sectionHeader}>
        {framesToDisplay.length > 1 ? '3-FRAME ENROLLMENT CAPTURE' : 'CAPTURED FACE PHOTO'}
      </Text>

      <View style={styles.burstRow}>
        {framesToDisplay.map((uri, index) => (
          <View key={index} style={styles.burstCard}>
            <View style={styles.burstImageFrame}>
              <Image source={{ uri }} style={styles.faceImage} resizeMode="cover" />
              <View style={[styles.badge, styles.enrolledBadge]}>
                <Text style={styles.badgeText}>FRAME {index + 1}</Text>
              </View>
            </View>
            <Text style={styles.burstLabel}>Frame {index + 1}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.xs,
    marginVertical: spacing.xs,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: colors.textSecondary,
    marginBottom: 4,
  },

  // 3-Frame Burst Row Layout
  burstRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    width: '100%',
  },
  burstCard: {
    alignItems: 'center',
    gap: 4,
  },
  burstImageFrame: {
    width: 80,
    height: 98,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#028090',
    backgroundColor: '#000000',
    position: 'relative',
    shadowColor: '#00F3FF',
    shadowOpacity: 0.3,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  burstLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
  },

  // Match Comparison Layout
  grid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    width: '100%',
  },
  card: {
    alignItems: 'center',
    gap: 4,
  },
  imageFrame: {
    width: 96,
    height: 114,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#028090',
    backgroundColor: '#000000',
    position: 'relative',
    shadowColor: '#00F3FF',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  faceImage: {
    width: '100%',
    height: '100%',
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text,
  },
  vsContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#028090',
    justifyContent: 'center',
    alignItems: 'center',
  },
  vsText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  badge: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: radius.pill,
  },
  enrolledBadge: {
    backgroundColor: 'rgba(2, 128, 144, 0.88)',
  },
  probeBadge: {
    backgroundColor: 'rgba(0, 243, 255, 0.88)',
  },
  badgeText: {
    fontSize: 7.5,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
});
