import { router } from 'expo-router'
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'

type MenuCard = {
  title: string
  subtitle: string
  accent: string
  tone: string
  route: '/attendance' | '/hygiene'
}

const menuCards: MenuCard[] = [
  {
    title: '출퇴근',
    subtitle: '출근과 퇴근 시간을 기록하고 오늘 근무 상태를 바로 확인할 수 있습니다.',
    accent: '#d7bb72',
    tone: '#18372c',
    route: '/attendance',
  },
  {
    title: '위생관리',
    subtitle: '점검 사진 등록부터 미조치 건 확인과 조치 내용 입력까지 한 번에 이어서 관리할 수 있습니다.',
    accent: '#dce8df',
    tone: '#24493b',
    route: '/hygiene',
  },
]

export default function HomeScreen() {
  const { width } = useWindowDimensions()
  const isCompact = width < 390
  const isTablet = width >= 768

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          isCompact && styles.contentCompact,
          isTablet && styles.contentTablet,
        ]}
      >
        <View style={[styles.menuGrid, isTablet && styles.menuGridTablet]}>
          {menuCards.map((card) => (
            <Pressable
              key={card.title}
              onPress={() => router.push(card.route)}
              style={[
                styles.menuCard,
                isTablet && styles.menuCardTablet,
                { backgroundColor: card.accent },
              ]}
            >
              <View style={[styles.iconCircle, { backgroundColor: card.tone }]}>
                <Text style={styles.iconText}>{card.title.slice(0, 1)}</Text>
              </View>
              <Text style={styles.menuTitle}>{card.title}</Text>
              <Text style={styles.menuDescription}>{card.subtitle}</Text>
              <View style={styles.menuFooter}>
                <Text style={styles.menuFooterText}>바로가기</Text>
                <Text style={styles.menuArrow}>+</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4efe6',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 36,
    gap: 18,
  },
  contentCompact: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 28,
  },
  contentTablet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 980,
    paddingTop: 40,
  },
  menuGrid: {
    gap: 16,
  },
  menuGridTablet: {
    flexDirection: 'row',
  },
  menuCard: {
    flex: 1,
    minHeight: 220,
    borderRadius: 28,
    padding: 22,
    gap: 14,
  },
  menuCardTablet: {
    minHeight: 260,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    color: '#fffdf8',
    fontSize: 22,
    fontWeight: '800',
  },
  menuTitle: {
    color: '#18372c',
    fontSize: 28,
    fontWeight: '800',
  },
  menuDescription: {
    color: '#314840',
    fontSize: 15,
    lineHeight: 23,
  },
  menuFooter: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menuFooterText: {
    color: '#18372c',
    fontSize: 14,
    fontWeight: '700',
  },
  menuArrow: {
    color: '#18372c',
    fontSize: 26,
    fontWeight: '400',
  },
})
