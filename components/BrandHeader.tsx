import { useEffect, useState, type ReactNode } from 'react'
import { Image, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native'

import { font } from '@/lib/fonts'

// 왼쪽 워드마크 로고 이미지 (Figma V6 헤더 로고)
const logoImage = require('../public/image/thefull_logo_wordmark.png')

// 키보드 표시 여부 (아이폰은 올라가기 시작할 때, 안드로이드는 올라온 뒤 반영)
function useKeyboardVisible() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const showListener = Keyboard.addListener(showEvent, () => setVisible(true))
    const hideListener = Keyboard.addListener(hideEvent, () => setVisible(false))

    return () => {
      showListener.remove()
      hideListener.remove()
    }
  }, [])

  return visible
}

// 화면 상단 공통 헤더 (왼쪽 로고, 가운데 제목·부제목, 오른쪽 상태 영역)
// 키보드가 올라와 있으면 오른쪽 칸에 키보드 닫기(완료) 버튼 표시 (안드로이드·아이폰 공통)
export default function BrandHeader({
  title,
  subtitle,
  left,
  right,
  largeTitle = false,
  largeText = false,
  centerLogo = false,
}: {
  title?: string
  subtitle?: string
  // 왼쪽 칸 요소 (뒤로 버튼 등, 넣으면 왼쪽 로고 대신 표시)
  left?: ReactNode
  right?: ReactNode
  // 제목 크게 표시 여부 (부제목 없이 제목만 쓰는 로그인 화면용)
  largeTitle?: boolean
  // 제목·부제목 글씨를 지점 업로드 화면 제목 바와 같은 크기로 표시 (제목 20, 부제목 14)
  largeText?: boolean
  // 제목 대신 가운데에 로고 표시 여부 (로그인 화면용, 왼쪽 로고는 숨김)
  centerLogo?: boolean
}) {
  // 키보드 표시 여부 (완료 버튼 노출 기준)
  const isKeyboardVisible = useKeyboardVisible()

  return (
    // 헤더 한 줄 (좌·중·우 3등분)
    <View style={styles.header}>
      {/* 왼쪽 로고 칸 (left 요소가 있으면 로고 대신 표시) */}
      <View style={styles.logoSlot}>
        {left ?? (centerLogo ? null : <Image source={logoImage} style={styles.logo} />)}
      </View>
      {/* 가운데 제목·부제목 칸 (centerLogo면 로고 표시) */}
      <View style={styles.center}>
        {centerLogo ? (
          <Image source={logoImage} style={styles.logoCenter} />
        ) : (
          <Text style={[styles.title, (largeTitle || largeText) && styles.titleLarge]}>{title}</Text>
        )}
        {subtitle ? <Text style={[styles.subtitle, largeText && styles.subtitleLarge]}>{subtitle}</Text> : null}
      </View>
      {/* 오른쪽 칸 (키보드 표시 중에는 완료 버튼, 그 외에는 상태 배지 등 추가 요소) */}
      <View style={styles.rightSlot}>
        {isKeyboardVisible ? (
          <Pressable hitSlop={8} style={styles.doneButton} onPress={() => Keyboard.dismiss()}>
            <Text style={styles.doneButtonText}>완료</Text>
          </Pressable>
        ) : (
          right
        )}
      </View>
    </View>
  )
}

// 공통 헤더 스타일
const styles = StyleSheet.create({
  header: {
    height: 64,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  logoSlot: {
    flex: 1,
    alignItems: 'flex-start',
  },
  logo: {
    width: 110,
    height: 34,
    resizeMode: 'contain',
  },
  // 가운데 로고 (로그인 화면)
  logoCenter: {
    width: 140,
    height: 40,
    resizeMode: 'contain',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
  },
  title: {
    color: '#172431',
    fontSize: 16,
    fontFamily: font.bold,
  },
  titleLarge: {
    fontSize: 20,
  },
  subtitle: {
    color: '#7a8998',
    fontSize: 12,
    fontFamily: font.regular,
  },
  subtitleLarge: {
    fontSize: 14,
  },
  doneButton: {
    height: 30,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1593c4',
  },
  doneButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontFamily: font.bold,
  },
  rightSlot: {
    flex: 1,
    alignItems: 'flex-end',
  },
})
