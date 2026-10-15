import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { LogBox } from 'react-native'

import { pretendardFonts } from '@/lib/fonts'

// 라이브러리 내부 네이티브 애니메이션이 내는 개발 모드 경고 숨김 (동작 영향 없음)
LogBox.ignoreLogs(['Sending `onAnimatedValueUpdate` with no listeners registered'])

// 앱 공통 레이아웃 (폰트 로딩, 상태바, 화면 스택 설정)
export default function RootLayout() {
  // Pretendard 폰트 로딩 상태 (실패해도 기본 폰트로 화면은 표시)
  const [fontsLoaded, fontError] = useFonts(pretendardFonts)

  if (!fontsLoaded && !fontError) {
    return null
  }

  return (
    <>
      {/* 어두운 글씨 상태바 */}
      <StatusBar style="dark" />
      {/* 화면 스택 (기본 헤더 스타일, 화면별 헤더 표시 설정) */}
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
        {/* 로그인 후 메인(출퇴근·위생 점검 선택), 위생 화면은 로컬 개발에서만 진입 */}
        <Stack.Screen name="home" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="hygiene" options={{ headerShown: false }} />
      </Stack>
    </>
  )
}
