import React, { useEffect, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import { LivenessChallengeType } from '../types';

const { width, height } = Dimensions.get('window');
const FRAME_WIDTH = Math.min(width * 0.74, 320);
const FRAME_HEIGHT = Math.min(FRAME_WIDTH * 1.3, height * 0.46);
const FRAME_TOP = (height - FRAME_HEIGHT) / 2;
const FRAME_LEFT = (width - FRAME_WIDTH) / 2;

interface Props {
  currentChallenge: LivenessChallengeType | null;
  resolved: 'success' | 'danger' | null;
}

/**
 * Holographic 3D/2D active challenge visual guide overlay.
 * Built using pure React Native Animated views for 100% universal compatibility
 * across all development builds, devices, and Expo runtimes (iOS & Android).
 */
export function LivenessChallengeGuide({ currentChallenge, resolved }: Props) {
  const pulse = useRef(new Animated.Value(0)).current;
  const smileScale = useRef(new Animated.Value(0)).current;
  const turnLeftAnim = useRef(new Animated.Value(0)).current;
  const turnRightAnim = useRef(new Animated.Value(0)).current;
  const blinkEyeY = useRef(new Animated.Value(1)).current;

  // Continuous ambient pulse
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // Handle Challenge Animations
  useEffect(() => {
    // Smile animation
    if (currentChallenge === 'SMILE') {
      Animated.spring(smileScale, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(smileScale, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }

    // Turn Left animation
    if (currentChallenge === 'TURN_HEAD_LEFT') {
      Animated.spring(turnLeftAnim, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(turnLeftAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }

    // Turn Right animation
    if (currentChallenge === 'TURN_HEAD_RIGHT') {
      Animated.spring(turnRightAnim, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(turnRightAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }

    // Blink animation
    if (currentChallenge === 'BLINK') {
      const blinkLoop = Animated.loop(
        Animated.sequence([
          Animated.delay(800),
          Animated.timing(blinkEyeY, { toValue: 0.1, duration: 150, useNativeDriver: true }),
          Animated.timing(blinkEyeY, { toValue: 1, duration: 150, useNativeDriver: true }),
        ])
      );
      blinkLoop.start();
      return () => blinkLoop.stop();
    } else {
      blinkEyeY.setValue(1);
    }
  }, [currentChallenge, smileScale, turnLeftAnim, turnRightAnim, blinkEyeY]);

  const activeColor =
    resolved === 'success' ? '#00FF9D' : resolved === 'danger' ? '#FF3B30' : '#00F3FF';

  return (
    <View style={styles.container} pointerEvents="none">
      {/* Ambient Pulsing Radar Ring */}
      <Animated.View
        style={[
          styles.radarRing,
          {
            borderColor: activeColor,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.6] }),
            transform: [
              { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.04] }) },
            ],
          },
        ]}
      />

      {/* --- TURN HEAD LEFT GUIDE --- */}
      {currentChallenge === 'TURN_HEAD_LEFT' && (
        <Animated.View
          style={[
            styles.turnGuideLeft,
            {
              opacity: turnLeftAnim,
              transform: [
                {
                  translateX: turnLeftAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [20, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.arrowArcLeft, { borderColor: activeColor }]} />
          <View style={[styles.chevronLeft, { borderColor: activeColor }]} />
        </Animated.View>
      )}

      {/* --- TURN HEAD RIGHT GUIDE --- */}
      {currentChallenge === 'TURN_HEAD_RIGHT' && (
        <Animated.View
          style={[
            styles.turnGuideRight,
            {
              opacity: turnRightAnim,
              transform: [
                {
                  translateX: turnRightAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-20, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={[styles.arrowArcRight, { borderColor: activeColor }]} />
          <View style={[styles.chevronRight, { borderColor: activeColor }]} />
        </Animated.View>
      )}

      {/* --- SMILE GUIDE --- */}
      {currentChallenge === 'SMILE' && (
        <Animated.View
          style={[
            styles.smileWrap,
            {
              opacity: smileScale,
              transform: [{ scale: smileScale }],
            },
          ]}
        >
          {/* Mouth Brackets */}
          <View style={[styles.bracket, styles.bracketLeft, { borderColor: activeColor }]} />
          <View style={[styles.bracket, styles.bracketRight, { borderColor: activeColor }]} />
          {/* Glowing Arc Smile Curve */}
          <View style={[styles.smileArc, { borderColor: activeColor }]} />
        </Animated.View>
      )}

      {/* --- BLINK GUIDE --- */}
      {currentChallenge === 'BLINK' && (
        <View style={styles.blinkWrap}>
          <View style={[styles.eyeReticle, { borderColor: activeColor }]}>
            <Animated.View
              style={[
                styles.eyePupil,
                { backgroundColor: activeColor, transform: [{ scaleY: blinkEyeY }] },
              ]}
            />
          </View>
          <View style={[styles.eyeReticle, { borderColor: activeColor }]}>
            <Animated.View
              style={[
                styles.eyePupil,
                { backgroundColor: activeColor, transform: [{ scaleY: blinkEyeY }] },
              ]}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 12,
  },

  radarRing: {
    position: 'absolute',
    top: FRAME_TOP - 8,
    left: FRAME_LEFT - 8,
    width: FRAME_WIDTH + 16,
    height: FRAME_HEIGHT + 16,
    borderRadius: (FRAME_WIDTH + 16) / 2,
    borderWidth: 2,
    borderStyle: 'dashed',
  },

  // Turn Left Arc & Chevron
  turnGuideLeft: {
    position: 'absolute',
    top: FRAME_TOP + FRAME_HEIGHT * 0.35,
    left: FRAME_LEFT - 28,
    flexDirection: 'row',
    alignItems: 'center',
  },
  arrowArcLeft: {
    width: 45,
    height: 90,
    borderTopLeftRadius: 45,
    borderBottomLeftRadius: 45,
    borderLeftWidth: 4,
    borderTopWidth: 4,
    borderBottomWidth: 4,
  },
  chevronLeft: {
    width: 16,
    height: 16,
    borderLeftWidth: 4,
    borderBottomWidth: 4,
    transform: [{ rotate: '45deg' }],
    marginLeft: -10,
  },

  // Turn Right Arc & Chevron
  turnGuideRight: {
    position: 'absolute',
    top: FRAME_TOP + FRAME_HEIGHT * 0.35,
    right: FRAME_LEFT - 28,
    flexDirection: 'row-reverse',
    alignItems: 'center',
  },
  arrowArcRight: {
    width: 45,
    height: 90,
    borderTopRightRadius: 45,
    borderBottomRightRadius: 45,
    borderRightWidth: 4,
    borderTopWidth: 4,
    borderBottomWidth: 4,
  },
  chevronRight: {
    width: 16,
    height: 16,
    borderRightWidth: 4,
    borderBottomWidth: 4,
    transform: [{ rotate: '-45deg' }],
    marginRight: -10,
  },

  // Smile Arc & Brackets
  smileWrap: {
    position: 'absolute',
    top: FRAME_TOP + FRAME_HEIGHT * 0.64,
    left: FRAME_LEFT + FRAME_WIDTH * 0.22,
    width: FRAME_WIDTH * 0.56,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  smileArc: {
    width: 90,
    height: 45,
    borderBottomLeftRadius: 45,
    borderBottomRightRadius: 45,
    borderBottomWidth: 4,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  bracket: {
    position: 'absolute',
    width: 10,
    height: 24,
  },
  bracketLeft: {
    left: 0,
    borderLeftWidth: 2,
    borderTopWidth: 2,
    borderBottomWidth: 2,
  },
  bracketRight: {
    right: 0,
    borderRightWidth: 2,
    borderTopWidth: 2,
    borderBottomWidth: 2,
  },

  // Blink Eyes
  blinkWrap: {
    position: 'absolute',
    top: FRAME_TOP + FRAME_HEIGHT * 0.32,
    left: FRAME_LEFT + FRAME_WIDTH * 0.2,
    width: FRAME_WIDTH * 0.6,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eyeReticle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyePupil: {
    width: 22,
    height: 14,
    borderRadius: 7,
  },
});
