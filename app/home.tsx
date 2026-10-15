import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router, useFocusEffect } from 'expo-router'
import { useCallback } from 'react'
import { Alert, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { prefetchCommuteLocation } from '@/lib/attendance/locationPrefetch'
import { getAppSession, logoutAppSession } from '@/lib/auth/storage'
import { font } from '@/lib/fonts'

// 메인 화면 (로그인 후 진입, 출·퇴근 / 위생 점검 업무 선택)

// 헤더 가운데 심볼 로고 이미지
const symbolImage = require('../public/image/thefull_logo.png')

// 업무 메뉴 버튼 정보 (제목, 설명, 아이콘과 색상, 이동 경로)
type MenuCard = {
  title: string
  subtitle: string
  icon: keyof typeof MaterialCommunityIcons.glyphMap
  iconBg: string
  iconFg: string
  // 이동 경로
  route: '/attendance' | '/hygiene'
}

// 업무 메뉴 버튼 목록
const menuCards: MenuCard[] = [
  {
    title: '출·퇴근',
    subtitle: '출근·퇴근 시간을 기록하고\n오늘 근무 상태를 확인합니다.',
    icon: 'clock-check-outline',
    iconBg: '#eaf5fa',
    iconFg: '#1593c4',
    route: '/attendance',
  },
  {
    title: '위생 점검',
    subtitle: '항목별 조치 전·후 사진과\n조치 내용을 기록합니다.',
    icon: 'spray-bottle',
    iconBg: '#eaf7ef',
    iconFg: '#2a7a49',
    route: '/hygiene',
  },
]

// 오늘 날짜 "2026.10.12 (월)" 형식 문자열 생성
function formatToday() {
  const today = new Date()
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][today.getDay()]
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const date = String(today.getDate()).padStart(2, '0')

  return `${today.getFullYear()}.${month}.${date} (${weekday})`
}

export default function HomeScreen() {
  // 태블릿 폭 여부 (가운데 정렬 최대 폭 적용 기준)
  const { width } = useWindowDimensions()
  const isTablet = width >= 768

  // 화면 진입 시 로그인 상태 확인 (로그인 정보가 없으면 로그인 화면으로 이동)
  // 로그인 상태면 출퇴근 화면 진입에 대비해 GPS 위치를 미리 조회 (권한이 이미 허용된 경우만)
  useFocusEffect(
    useCallback(() => {
      void getAppSession().then((session) => {
        if (!session) {
          router.replace('/login')
          return
        }
        prefetchCommuteLocation()
      })
    }, [])
  )

  // 메뉴 버튼 처리 (선택한 업무 화면으로 이동)
  const handlePressMenu = (card: MenuCard) => {
    router.push(card.route)
  }

  // 로그아웃 버튼 처리 (로그인 정보 삭제 후 로그인 화면 이동)
  const handleLogout = () => {
    Alert.alert('로그아웃', '로그아웃할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '로그아웃',
        style: 'destructive',
        onPress: () => {
          void logoutAppSession().then(() => router.replace('/login'))
        },
      },
    ])
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      {/* 화면 전체 틀 (태블릿은 가운데 최대 폭) */}
      <View style={[styles.frame, isTablet && styles.frameTablet]}>
        {/* 상단 헤더 (왼쪽 로그아웃, 가운데 심볼 로고·앱 이름, 오른쪽 오늘 날짜) */}
        <View style={styles.header}>
          {/* 왼쪽 로그아웃 버튼 */}
          <View style={styles.headerSide}>
            <Pressable hitSlop={8} style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutButtonText}>로그아웃</Text>
            </Pressable>
          </View>
          {/* 가운데 심볼 로고와 앱 이름 */}
          <View style={styles.headerBrand}>
            <Image source={symbolImage} style={styles.headerLogo} />
            <Text style={styles.headerTitle}>채움원</Text>
          </View>
          {/* 오른쪽 오늘 날짜 */}
          <View style={[styles.headerSide, styles.headerSideRight]}>
            <Text style={styles.headerDate}>{formatToday()}</Text>
          </View>
        </View>

        {/* 업무 메뉴 버튼 영역 */}
        <View style={styles.body}>
          {menuCards.map((card) => (
            // 위아래 1:1로 나눈 업무 메뉴 버튼
            <Pressable
              key={card.title}
              onPress={() => handlePressMenu(card)}
              style={({ pressed }) => [styles.menuCard, pressed && styles.menuCardPressed]}
            >
              {/* 업무 아이콘 */}
              <View style={[styles.menuIcon, { backgroundColor: card.iconBg }]}>
                <MaterialCommunityIcons name={card.icon} size={40} color={card.iconFg} />
              </View>
              {/* 업무명과 설명 */}
              <Text style={styles.menuTitle}>{card.title}</Text>
              <Text style={styles.menuDescription}>{card.subtitle}</Text>
              {/* 바로가기 링크 */}
              <View style={styles.menuLink}>
                <Text style={styles.menuLinkText}>바로가기</Text>
                <MaterialCommunityIcons name="chevron-right" size={16} color="#1687b2" />
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  )
}

// 메인 화면 스타일
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  frame: {
    flex: 1,
    backgroundColor: '#f3f6f8',
  },
  frameTablet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
  },
  body: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
    gap: 12,
  },
  header: {
    height: 64,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  headerSide: {
    flex: 1,
  },
  headerSideRight: {
    alignItems: 'flex-end',
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerLogo: {
    width: 38,
    height: 28,
    resizeMode: 'contain',
  },
  headerTitle: {
    color: '#172431',
    fontSize: 22,
    fontFamily: font.bold,
  },
  headerDate: {
    color: '#5b6a79',
    fontSize: 16,
    fontFamily: font.semibold,
  },
  menuCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 20,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dde5eb',
    backgroundColor: '#ffffff',
  },
  menuCardPressed: {
    borderColor: '#9cc9db',
    backgroundColor: '#f1f8fb',
  },
  logoutButton: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ccd8e0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#ffffff',
  },
  logoutButtonText: {
    color: '#52606d',
    fontSize: 14,
    fontFamily: font.medium,
  },
  menuIcon: {
    width: 76,
    height: 76,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  menuTitle: {
    color: '#273542',
    fontSize: 22,
    fontFamily: font.bold,
  },
  menuDescription: {
    color: '#728190',
    fontSize: 14,
    fontFamily: font.regular,
    lineHeight: 20,
    textAlign: 'center',
  },
  menuLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 4,
  },
  menuLinkText: {
    color: '#1687b2',
    fontSize: 14,
    fontFamily: font.medium,
  },
})
