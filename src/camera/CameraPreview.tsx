import React, { forwardRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CameraView, CameraType } from 'expo-camera';
import { useCameraPermissions } from './useCameraPermissions';

interface CameraPreviewProps {
  /** Which physical camera to use. Defaults to the front (selfie) camera. */
  facing?: CameraType;
}

export const CameraPreview = forwardRef<any, CameraPreviewProps>(({ facing = 'front' }, ref) => {
  const { hasPermission, requestPermission } = useCameraPermissions();

  if (hasPermission === null) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#208AEF" />
        <Text style={styles.loadingText}>Initializing camera...</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.errorText}>No Camera Permission</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={ref}
        style={StyleSheet.absoluteFill}
        facing={facing}
        mute={true}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { color: '#aaa', marginTop: 10, fontSize: 16 },
  errorText: { color: 'white', marginBottom: 20, fontSize: 16, textAlign: 'center' },
  button: {
    backgroundColor: '#208AEF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  buttonText: { color: 'white', fontWeight: 'bold', fontSize: 16 }
});
