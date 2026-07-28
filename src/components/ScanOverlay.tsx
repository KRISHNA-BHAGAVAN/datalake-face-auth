import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

const { width, height } = Dimensions.get('window');
const FRAME_WIDTH = Math.min(width * 0.74, 320);
const FRAME_HEIGHT = Math.min(FRAME_WIDTH * 1.3, height * 0.46);
const FRAME_TOP = (height - FRAME_HEIGHT) / 2;
const FRAME_LEFT = (width - FRAME_WIDTH) / 2;
const FRAME_RADIUS = FRAME_WIDTH / 2;

const RX = FRAME_WIDTH / 2;
const RY = FRAME_HEIGHT / 2;
const DOT = 8;

import { LivenessChallengeGuide } from './LivenessChallengeGuide';
import { LivenessChallengeType } from '../types';

interface Props {
  resolved: 'success' | 'danger' | null;
  scanning: boolean;
  subscribeCapture: (fn: () => void) => () => void;
  currentChallenge?: LivenessChallengeType | null;
}

/**
 * High-tech biometric scanner overlay.
 * Features:
 * - Animated vertical laser scanning beam
 * - Holographic active challenge visual guides (smile, blink, head turn arrows)
 * - 4 cardinal reticle target notches
 * - Ambient breathing perimeter glow
 * - Photo-burst flash & recoil animation
 * - Success/danger halo & haptic shake feedback
 */
export function ScanOverlay({ resolved, scanning, subscribeCapture, currentChallenge }: Props) {
  const scanLine = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const framePop = useRef(new Animated.Value(1)).current;
  const shakeX = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  const prevResolved = useRef(resolved);

  // Pulsing halo and vertical laser scan line
  useEffect(() => {
    if (!scanning) {
      pulse.stopAnimation();
      pulse.setValue(0);
      scanLine.stopAnimation();
      scanLine.setValue(0);
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    const scanLineLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLine, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(scanLine, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    pulseLoop.start();
    scanLineLoop.start();

    return () => {
      pulseLoop.stop();
      scanLineLoop.stop();
      pulse.setValue(0);
      scanLine.setValue(0);
    };
  }, [scanning, pulse, scanLine]);

  // Shutter: frame-clipped flash + a tight recoil, once per real photo.
  useEffect(
    () =>
      subscribeCapture(() => {
        flash.stopAnimation();
        flash.setValue(0);
        framePop.stopAnimation();
        framePop.setValue(1);
        glow.stopAnimation();
        glow.setValue(0);
        Animated.parallel([
          Animated.sequence([
            Animated.timing(flash, { toValue: 1, duration: 50, useNativeDriver: true }),
            Animated.timing(flash, {
              toValue: 0,
              duration: 240,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
          Animated.sequence([
            Animated.timing(glow, { toValue: 1, duration: 50, useNativeDriver: true }),
            Animated.timing(glow, { toValue: 0, duration: 280, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.timing(framePop, { toValue: 0.975, duration: 60, useNativeDriver: true }),
            Animated.spring(framePop, {
              toValue: 1,
              friction: 5.5,
              tension: 140,
              useNativeDriver: true,
            }),
          ]),
        ]).start();
      }),
    [subscribeCapture, flash, framePop, glow]
  );

  // Outcome — plays once on the transition, then holds.
  useEffect(() => {
    if (resolved === prevResolved.current) return;
    prevResolved.current = resolved;

    if (resolved === 'success') {
      framePop.stopAnimation();
      framePop.setValue(1);
      halo.setValue(0);
      Animated.sequence([
        Animated.timing(framePop, { toValue: 1.055, duration: 110, useNativeDriver: true }),
        Animated.spring(framePop, {
          toValue: 1,
          friction: 5,
          tension: 130,
          useNativeDriver: true,
        }),
      ]).start();
      Animated.timing(halo, {
        toValue: 1,
        duration: 680,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else if (resolved === 'danger') {
      shakeX.setValue(0);
      Animated.sequence([
        Animated.timing(shakeX, { toValue: -8, duration: 45, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 8, duration: 85, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: -5, duration: 85, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 0, duration: 65, useNativeDriver: true }),
      ]).start();
    }
  }, [resolved, framePop, halo, shakeX]);

  const stateColor =
    resolved === 'success' ? colors.success : resolved === 'danger' ? colors.danger : colors.primary;

  const laserY = scanLine.interpolate({
    inputRange: [0, 1],
    outputRange: [12, FRAME_HEIGHT - 12],
  });

  return (
    <View style={styles.overlay} pointerEvents="none">
      {/* Four scrim panels leave the frame interior clear */}
      <View style={[styles.scrim, styles.top]} />
      <View style={[styles.scrim, styles.bottom]} />
      <View style={[styles.scrim, styles.left]} />
      <View style={[styles.scrim, styles.right]} />

      {/* Holographic 3D active challenge action guide animation overlay */}
      <LivenessChallengeGuide
        currentChallenge={currentChallenge ?? null}
        resolved={resolved}
      />

      {/* Soft outer ambient pulsing ring */}
      <Animated.View
        style={[
          styles.outerRing,
          {
            borderColor: stateColor,
            opacity: Animated.add(
              pulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.45] }),
              glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] })
            ),
            transform: [{ translateX: shakeX }, { scale: framePop }],
          },
        ]}
      />

      {/* Main Oval Frame */}
      <Animated.View
        style={[
          styles.frameWrap,
          { transform: [{ translateX: shakeX }, { scale: framePop }] },
        ]}
      >
        <View style={[styles.frame, { borderColor: stateColor }]}>
          {/* Clipped inside the frame: the shutter flash */}
          <Animated.View
            style={[
              styles.flash,
              { opacity: flash.interpolate({ inputRange: [0, 1], outputRange: [0, 0.34] }) },
            ]}
          />

          {/* Vertical Laser Scan Beam */}
          {scanning && (
            <Animated.View
              style={[
                styles.scanBeam,
                {
                  transform: [{ translateY: laserY }],
                  opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0.95] }),
                },
              ]}
            />
          )}
        </View>

        {/* Biometric Target Notches at 4 cardinal points */}
        <View style={[styles.notch, styles.notchTop, { backgroundColor: stateColor }]} />
        <View style={[styles.notch, styles.notchBottom, { backgroundColor: stateColor }]} />
        <View style={[styles.notch, styles.notchLeft, { backgroundColor: stateColor }]} />
        <View style={[styles.notch, styles.notchRight, { backgroundColor: stateColor }]} />
      </Animated.View>

      {/* Success: expanding halo */}
      {resolved === 'success' && (
        <Animated.View
          style={[
            styles.successHalo,
            {
              opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
              transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] }) }],
            },
          ]}
        />
      )}
    </View>
  );
}

