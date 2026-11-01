import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router, useFocusEffect } from 'expo-router'
import { useCallback } from 'react'
import { Alert, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { prefetchCommuteLocation } from '@/lib/attendance/locationPrefetch'
import { getAppSession, logoutAppSession } from '@/lib/auth/storage'
import { font } from '@/lib/fonts'

// 메인 화면 (로그인 후 진입, 출·퇴근 / 위생 점검 / 지점 업로드 / 전자계약 업무 선택, 2열 × 2행)

// 헤더 가운데 심볼 로고 이미지
const symbolImage = require('../public/image/thefull_logo.png')

// 업무 메뉴 버튼 정보 (제목, 설명, 아이콘과 색상, 이동 경로)
type MenuCard = {
  title: string
  subtitle: string
  icon: keyof typeof MaterialCommunityIcons.glyphMap
  iconBg: string
  iconFg: string
  // 이동 경로 (없으면 준비 중 카드)
  route?: '/attendance' | '/hygiene' | '/branch-upload'
}

// 업무 메뉴 버튼 목록 (2개씩 한 줄)
const menuCards: MenuCard[] = [
  {
    title: '출·퇴근',
    subtitle: '근무시간 기록 및 조회',
    icon: 'clock-check-outline',
    iconBg: '#eaf5fa',
    iconFg: '#1593c4',
    route: '/attendance',
  },
  {
    title: '위생 점검',
    subtitle: '조치 전·후 사진과 기록',
    icon: 'spray-bottle',
    iconBg: '#eaf7ef',
    iconFg: '#2a7a49',
    route: '/hygiene',
  },
  {
    title: '지점 업로드',
    subtitle: '식단표 및 식판 사진 기록',
    icon: 'image-multiple-outline',
    iconBg: '#fdf1e6',
    iconFg: '#d9822b',
    route: '/branch-upload',
  },
  {
    title: '전자계약',
    subtitle: '계약서 작성 및 관리',
    icon: 'file-document-edit-outline',
    iconBg: '#f0edf9',
    iconFg: '#7a68b8',
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
    if (card.route) router.push(card.route)
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
          {/* 안내 문구 */}
          <View>
            <Text style={styles.greetTitle}>오늘도 안전하고 편리하게</Text>
            <Text style={styles.greetText}>필요한 업무를 선택해주세요.</Text>
          </View>

          {/* 2개씩 한 줄로 나눈 업무 메뉴 버튼 */}
          {[menuCards.slice(0, 2), menuCards.slice(2, 4)].map((rowCards) => (
            <View key={rowCards[0].title} style={styles.menuRow}>
              {rowCards.map((card) => (
                // 업무 메뉴 버튼 (경로가 없는 카드는 업무명 없이 준비 중 문구만 표시, 비활성)
                <Pressable
                  key={card.title}
                  disabled={!card.route}
                  onPress={() => handlePressMenu(card)}
                  style={({ pressed }) => [styles.menuCard, !card.route && styles.menuCardDisabled, pressed && styles.menuCardPressed]}
                >
                  {card.route ? (
                    <>
                      {/* 업무 아이콘 */}
                      <View style={[styles.menuIcon, { backgroundColor: card.iconBg }]}>
                        <MaterialCommunityIcons name={card.icon} size={34} color={card.iconFg} />
                      </View>
                      {/* 업무명과 설명 */}
                      <Text style={styles.menuTitle}>{card.title}</Text>
                      <Text style={styles.menuDescription}>{card.subtitle}</Text>
                      {/* 바로가기 링크 */}
                      <View style={styles.menuLink}>
                        <Text style={[styles.menuLinkText, { color: card.iconFg }]}>바로가기</Text>
                        <MaterialCommunityIcons name="chevron-right" size={16} color={card.iconFg} />
                      </View>
                    </>
                  ) : (
                    <Text style={styles.menuReadyText}>준비 중</Text>
                  )}
                </Pressable>
              ))}
            </View>
          ))}

          {/* 하단 안내 박스 */}
          <View style={styles.infoBox}>
            <MaterialCommunityIcons name="briefcase-outline" size={18} color="#1687b2" />
            <Text style={styles.infoText}>지점에서 필요한 자료를 한곳에서 관리합니다.</Text>
          </View>
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
  greetTitle: {
    color: '#172431',
    fontSize: 18,
    fontFamily: font.bold,
  },
  greetText: {
    color: '#7a8998',
    fontSize: 14,
    fontFamily: font.regular,
    marginTop: 4,
  },
  menuRow: {
    flex: 1,
    maxHeight: 240,
    flexDirection: 'row',
    gap: 12,
  },
  menuCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#dde5eb',
    backgroundColor: '#ffffff',
  },
  menuCardPressed: {
    borderColor: '#9cc9db',
    backgroundColor: '#f1f8fb',
  },
  menuCardDisabled: {
    backgroundColor: '#f8f9fb',
  },
  menuReadyText: {
    color: '#8a98a6',
    fontSize: 16,
    fontFamily: font.medium,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 16,
    borderRadius: 14,
    backgroundColor: '#ffffff',
  },
  infoText: {
    flex: 1,
    color: '#52606d',
    fontSize: 13,
    fontFamily: font.regular,
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
    width: 62,
    height: 62,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  menuTitle: {
    color: '#273542',
    fontSize: 21,
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
    fontSize: 16,
    fontFamily: font.medium,
  },
})
