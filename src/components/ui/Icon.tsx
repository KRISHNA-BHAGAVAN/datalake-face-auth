import React from 'react';
import { ColorValue } from 'react-native';
import { SymbolView, SymbolViewProps } from 'expo-symbols';
import { colors, iconSize } from '../../theme';

/** Forces every entry below to be validated against the real symbol catalogs. */
type SymbolName = Extract<SymbolViewProps['name'], object>;

/**
 * The app's single icon family: SF Symbols on iOS, Material Symbols on Android
 * and web. Both ship with the binary, so icons render offline.
 *
 * Every icon the app uses is named here. Components reference the semantic key,
 * never a platform symbol string — that keeps one glyph per concept and makes a
 * swap a one-line change.
 */
const ICONS = {
  enroll: { ios: 'person.crop.circle.badge.plus', android: 'person_add', web: 'person_add' },
  verify: { ios: 'faceid', android: 'face_unlock', web: 'face_unlock' },
  antiSpoof: { ios: 'checkmark.shield', android: 'shield', web: 'shield' },
  liveness: { ios: 'eye', android: 'visibility', web: 'visibility' },
  upload: { ios: 'icloud.and.arrow.up', android: 'cloud_upload', web: 'cloud_upload' },
  download: { ios: 'icloud.and.arrow.down', android: 'cloud_download', web: 'cloud_download' },
  removeLocal: { ios: 'minus.circle', android: 'remove_circle', web: 'remove_circle' },
  delete: { ios: 'trash', android: 'delete', web: 'delete' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },
  chevron: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  flipCamera: {
    ios: 'arrow.triangle.2.circlepath.camera',
    android: 'cameraswitch',
    web: 'cameraswitch',
  },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  retry: { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' },
  smile: { ios: 'face.smiling', android: 'sentiment_satisfied', web: 'sentiment_satisfied' },
  turnLeft: { ios: 'arrow.left.circle', android: 'arrow_circle_left', web: 'arrow_circle_left' },
  turnRight: { ios: 'arrow.right.circle', android: 'arrow_circle_right', web: 'arrow_circle_right' },
  offline: { ios: 'wifi.slash', android: 'cloud_off', web: 'cloud_off' },
  privacy: { ios: 'lock.shield', android: 'shield_lock', web: 'shield_lock' },
  speed: { ios: 'speedometer', android: 'speed', web: 'speed' },
  footprint: { ios: 'memorychip', android: 'memory', web: 'memory' },
  camera: { ios: 'camera', android: 'photo_camera', web: 'photo_camera' },
} as const satisfies Record<string, SymbolName>;

export type IconName = keyof typeof ICONS;

interface Props {
  name: IconName;
  /** One of the icon size tokens. Defaults to `md` (20). */
  size?: keyof typeof iconSize;
  color?: ColorValue;
}

export function Icon({ name, size = 'md', color = colors.textSecondary }: Props) {
  const px = iconSize[size];
  return (
    <SymbolView
      name={ICONS[name]}
      size={px}
      tintColor={color}
      weight="medium"
      style={{ width: px, height: px }}
    />
  );
}
