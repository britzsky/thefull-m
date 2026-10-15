import { useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  GestureResponderEvent,
  Image,
  NativeTouchEvent,
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native'

// 손가락으로 확대·축소·이동하는 이미지 (JS 터치 처리만 사용, 안드로이드·아이폰 공통)
// 두 손가락: 확대·축소 / 확대 상태 한 손가락: 이동 / 두 번 탭: 2.5배 ↔ 원래 크기

// 확대 배율 범위와 두 번 탭 배율
const MIN_SCALE = 1
const MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.5
// 두 번 탭 인정 간격 (ms)
const DOUBLE_TAP_DELAY = 280

// 값을 최소·최대 범위로 제한
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

// 두 손가락 사이 거리
const touchDistance = (touches: NativeTouchEvent[]) =>
  Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY)

export default function ZoomableImage({ uri }: { uri: string }) {
  // 화면 표시용 배율·이동 값
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })
  // 불러오기를 마친 사진 주소 (현재 주소와 다르면 로딩 중 표시)
  const [loadedUri, setLoadedUri] = useState('')
  // 터치 계산용 현재 값과 제스처 시작 기준값
  const gesture = useRef({
    scale: 1,
    x: 0,
    y: 0,
    startDistance: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    lastTapAt: 0,
    width: 0,
    height: 0,
  }).current

  // 배율·이동 값 반영 (확대 배율에 맞춰 사진이 화면 밖으로 빠지지 않게 이동 범위 제한)
  const applyTransform = (nextScale: number, nextX: number, nextY: number) => {
    const maxX = (gesture.width * (nextScale - 1)) / 2
    const maxY = (gesture.height * (nextScale - 1)) / 2

    gesture.scale = nextScale
    gesture.x = clamp(nextX, -maxX, maxX)
    gesture.y = clamp(nextY, -maxY, maxY)
    setTransform({ scale: gesture.scale, x: gesture.x, y: gesture.y })
  }

  // 확대·축소·이동 터치 처리기 (사진 영역 터치는 모두 이 처리기가 담당)
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        // 제스처 시작 기준값 저장
        onPanResponderGrant: () => {
          gesture.startDistance = 0
          gesture.startScale = gesture.scale
          gesture.startX = gesture.x
          gesture.startY = gesture.y
        },
        onPanResponderMove: (event, state) => {
          const touches = event.nativeEvent.touches

          // 두 손가락: 처음 거리 대비 비율로 확대·축소
          if (touches.length >= 2) {
            const distance = touchDistance(touches)

            if (!gesture.startDistance) {
              gesture.startDistance = distance
              gesture.startScale = gesture.scale
              return
            }

            applyTransform(
              clamp((gesture.startScale * distance) / gesture.startDistance, MIN_SCALE, MAX_SCALE),
              gesture.x,
              gesture.y
            )
            return
          }

          // 확대 상태 한 손가락: 이동 (두 손가락에서 한 손가락으로 바뀐 경우 기준점 재설정)
          if (gesture.scale > 1.01) {
            if (gesture.startDistance) {
              gesture.startDistance = 0
              gesture.startX = gesture.x - state.dx
              gesture.startY = gesture.y - state.dy
            }

            applyTransform(gesture.scale, gesture.startX + state.dx, gesture.startY + state.dy)
          }
        },
        // 손을 뗐을 때 거의 원래 크기면 원래 크기로 맞춤
        onPanResponderRelease: () => {
          if (gesture.scale <= 1.05) {
            applyTransform(1, 0, 0)
          }
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // 두 번 탭 처리 (확대 중이면 원래 크기, 아니면 2.5배)
  const handleTouchEnd = (event: GestureResponderEvent) => {
    if (event.nativeEvent.touches.length > 0) {
      return
    }

    const now = Date.now()

    if (now - gesture.lastTapAt < DOUBLE_TAP_DELAY) {
      gesture.lastTapAt = 0
      applyTransform(gesture.scale > 1.01 ? 1 : DOUBLE_TAP_SCALE, 0, 0)
      return
    }

    gesture.lastTapAt = now
  }

  // 이동 범위 계산용 사진 영역 크기 저장
  const handleLayout = (event: LayoutChangeEvent) => {
    gesture.width = event.nativeEvent.layout.width
    gesture.height = event.nativeEvent.layout.height
  }

  return (
    // 터치 영역 (사진 영역 전체)
    <View style={styles.container} onLayout={handleLayout} onTouchEnd={handleTouchEnd} {...panResponder.panHandlers}>
      <Image
        source={{ uri }}
        resizeMode="contain"
        onLoadEnd={() => setLoadedUri(uri)}
        style={[
          styles.image,
          { transform: [{ translateX: transform.x }, { translateY: transform.y }, { scale: transform.scale }] },
        ]}
      />
      {/* 사진 불러오는 중 로딩 표시 */}
      {loadedUri !== uri ? (
        <View pointerEvents="none" style={styles.loading}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      ) : null}
    </View>
  )
}

// 확대 이미지 스타일
const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
