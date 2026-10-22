import { useFonts } from 'expo-font'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { LogBox, StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'

import { pretendardFonts } from '@/lib/fonts'
import startLogoHtml from '@/lib/startLogoHtml'

// 라이브러리 내부 네이티브 애니메이션이 내는 개발 모드 경고 숨김 (동작 영향 없음)
LogBox.ignoreLogs(['Sending `onAnimatedValueUpdate` with no listeners registered'])

// 네이티브 스플래시(빈 배경)를 인트로 HTML이 그려질 때까지 유지
SplashScreen.preventAutoHideAsync()

// 인트로가 끝나지 않을 때(WebView 오류 등) 강제로 닫는 시간(ms)
const INTRO_TIMEOUT_MS = 10000

// 앱 공통 레이아웃 (폰트 로딩, 상태바, 화면 스택 설정, 시작 인트로)
export default function RootLayout() {
  // Pretendard 폰트 로딩 상태 (실패해도 기본 폰트로 화면은 표시)
  const [fontsLoaded, fontError] = useFonts(pretendardFonts)
  // 시작 인트로 애니메이션 종료 여부 (true면 인트로 화면 제거)
  const [introDone, setIntroDone] = useState(false)

  // 인트로를 닫고 첫 화면을 보여주는 함수 (애니메이션 종료·오류·시간 초과 시 호출)
  const finishIntro = () => {
    SplashScreen.hideAsync()
    setIntroDone(true)
  }

  // 인트로가 끝나지 않는 경우를 대비한 강제 종료 타이머
  useEffect(() => {
    const timer = setTimeout(finishIntro, INTRO_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [])

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
      {/* 시작 인트로 영역 (파티클이 모여 로고가 완성되는 HTML 애니메이션, 1회 재생 후 제거) */}
      {!introDone && (
        <View style={styles.intro}>
          <WebView
            source={{ html: startLogoHtml }}
            style={styles.intro}
            originWhitelist={['*']}
            scrollEnabled={false}
            onLoadEnd={() => SplashScreen.hideAsync()}
            onMessage={(event) => {
              if (event.nativeEvent.data === 'done') finishIntro()
            }}
            onError={finishIntro}
          />
        </View>
      )}
    </>
  )
}

const styles = StyleSheet.create({
  // 인트로 전체 화면 (HTML 시작 배경색과 동일)
  intro: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#f8fbff',
  },
})
