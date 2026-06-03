import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { navHeader } from '../theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack screenOptions={navHeader}>
        <Stack.Screen name="index" options={{ title: 'Datalake Face Auth', headerShown: false }} />
        <Stack.Screen name="enroll" options={{ title: 'Enrollment' }} />
        <Stack.Screen name="verify" options={{ title: 'Verification' }} />
        <Stack.Screen name="about" options={{ title: 'About' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
