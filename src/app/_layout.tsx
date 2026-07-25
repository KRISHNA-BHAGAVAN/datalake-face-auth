import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { navHeader } from '../theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      {/* Dark status-bar content: every screen, including the camera chrome,
          sits on a light surface. */}
      <StatusBar style="dark" />
      <Stack screenOptions={navHeader}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        {/* Full-bleed camera. Cancel and flip are floating controls instead of
            a header bar, so the preview isn't cropped by app chrome. */}
        <Stack.Screen name="enroll" options={{ headerShown: false }} />
        <Stack.Screen name="verify" options={{ headerShown: false }} />
        <Stack.Screen name="about" options={{ title: 'About' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
