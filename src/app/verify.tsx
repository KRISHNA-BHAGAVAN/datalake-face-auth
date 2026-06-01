import React, { useEffect } from 'react';
import { View, StyleSheet, Text, Button } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraPreview } from '../camera/CameraPreview';
import { GuidanceOverlay } from '../components/GuidanceOverlay';
import { LivenessStatus } from '../components/LivenessStatus';
import { useFaceAuth } from '../hooks/useFaceAuth';

export default function VerifyScreen() {
  const router = useRouter();
  const {
    livenessState,
    authStatus,
    message,
    cameraRef,
    startVerification,

    reset
  } = useFaceAuth();

  useEffect(() => {
    startVerification();
    return () => reset();
  }, [startVerification, reset]);

  return (
    <View style={styles.container}>
      <CameraPreview 
        ref={cameraRef}
      />
      
      <GuidanceOverlay />
      
      <LivenessStatus state={livenessState} />
      
      {(authStatus === 'SUCCESS' || authStatus === 'FAILED') && (
        <View style={styles.overlay}>
          <Text style={styles.message}>{message}</Text>
          {authStatus === 'FAILED' ? (
            <>
              <Button title="Try Again" onPress={() => { reset(); startVerification(); }} />
              <Button title="Go Back" onPress={() => router.back()} />
            </>
          ) : (
            <Button title="Go Back" onPress={() => router.back()} />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  overlay: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 30
  },
  message: { color: 'white', fontSize: 22, fontWeight: 'bold', marginBottom: 20 }
});
