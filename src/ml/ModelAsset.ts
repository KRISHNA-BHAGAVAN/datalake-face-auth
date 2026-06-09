import { Asset } from 'expo-asset';
import type { ModelSource } from 'react-native-fast-tflite';

/**
 * react-native-fast-tflite's Android loader expects a URL with a protocol.
 * Expo release builds can resolve bundled assets to bare Android resource names,
 * so copy the asset to cache first and pass the resulting file:// URI.
 */
export async function resolveTfliteAsset(moduleId: number): Promise<ModelSource> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();

  const uri = asset.localUri ?? asset.uri;
  if (!uri || !uri.includes(':')) {
    throw new Error(`TFLite model asset did not resolve to a loadable URI: ${uri || 'empty'}`);
  }

  return { url: uri };
}
