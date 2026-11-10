import { useCallback, useRef, useState } from 'react'
import { Platform, RefreshControl, StyleSheet, Text } from 'react-native'

import { font } from '@/lib/fonts'

// 화면을 아래로 당겨 새로고침하는 공통 훅
// load: 화면 자료를 다시 조회하는 함수 (끝날 때까지 새로고침 표시 유지, 실패해도 표시는 닫음)
// 반환: refreshControl = ScrollView·FlatList의 refreshControl 값, notice = 스크롤 내용 맨 위에 두는 새로고침 중 안내 문구
// 아이폰은 당기는 동안·새로고침 중 문구를 기본 표시 아래에 보여주고, 안드로이드는 기본 표시가 문구를 지원하지 않아 새로고침 중에만 notice로 안내
export function usePullRefresh(load: () => Promise<unknown> | void) {
  // 당겨서 새로고침 진행 중 여부
  const [refreshing, setRefreshing] = useState(false)
  // 아이폰 문구가 '새로고침 중입니다'인지 (새로고침 표시가 다 접힌 뒤에 원래 문구로 돌려 접히는 동안 문구가 바뀌어 보이지 않게 함)
  const [showBusyTitle, setShowBusyTitle] = useState(false)
  // 렌더마다 바뀌는 조회 함수의 최신값 (onRefresh를 다시 만들지 않기 위해 보관)
  const loadRef = useRef(load)
  loadRef.current = load
  // 문구 되돌리기 예약 (연속으로 당기면 이전 예약 취소)
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onRefresh = useCallback(() => {
    if (titleTimerRef.current) clearTimeout(titleTimerRef.current)
    setShowBusyTitle(true)
    setRefreshing(true)
    const startedAt = Date.now()
    void Promise.resolve()
      .then(() => loadRef.current())
      .catch(() => undefined)
      // 조회가 빨리 끝나도 '새로고침 중입니다'가 깜빡이지 않게 최소 0.6초 표시
      .then(() => new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_REFRESH_MS - (Date.now() - startedAt)))))
      .finally(() => {
        setRefreshing(false)
        titleTimerRef.current = setTimeout(() => setShowBusyTitle(false), COLLAPSE_MS)
      })
  }, [])

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      title={showBusyTitle ? '새로고침 중입니다' : '아래로 당기면 새로고침'}
      titleColor="#7a8998"
      tintColor="#7a8998"
      colors={['#1593c4']}
    />
  )

  // 안드로이드 새로고침 중 안내 문구 (아이폰은 기본 표시에 문구가 나오므로 없음)
  const notice = Platform.OS === 'android' && refreshing ? <Text style={styles.notice}>새로고침 중입니다</Text> : null

  return { refreshControl, notice }
}

// 새로고침 중 표시 최소 시간(ms)과 끝난 뒤 표시가 접히는 시간(ms)
const MIN_REFRESH_MS = 600
const COLLAPSE_MS = 500

const styles = StyleSheet.create({
  notice: {
    paddingVertical: 8,
    textAlign: 'center',
    fontFamily: font.medium,
    fontSize: 13,
    color: '#7a8998',
  },
})
