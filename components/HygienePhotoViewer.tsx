import { useEffect, useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import ZoomableImage from '@/components/ZoomableImage'
import { font } from '@/lib/fonts'

// 위생 점검 항목 사진 크게 보기 화면 (안드로이드·아이폰 공통 Modal)
// 조치 전 ↔ 조치 후 사진은 위쪽 탭으로만 전환 (사진 영역 좌우 넘기기 없음), 수정 가능한 사진은 다시 촬영·삭제
// 사진은 두 손가락 확대·축소, 확대 상태 한 손가락 이동, 두 번 탭 확대 가능

// 사진 구분 (조치 전 / 조치 후)
export type ViewerSide = 'before' | 'after'

// 탭 순서 (조치 전, 조치 후)
const SIDES: ViewerSide[] = ['before', 'after']

export default function HygienePhotoViewer({
  visible,
  number,
  beforeUri,
  afterUri,
  initialSide,
  canEdit,
  onRetake,
  onDelete,
  onClose,
}: {
  visible: boolean
  // 항목 번호 (항목 n)
  number: number
  // 조치 전·후 사진 표시 주소 (없으면 빈 값)
  beforeUri: string
  afterUri: string
  // 처음 보여줄 사진 구분
  initialSide: ViewerSide
  // 사진 구분별 수정 가능 여부 (현장 계정의 조치 전 사진은 보기만)
  canEdit: (side: ViewerSide) => boolean
  onRetake: (side: ViewerSide) => void
  onDelete: (side: ViewerSide) => void
  onClose: () => void
}) {
  // 상태바·홈 인디케이터 여백
  const insets = useSafeAreaInsets()
  // 현재 보고 있는 사진 구분
  const [side, setSide] = useState<ViewerSide>(initialSide)

  // 보기 화면이 열릴 때 처음 보여줄 사진 구분으로 맞춤
  useEffect(() => {
    if (visible) {
      setSide(initialSide)
    }
  }, [visible, initialSide])

  // 현재 사진의 수정 가능 여부와 사진 존재 여부 (하단 버튼 표시 기준)
  const editable = canEdit(side)
  const currentUri = side === 'before' ? beforeUri : afterUri
  const hasPhoto = Boolean(currentUri)

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      {/* 검은 배경 전체 화면 틀 */}
      <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        {/* 상단 항목 번호, 조치 전·후 탭, 닫기 버튼 줄 */}
        <View style={styles.topBar}>
          <Text style={styles.title}>항목 {number}</Text>
          {/* 조치 전 / 조치 후 탭 */}
          <View style={styles.tabs}>
            {SIDES.map((item) => (
              <Pressable
                key={item}
                style={[styles.tab, side === item && styles.tabActive]}
                onPress={() => setSide(item)}
              >
                <Text style={[styles.tabText, side === item && styles.tabTextActive]}>
                  {item === 'before' ? '조치 전' : '조치 후'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable hitSlop={10} onPress={onClose}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        {/* 현재 탭 사진 영역 (확대·축소만, 보기 화면을 열거나 탭을 바꾸면 원래 크기로 시작) */}
        <View style={styles.page}>
          {currentUri ? (
            <ZoomableImage key={`${visible}-${side}-${currentUri}`} uri={currentUri} />
          ) : (
            <Text style={styles.emptyText}>{side === 'before' ? '조치 전' : '조치 후'} 사진이 없습니다.</Text>
          )}
        </View>

        {/* 하단 버튼 줄 (수정 가능한 사진만 다시 촬영·삭제, 항상 닫기) */}
        <View style={styles.bottomBar}>
          {editable ? (
            <>
              <Pressable style={styles.actionButton} onPress={() => onRetake(side)}>
                <Text style={styles.actionText}>{hasPhoto ? '다시 촬영' : '촬영'}</Text>
              </Pressable>
              {hasPhoto ? (
                <Pressable style={[styles.actionButton, styles.deleteButton]} onPress={() => onDelete(side)}>
                  <Text style={[styles.actionText, styles.deleteText]}>삭제</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          <Pressable style={[styles.actionButton, styles.closeButton]} onPress={onClose}>
            <Text style={[styles.actionText, styles.closeButtonText]}>닫기</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

// 사진 크게 보기 화면 스타일
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
  },
  title: {
    color: '#ffffff',
    fontSize: 15,
    fontFamily: font.bold,
  },
  tabs: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  tabActive: {
    backgroundColor: '#1593c4',
  },
  tabText: {
    color: '#c9d3db',
    fontSize: 14,
    fontFamily: font.medium,
  },
  tabTextActive: {
    color: '#ffffff',
    fontFamily: font.bold,
  },
  closeText: {
    color: '#ffffff',
    fontSize: 20,
    fontFamily: font.medium,
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#9aa7b3',
    fontSize: 16,
    fontFamily: font.medium,
  },
  bottomBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  actionButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1593c4',
  },
  actionText: {
    color: '#ffffff',
    fontSize: 16,
    fontFamily: font.bold,
  },
  deleteButton: {
    backgroundColor: '#c24c4c',
  },
  deleteText: {
    color: '#ffffff',
  },
  closeButton: {
    borderWidth: 1,
    borderColor: '#ffffff',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  closeButtonText: {
    color: '#ffffff',
  },
})