const framePosition = {
  position: 'absolute',
  top: FRAME_TOP,
  left: FRAME_LEFT,
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  borderRadius: FRAME_RADIUS,
} as const;

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 10 },
  scrim: { position: 'absolute', backgroundColor: colors.scrim },
  top: { top: 0, left: 0, right: 0, height: FRAME_TOP },
  bottom: { top: FRAME_TOP + FRAME_HEIGHT, left: 0, right: 0, bottom: 0 },
  left: { top: FRAME_TOP, left: 0, width: FRAME_LEFT, height: FRAME_HEIGHT },
  right: { top: FRAME_TOP, right: 0, width: FRAME_LEFT, height: FRAME_HEIGHT },

  frameWrap: { ...framePosition },
  frame: {
    width: '100%',
    height: '100%',
    borderRadius: FRAME_RADIUS,
    borderWidth: 2,
    overflow: 'hidden', // clips the flash and scan beam to the frame interior
    shadowColor: '#175CD3',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  flash: { ...StyleSheet.absoluteFill, backgroundColor: colors.flash },

  scanBeam: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 2.5,
    backgroundColor: '#38BDF8',
    borderRadius: 2,
    shadowColor: '#38BDF8',
    shadowOpacity: 0.95,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },

  outerRing: {
    ...framePosition,
    top: FRAME_TOP - 6,
    left: FRAME_LEFT - 6,
    width: FRAME_WIDTH + 12,
    height: FRAME_HEIGHT + 12,
    borderRadius: FRAME_RADIUS + 6,
    borderWidth: 3,
  },

  notch: {
    position: 'absolute',
    borderRadius: 2,
  },
  notchTop: {
    top: -4,
    left: FRAME_WIDTH / 2 - 12,
    width: 24,
    height: 3,
  },
  notchBottom: {
    bottom: -4,
    left: FRAME_WIDTH / 2 - 12,
    width: 24,
    height: 3,
  },
  notchLeft: {
    left: -4,
    top: FRAME_HEIGHT / 2 - 12,
    width: 3,
    height: 24,
  },
  notchRight: {
    right: -4,
    top: FRAME_HEIGHT / 2 - 12,
    width: 3,
    height: 24,
  },

  successHalo: {
    ...framePosition,
    borderWidth: 2.5,
    borderColor: colors.success,
  },
});
