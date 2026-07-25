/**
 * Design tokens for Datalake Face Auth.
 *
 * Light, neutral, utility-first. One accent (blue) for interaction; green and
 * red are reserved for authentication outcomes only — never decoration.
 * Every text/background pair below meets WCAG AA (4.5:1 body, 3:1 large).
 *
 * Screens and the component kit read from here exclusively. No raw hex in
 * components.
 */
import { Platform, TextStyle, ViewStyle } from 'react-native';

export const colors = {
  // Surfaces
  canvas: '#F7F8FA', // page background
  surface: '#FFFFFF', // cards, list groups, sheets
  surfaceSunken: '#F1F3F6', // tracks, wells, inset fields
  surfacePressed: '#F2F4F7',

  // Lines
  border: '#E4E7EC', // hairlines between rows, card outlines
  borderStrong: '#D0D5DD', // emphasised outlines, dividers on white

  // Text — contrast on #FFFFFF
  text: '#101828', // 16.4:1
  textSecondary: '#475467', // 8.6:1
  textTertiary: '#667085', // 5.6:1 — meta only, never body copy

  // Accent — interaction
  primary: '#175CD3', // 5.9:1 on white; white on it is 5.9:1
  primaryHover: '#1349A8',
  primarySoft: '#EFF4FF',
  primaryBorder: '#B2CCFF',

  // Semantic — authentication outcomes
  success: '#067647', // 5.3:1
  successSoft: '#ECFDF3',
  successBorder: '#ABEFC6',
  danger: '#B42318', // 6.4:1
  dangerSoft: '#FEF3F2',
  dangerBorder: '#FECDCA',
  warning: '#B54708', // 5.3:1
  warningSoft: '#FFFAEB',
  warningBorder: '#FEDF89',

  // On-color foregrounds
  onPrimary: '#FFFFFF',
  onDark: '#FFFFFF',

  // Camera surfaces — chrome that sits on the live preview
  scrim: 'rgba(16, 24, 40, 0.45)', // dims the preview outside the face frame
  overlayScrim: 'rgba(247, 248, 250, 0.97)', // result sheet over the preview
  flash: '#FFFFFF', // one-shot capture flash, fired per real photo taken
} as const;

/** 4pt rhythm. Use these names, not raw numbers. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

/** Icon sizes. Pick one of these — never an arbitrary value. */
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

/**
 * Two elevation levels only. Level 1 lifts cards off the canvas; level 2 is for
 * chrome floating over the camera preview.
 */
export const elevation: Record<'level1' | 'level2', ViewStyle> = {
  level1: {
    shadowColor: '#101828',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  level2: {
    shadowColor: '#101828',
    shadowOpacity: 0.12,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
};

/** Micro-interaction durations, in ms. */
export const motion = {
  fast: 140,
  base: 220,
  slow: 320,
} as const;

/** Tabular figures keep metrics from jittering as values change. */
const tabular = { fontVariant: ['tabular-nums'] } as TextStyle;

export const type = {
  display: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: colors.text,
  } as TextStyle,
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.text,
  } as TextStyle,
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600', color: colors.text } as TextStyle,
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400', color: colors.text } as TextStyle,
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: colors.text } as TextStyle,
  secondary: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
    color: colors.textSecondary,
  } as TextStyle,
  caption: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    color: colors.textTertiary,
  } as TextStyle,
  /** Grouped-list section header. */
  sectionHeader: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  } as TextStyle,
  /** Small caps label above a value. */
  fieldLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
    color: colors.textTertiary,
  } as TextStyle,
  metric: {
    ...tabular,
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '700',
    letterSpacing: -1.2,
    color: colors.text,
  } as TextStyle,
  metricSm: {
    ...tabular,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    color: colors.text,
  } as TextStyle,
  numeric: { ...tabular, fontSize: 15, lineHeight: 22, fontWeight: '500', color: colors.text } as TextStyle,
} as const;

/** Minimum tappable area per platform guidance. */
export const hitTarget = Platform.select({ ios: 44, default: 48 }) as number;

/** Stack navigator styling shared across screens. */
export const navHeader = {
  headerStyle: { backgroundColor: colors.canvas },
  headerTintColor: colors.primary,
  headerTitleStyle: { color: colors.text, fontSize: 17, fontWeight: '600' as const },
  headerShadowVisible: false,
  headerBackTitle: '',
  contentStyle: { backgroundColor: colors.canvas },
};
