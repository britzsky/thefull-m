import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: {
            backgroundColor: '#f4efe6',
          },
          headerTitleStyle: {
            color: '#15392d',
            fontWeight: '700',
          },
          contentStyle: {
            backgroundColor: '#f4efe6',
          },
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen
          name="attendance"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        {/* 출퇴근 전용 운영 기간에는 메인·위생 화면 진입 경로를 노출하지 않습니다. */}
        {/* <Stack.Screen name="home" options={{ title: '메인화면' }} /> */}
        {/* <Stack.Screen name="hygiene" options={{ title: '위생관리' }} /> */}
      </Stack>
    </>
  )
}
