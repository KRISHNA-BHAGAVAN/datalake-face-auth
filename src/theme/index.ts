/**
 * Dark "secure-tech" design tokens for the Datalake Face Auth prototype.
 *
 * Single source of truth for colors, spacing, radius and type. Screens and the
 * component kit pull from here so the whole app stays visually consistent and
 * easy to retune before the demo.
 */
import { Platform, TextStyle } from 'react-native';

export const colors = {
  // Surfaces
  bg: '#0A0E14', // near-black app background
  bgElevated: '#0F141C',
  surface: '#141A24', // card base
  surfaceTranslucent: 'rgba(20, 26, 36, 0.72)', // "glass" cards over camera
  hairline: 'rgba(0, 229, 255, 0.18)', // cyan-tinted border
  hairlineSoft: 'rgba(255, 255, 255, 0.08)',

  // Brand / accents
  primary: '#00E5FF', // cyan — interactive + scan accents
  primaryDim: 'rgba(0, 229, 255, 0.12)',
  success: '#00FF9C', // live / pass / verified
  successDim: 'rgba(0, 255, 156, 0.12)',
  danger: '#FF4D5E', // spoof / fail
  dangerDim: 'rgba(255, 77, 94, 0.12)',
  warn: '#FFC857', // in-progress / caution

  // Text
  text: '#F5F8FF',
  textSecondary: '#9BA8BD',
  textMuted: '#5C6B82',
  onPrimary: '#031016', // text on cyan fills
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

const mono = Platform.select({ ios: 'ui-monospace', android: 'monospace', default: 'monospace' });

export const type = {
  display: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5, color: colors.text } as TextStyle,
  title: { fontSize: 22, fontWeight: '700', color: colors.text } as TextStyle,
  heading: { fontSize: 17, fontWeight: '700', color: colors.text } as TextStyle,
  body: { fontSize: 15, fontWeight: '500', color: colors.text } as TextStyle,
  secondary: { fontSize: 13, fontWeight: '500', color: colors.textSecondary } as TextStyle,
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textMuted,
  } as TextStyle,
  metric: { fontSize: 44, fontWeight: '800', letterSpacing: -1, color: colors.text } as TextStyle,
  mono: { fontFamily: mono, fontSize: 13, color: colors.textSecondary } as TextStyle,
} as const;

/** Stack navigator header styling shared across screens. */
export const navHeader = {
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.primary,
  headerTitleStyle: { color: colors.text, fontWeight: '700' as const },
  headerShadowVisible: false,
  contentStyle: { backgroundColor: colors.bg },
};
