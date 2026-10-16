import { StyleSheet, Text, View } from 'react-native'

import { font } from '@/lib/fonts'

// 둥근 상태 배지 (compact: 좁은 카드 한 줄에 여러 개 넣을 때 쓰는 작은 크기)
export default function Badge({
  label,
  bg,
  fg,
  compact = false,
}: {
  label: string
  bg: string
  fg: string
  compact?: boolean
}) {
  return (
    <View style={[styles.badge, compact && styles.badgeCompact, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, compact && styles.badgeTextCompact, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

// 상태 배지 스타일
const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  badgeCompact: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: font.medium,
  },
  badgeTextCompact: {
    fontSize: 11,
  },
})
