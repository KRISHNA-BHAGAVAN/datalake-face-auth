import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

const { width } = Dimensions.get('window');
const OVAL_WIDTH = width * 0.72;
const OVAL_HEIGHT = OVAL_WIDTH * 1.32;

interface Props {
  /** Border accent for the face oval. */
  accent: string;
  /** Run the sweeping scan line + pulse (false once passed/failed). */
  scanning: boolean;
}

/**
 * Camera overlay: dimmed surround, a face-positioning oval that pulses while
 * scanning, and a horizontal scan line that sweeps top→bottom inside the oval.
 * Uses RN Animated (no reanimated worklets) so it runs everywhere reliably.
 */
export function ScanOverlay({ accent, scanning }: Props) {
  const sweep = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!scanning) {
      sweep.stopAnimation();
      pulse.stopAnimation();
      return;
    }
    const sweepLoop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 2200,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    sweepLoop.start();
    pulseLoop.start();
    return () => {
      sweepLoop.stop();
      pulseLoop.stop();
    };
  }, [scanning, sweep, pulse]);

  const translateY = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-OVAL_HEIGHT / 2 + 8, OVAL_HEIGHT / 2 - 8],
  });
  const scanOpacity = sweep.interpolate({
    inputRange: [0, 0.1, 0.9, 1],
    outputRange: [0, 1, 1, 0],
  });
  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] });

  return (
    <View style={styles.overlay} pointerEvents="none">
      <View style={styles.dim}>
        <Animated.View
          style={[
            styles.oval,
            { borderColor: accent, shadowColor: accent, shadowOpacity: scanning ? glow : 0.5 },
          ]}
        >
          {scanning && (
            <Animated.View
              style={[
                styles.scanLine,
                { backgroundColor: accent, shadowColor: accent, opacity: scanOpacity, transform: [{ translateY }] },
              ]}
            />
          )}
          {/* corner ticks */}
          <View style={[styles.tick, styles.tl, { borderColor: accent }]} />
          <View style={[styles.tick, styles.tr, { borderColor: accent }]} />
          <View style={[styles.tick, styles.bl, { borderColor: accent }]} />
          <View style={[styles.tick, styles.br, { borderColor: accent }]} />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  dim: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(5, 8, 12, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  oval: {
    width: OVAL_WIDTH,
    height: OVAL_HEIGHT,
    borderRadius: OVAL_WIDTH / 2,
    borderWidth: 2.5,
    overflow: 'hidden',
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2.5,
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  tick: { position: 'absolute', width: 22, height: 22 },
  tl: { top: '14%', left: '12%', borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 8 },
  tr: { top: '14%', right: '12%', borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 8 },
  bl: { bottom: '14%', left: '12%', borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 8 },
  br: { bottom: '14%', right: '12%', borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 8 },
});
