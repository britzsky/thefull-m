import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Badge from '@/components/Badge'
import BrandHeader from '@/components/BrandHeader'
import { font } from '@/lib/fonts'
import type { HygieneCategory } from '@/lib/hygiene/api'

// 위생 점검 카테고리 관리·수정 화면 (Figma V6 카테고리 관리 / 카테고리 수정)

// 기본 카테고리별 관리 포인트 기본 문구 (관리 포인트가 저장되지 않은 기본 카테고리에 사용)
export const categoryManagePoints: Record<string, string> = {
  preservedFood: '보존식 라벨 및 중량 확인',
  fridge: '냉장보관 및 표시사항 관리',
  freezer: '냉동보관·라벨·선입선출 관리',
  storage: '식품·비식품류 분리 및 적정 적재',
  crossContamination: '밀폐 및 교차오염 예방',
  labeling: '제품명·일자·소비기한 표시',
  documents: '서류 비치 및 유효기간 관리',
  personalHygiene: '조리종사자 개인위생 준수',
  equipment: '파손·노후·시설 상태 점검',
  cleaning: '청소 및 정리정돈 상태 관리',
  etc: '개별 확인 및 조치',
}

// 카테고리 설정이 저장되지 않은 거래처의 기본 카테고리 11개 (위생점검 조치사항 카테고리별 요약 기준)
// description: 주요 확인내용 (카테고리 설명으로 저장, 수정 화면에서 변경 가능)
export const initialCategories: HygieneCategory[] = [
  {
    key: 'preservedFood',
    title: '보존식',
    description: '보존식 라벨 / 중량 / 보관상태',
  },
  {
    key: 'fridge',
    title: '냉장고',
    description: '소분라벨 / 밀폐보관 / 계란보관 / 온도 / 청결',
  },
  {
    key: 'freezer',
    title: '냉동고',
    description: '성에 / 소분라벨 / 선입선출 / 온도 / 청결',
  },
  {
    key: 'storage',
    title: '창고·식재료 보관',
    description: '식자재·세제 혼재 / 바닥적재 / 구분보관',
  },
  {
    key: 'crossContamination',
    title: '식재료 보관·교차오염',
    description: '밀폐보관 / 전처리 식재 / 교차오염',
  },
  {
    key: 'labeling',
    title: '표시·소비기한',
    description: '소분·제조 라벨 / 소비기한 / 유통기한',
  },
  {
    key: 'documents',
    title: '서류·법정서류',
    description: '보건증 / 면허증 / 위생서류 / 교육자료 / 점검표',
  },
  {
    key: 'personalHygiene',
    title: '개인위생',
    description: '위생모 / 마스크 / 장신구 / 손톱 등',
  },
  {
    key: 'equipment',
    title: '조리기구·시설',
    description: '조리도구 / 온도계 / 방충망 / 살균기 / 후드 등',
  },
  {
    key: 'cleaning',
    title: '청소·정리정돈',
    description: '청소 / 세척 / 청결 / 먼지 / 곰팡이 등',
  },
  { key: 'etc', title: '기타', description: '위 항목에 해당하지 않는 사항' },
].map((category) => ({
  ...category,
  visible: true,
  showOnMain: true,
  managePoint: categoryManagePoints[category.key] ?? '',
  showStatus: true,
}))

// 토글 스위치 공통 색상
const switchColors = {
  trackColor: { false: '#d5dde3', true: '#1687b2' },
  thumbColor: '#ffffff',
  ios_backgroundColor: '#d5dde3',
}

// 수정 화면에서 편집 중인 카테고리와 신규 추가 여부
type EditingState = {
  category: HygieneCategory
  isNew: boolean
}

// 관리 목록 카테고리 줄 사이 간격 (manageBodyContent gap과 동일)
const ROW_GAP = 10

// 카테고리 줄 왼쪽 드래그 손잡이 (누른 채로 위아래로 끌어 순서 변경)
function DragHandle({
  onStart,
  onMove,
  onEnd,
}: {
  onStart: () => void
  onMove: (dy: number) => void
  onEnd: () => void
}) {
  // PanResponder는 한 번만 만들고, 콜백은 매 렌더의 최신 함수를 참조
  const handlersRef = useRef({ onStart, onMove, onEnd })
  handlersRef.current = { onStart, onMove, onEnd }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => handlersRef.current.onStart(),
      onPanResponderMove: (_, gesture) => handlersRef.current.onMove(gesture.dy),
      onPanResponderRelease: () => handlersRef.current.onEnd(),
      onPanResponderTerminate: () => handlersRef.current.onEnd(),
    })
  ).current

  return (
    <View {...panResponder.panHandlers} hitSlop={8} style={styles.dragHandle}>
      <MaterialCommunityIcons name="drag-horizontal-variant" size={22} color="#8a97a4" />
    </View>
  )
}

export default function HygieneCategoryEditor({
  categories,
  facilityName,
  isSaving,
  onCancel,
  onSave,
}: {
  categories: HygieneCategory[]
  facilityName: string
  isSaving: boolean
  onCancel: () => void
  onSave: (nextCategories: HygieneCategory[]) => void
}) {
  // 태블릿 폭 여부 (가운데 정렬 최대 폭 적용 기준)
  const { width } = useWindowDimensions()
  const isTablet = width >= 768

  // 저장 전까지 편집하는 카테고리 목록 사본
  const [draft, setDraft] = useState<HygieneCategory[]>(categories)
  // 수정 화면에서 편집 중인 카테고리 (null이면 관리 목록 화면)
  const [editing, setEditing] = useState<EditingState | null>(null)

  // 관리 목록 각 카테고리 줄의 위치·높이 (드래그 중 놓일 자리 계산용)
  const rowLayoutsRef = useRef<Record<string, { y: number; height: number }>>({})
  // 드래그 중인 줄의 손가락 이동 거리 (드래그 줄 따라 움직이기)
  const dragY = useRef(new Animated.Value(0)).current
  // 드래그 중인 카테고리의 원래 위치(from)와 놓일 위치(to) (null이면 드래그 중 아님)
  const [drag, setDragState] = useState<{ from: number; to: number } | null>(null)
  // 드래그 종료 시점에 최신 drag 값을 읽기 위한 사본
  const dragRef = useRef(drag)

  const setDrag = (next: { from: number; to: number } | null) => {
    dragRef.current = next
    setDragState(next)
  }

  // 놓은 줄이 제자리로 이동하는 중인지 여부 (이동 중 새 드래그 무시)
  const settlingRef = useRef(false)

  // 드래그 시작 (목록 스크롤 잠금)
  const handleDragStart = (index: number) => {
    if (settlingRef.current) {
      return
    }
    dragY.setValue(0)
    setDrag({ from: index, to: index })
  }

  // 드래그 이동 중 손가락 위치 기준으로 놓일 자리 계산
  const handleDragMove = (index: number, dy: number) => {
    dragY.setValue(dy)

    const fromLayout = rowLayoutsRef.current[draft[index].key]
    if (!fromLayout) {
      return
    }

    const center = fromLayout.y + fromLayout.height / 2 + dy
    let to = index

    draft.forEach((category, i) => {
      const layout = rowLayoutsRef.current[category.key]
      if (!layout) {
        return
      }

      const middle = layout.y + layout.height / 2
      if (i < index && center < middle) to = Math.min(to, i)
      if (i > index && center > middle) to = Math.max(to, i)
    })

    const current = dragRef.current
    if (current && current.to !== to) {
      setDrag({ ...current, to })
    }
  }

  // 드래그 종료 시 끌던 줄을 놓일 자리까지 부드럽게 이동시킨 뒤 카테고리 순서 변경
  const handleDragEnd = () => {
    const current = dragRef.current
    if (!current) {
      return
    }

    // 놓일 자리까지의 거리 (사이에 있는 줄들의 높이 + 간격 합)
    const [start, end] = current.from < current.to ? [current.from + 1, current.to] : [current.to, current.from - 1]
    let distance = 0
    for (let i = start; i <= end; i++) {
      distance += (rowLayoutsRef.current[draft[i].key]?.height ?? 0) + ROW_GAP
    }
    if (current.to < current.from) distance = -distance

    settlingRef.current = true
    Animated.timing(dragY, { toValue: distance, duration: 150, useNativeDriver: false }).start(() => {
      if (current.from !== current.to) {
        setDraft((list) => {
          const next = [...list]
          const [moved] = next.splice(current.from, 1)
          next.splice(current.to, 0, moved)
          return next
        })
      }
      // dragY는 다음 드래그 시작 때 초기화 (여기서 0으로 돌리면 순서 반영 전 한 프레임 원위치로 튐)
      setDrag(null)
      settlingRef.current = false
    })
  }

  // 드래그 중 다른 줄이 비켜나는 거리 (끌고 있는 줄 높이만큼 위/아래로 이동)
  const getRowShift = (index: number) => {
    if (!drag || index === drag.from) {
      return 0
    }

    const fromLayout = rowLayoutsRef.current[draft[drag.from].key]
    const shift = (fromLayout?.height ?? 0) + ROW_GAP

    if (drag.from < index && index <= drag.to) return -shift
    if (drag.to <= index && index < drag.from) return shift
    return 0
  }

  // 목록 토글 카테고리 사용/숨김 변경
  const toggleVisible = (key: string, visible: boolean) => {
    setDraft((current) => current.map((category) => (category.key === key ? { ...category, visible } : category)))
  }

  // 신규 카테고리 추가용 수정 화면 열기
  const openNewCategory = () => {
    setEditing({
      isNew: true,
      category: {
        key: `custom-${Date.now()}`,
        title: '',
        description: '',
        managePoint: '',
        visible: true,
        showOnMain: true,
        showStatus: true,
      },
    })
  }

  // 수정 화면 입력값 변경
  const updateEditing = (patch: Partial<HygieneCategory>) => {
    setEditing((current) => (current ? { ...current, category: { ...current.category, ...patch } } : current))
  }

  // 수정 화면 내용 관리 목록 반영 (카테고리명 필수·중복 확인)
  const handleApplyEdit = () => {
    if (!editing) {
      return
    }

    const title = editing.category.title.trim()

    if (!title) {
      Alert.alert('카테고리명 확인', '카테고리명을 입력해 주세요.')
      return
    }

    if (draft.some((category) => category.key !== editing.category.key && category.title === title)) {
      Alert.alert('카테고리명 확인', '같은 이름의 카테고리가 이미 있습니다.')
      return
    }

    const nextCategory = {
      ...editing.category,
      title,
      description: editing.category.description.trim(),
      managePoint: editing.category.managePoint.trim(),
    }

    setDraft((current) =>
      editing.isNew
        ? [...current, nextCategory]
        : current.map((category) => (category.key === nextCategory.key ? nextCategory : category))
    )
    setEditing(null)
  }

  // 삭제 확인 후 관리 목록에서 카테고리 제거
  const handleDelete = () => {
    if (!editing) {
      return
    }

    Alert.alert('카테고리 삭제', `${editing.category.title} 카테고리를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => {
          setDraft((current) => current.filter((category) => category.key !== editing.category.key))
          setEditing(null)
        },
      },
    ])
  }

  // 관리 목록 변경사항 저장 요청 (사용 중 카테고리 1개 이상 필수)
  const handleSaveAll = () => {
    if (!draft.some((category) => category.visible)) {
      Alert.alert('카테고리 확인', '사용하는 카테고리가 하나 이상 있어야 합니다.')
      return
    }

    onSave(draft)
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      {/* 화면 전체 틀 (태블릿은 가운데 최대 폭) */}
      <View style={[styles.frame, isTablet && styles.frameTablet]}>
        {/* 상단 로고, 화면 제목, 편집/수정/추가 배지 헤더 */}
        <BrandHeader
          title="카테고리"
          subtitle={facilityName}
          right={<Badge label={editing ? (editing.isNew ? '추가' : '수정') : '편집'} bg="#eaf7ef" fg="#2a7a49" />}
        />

        {editing ? (
          <>
            {/* 카테고리 이름·설명·표시 옵션 수정 스크롤 영역 */}
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.editBodyContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
            >
              {/* 수정 화면 제목·안내 문구 */}
              <View style={styles.intro}>
                <Text style={styles.introTitle}>
                  {editing.isNew ? '새 카테고리 추가' : `${editing.category.title || '카테고리'} 카테고리 수정`}
                </Text>
                <Text style={styles.introDescription}>카테고리는 조치 전·후 사진 등록이 기본으로 포함됩니다.</Text>
              </View>

              {/* 카테고리명 입력 */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>카테고리명</Text>
                <TextInput
                  value={editing.category.title}
                  onChangeText={(value) => updateEditing({ title: value })}
                  placeholder="카테고리명을 입력해 주세요."
                  placeholderTextColor="#9aa7b3"
                  style={styles.input}
                />
              </View>

              {/* 카테고리 설명 입력 */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>주요 확인내용</Text>
                <Text style={styles.fieldHint}>/ 로 구분하면 상세 화면에 항목별로 나뉘어 표시됩니다.</Text>
                <TextInput
                  value={editing.category.description}
                  onChangeText={(value) => updateEditing({ description: value })}
                  placeholder="예) 온도 / 소분라벨 / 청결"
                  placeholderTextColor="#9aa7b3"
                  multiline
                  textAlignVertical="top"
                  style={[styles.input, styles.textArea]}
                />
              </View>

              {/* 관리 포인트 입력 (상세 화면 점검 안내에 표시) */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>관리 포인트</Text>
                <TextInput
                  value={editing.category.managePoint}
                  onChangeText={(value) => updateEditing({ managePoint: value })}
                  placeholder="예) 냉장보관 및 표시사항 관리"
                  placeholderTextColor="#9aa7b3"
                  style={styles.input}
                />
              </View>

              {/* 모든 카테고리 공통 기본 입력 항목 안내 박스 */}
              <View style={styles.basicConfig}>
                {/* 안내 제목과 사진 기본 배지 */}
                <View style={styles.basicConfigTop}>
                  <Text style={styles.basicConfigTitle}>기본 입력 구성</Text>
                  <Badge label="사진 기본" bg="#ecf7fc" fg="#1687b2" />
                </View>
                <Text style={styles.basicConfigItems}>조치 전 사진 · 전달 메모 · 조치 후 사진 · 조치 내용 · 비고</Text>
                <Text style={styles.basicConfigNote}>사진 입력은 기본 구성으로 항상 포함됩니다.</Text>
              </View>

              {/* 전체 요약 화면 표시 옵션 박스 */}
              <View style={styles.options}>
                {/* 메인 화면 표시 토글 줄 */}
                <View style={styles.optionRow}>
                  <View style={styles.optionInfo}>
                    <Text style={styles.optionTitle}>메인 화면에 표시</Text>
                    <Text style={styles.optionDescription}>사용자가 바로 접근할 수 있도록 표시</Text>
                  </View>
                  <Switch
                    value={editing.category.showOnMain}
                    onValueChange={(value) => updateEditing({ showOnMain: value })}
                    {...switchColors}
                  />
                </View>
                {/* 점검 상태 표시 토글 줄 */}
                <View style={styles.optionRow}>
                  <View style={styles.optionInfo}>
                    <Text style={styles.optionTitle}>점검 상태 표시</Text>
                    <Text style={styles.optionDescription}>미점검·조치 필요 상태를 메인에 표시</Text>
                  </View>
                  <Switch
                    value={editing.category.showStatus}
                    onValueChange={(value) => updateEditing({ showStatus: value })}
                    {...switchColors}
                  />
                </View>
              </View>

              {/* 전체 요약 카드 미리보기 박스 */}
              <View style={styles.preview}>
                <Text style={styles.previewLabel}>미리보기</Text>
                {/* 미리보기 카테고리명과 배지 */}
                <View style={styles.previewTop}>
                  <Text style={styles.previewTitle}>{editing.category.title.trim() || '카테고리명'}</Text>
                  <Badge label="사진 기본" bg="#ecf7fc" fg="#1687b2" />
                </View>
                <Text style={styles.previewDescription}>
                  {editing.category.description.trim() || '조치 전·후 사진과 메모 입력란이 자동으로 제공됩니다.'}
                </Text>
              </View>

              {/* 기존 카테고리 삭제 안내·버튼 줄 (신규 추가 시 미표시) */}
              {editing.isNew ? null : (
                <View style={styles.dangerZone}>
                  <Text style={styles.dangerText}>이 카테고리를 더 이상 사용하지 않나요?</Text>
                  <Pressable style={styles.deleteButton} onPress={handleDelete}>
                    <Text style={styles.deleteButtonText}>삭제</Text>
                  </Pressable>
                </View>
              )}
            </ScrollView>

            {/* 수정 취소 및 반영 하단 버튼 바 */}
            <View style={styles.bottomBar}>
              <Pressable style={styles.secondaryButton} onPress={() => setEditing(null)}>
                <Text style={styles.secondaryButtonText}>취소</Text>
              </Pressable>
              <Pressable style={styles.primaryButton} onPress={handleApplyEdit}>
                <Text style={styles.primaryButtonText}>{editing.isNew ? '추가' : '수정 저장'}</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            {/* 카테고리 순서·숨김·수정 목록 스크롤 영역 */}
            <ScrollView style={styles.body} contentContainerStyle={styles.manageBodyContent} scrollEnabled={!drag}>
              {/* 관리 화면 제목·안내 문구 */}
              <View style={styles.intro}>
                <Text style={styles.introTitle}>관리 항목 편집</Text>
                <Text style={styles.introDescription}>
                  모든 카테고리는 사진 기록형이며 이름·순서·숨김 설정이 가능합니다.
                </Text>
              </View>

              {draft.map((category, index) => (
                // 카테고리 한 줄 (드래그 손잡이, 이름·설명, 수정 버튼, 사용 토글)
                <Animated.View
                  key={category.key}
                  onLayout={(event) => {
                    const { y, height } = event.nativeEvent.layout
                    rowLayoutsRef.current[category.key] = { y, height }
                  }}
                  style={[
                    styles.categoryRow,
                    !category.visible && styles.categoryRowHidden,
                    drag?.from === index
                      ? [styles.categoryRowDragging, { transform: [{ translateY: dragY }] }]
                      : { transform: [{ translateY: getRowShift(index) }] },
                  ]}
                >
                  {/* 순서 변경 드래그 손잡이 */}
                  <DragHandle
                    onStart={() => handleDragStart(index)}
                    onMove={(dy) => handleDragMove(index, dy)}
                    onEnd={handleDragEnd}
                  />
                  {/* 카테고리명과 설명 */}
                  <View style={styles.categoryInfo}>
                    <Text style={styles.categoryTitle}>{category.title}</Text>
                    <Text style={styles.categoryDescription} numberOfLines={1}>
                      {category.description || '조치 전·후 사진 기록'}
                    </Text>
                  </View>
                  {/* 수정 화면 이동 버튼 */}
                  <Pressable style={styles.editButton} onPress={() => setEditing({ category, isNew: false })}>
                    <Text style={styles.editButtonText}>수정</Text>
                  </Pressable>
                  {/* 사용/숨김 토글 */}
                  <Switch
                    value={category.visible}
                    onValueChange={(value) => toggleVisible(category.key, value)}
                    {...switchColors}
                  />
                </Animated.View>
              ))}

              {/* 카테고리 추가 버튼 */}
              <Pressable style={styles.addButton} onPress={openNewCategory}>
                <Text style={styles.addButtonText}>+ 카테고리 추가</Text>
              </Pressable>
            </ScrollView>

            {/* 편집 취소 및 변경사항 저장 하단 버튼 바 */}
            <View style={styles.bottomBar}>
              <Pressable disabled={isSaving} style={styles.secondaryButton} onPress={onCancel}>
                <Text style={styles.secondaryButtonText}>취소</Text>
              </Pressable>
              <Pressable
                disabled={isSaving}
                style={[styles.primaryButton, isSaving && styles.buttonDisabled]}
                onPress={handleSaveAll}
              >
                {isSaving ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>변경사항 저장</Text>
                )}
              </Pressable>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  )
}

// 카테고리 관리·수정 화면 스타일
const styles = StyleSheet.create({
  buttonDisabled: {
    opacity: 0.7,
  },
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  frame: {
    flex: 1,
    backgroundColor: '#f8fafb',
  },
  frameTablet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
  },
  body: {
    flex: 1,
  },
  manageBodyContent: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 10,
  },
  editBodyContent: {
    padding: 18,
    gap: 12,
  },
  intro: {
    gap: 4,
    marginBottom: 4,
  },
  introTitle: {
    color: '#273542',
    fontSize: 16,
    fontFamily: font.bold,
  },
  introDescription: {
    color: '#667584',
    fontSize: 14,
    fontFamily: font.regular,
  },
  categoryRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e6ecf0',
    backgroundColor: '#ffffff',
  },
  categoryRowHidden: {
    backgroundColor: '#f3f6f8',
  },
  categoryRowDragging: {
    zIndex: 10,
    elevation: 6,
    borderColor: '#9cc9db',
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  dragHandle: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryInfo: {
    flex: 1,
    gap: 2,
  },
  categoryTitle: {
    color: '#273542',
    fontSize: 14,
    fontFamily: font.bold,
  },
  categoryDescription: {
    color: '#667584',
    fontSize: 12,
    fontFamily: font.regular,
  },
  editButton: {
    width: 52,
    height: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e6ecf0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  editButtonText: {
    color: '#273542',
    fontSize: 16,
    fontFamily: font.medium,
  },
  addButton: {
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e6ecf0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  addButtonText: {
    color: '#273542',
    fontSize: 16,
    fontFamily: font.medium,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: '#273542',
    fontSize: 14,
    fontFamily: font.medium,
  },
  fieldHint: {
    color: '#667584',
    fontSize: 12,
    fontFamily: font.regular,
  },
  input: {
    height: 46,
    paddingHorizontal: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e6ecf0',
    backgroundColor: '#ffffff',
    color: '#273542',
    fontSize: 14,
    fontFamily: font.regular,
  },
  textArea: {
    height: 86,
    paddingVertical: 11,
  },
  basicConfig: {
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e6ecf0',
    backgroundColor: '#ecf7fc',
  },
  basicConfigTop: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  basicConfigTitle: {
    color: '#273542',
    fontSize: 14,
    fontFamily: font.bold,
  },
  basicConfigItems: {
    color: '#273542',
    fontSize: 12,
    fontFamily: font.regular,
  },
  basicConfigNote: {
    color: '#667584',
    fontSize: 12,
    fontFamily: font.regular,
  },
  options: {
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e6ecf0',
    backgroundColor: '#ffffff',
  },
  optionRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionInfo: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    color: '#273542',
    fontSize: 14,
    fontFamily: font.medium,
  },
  optionDescription: {
    color: '#667584',
    fontSize: 12,
    fontFamily: font.regular,
  },
  preview: {
    gap: 8,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#ecf7fc',
  },
  previewLabel: {
    color: '#1687b2',
    fontSize: 12,
    fontFamily: font.medium,
  },
  previewTop: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previewTitle: {
    color: '#273542',
    fontSize: 16,
    fontFamily: font.bold,
  },
  previewDescription: {
    color: '#667584',
    fontSize: 12,
    fontFamily: font.regular,
  },
  dangerZone: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dangerText: {
    color: '#667584',
    fontSize: 12,
    fontFamily: font.regular,
  },
  deleteButton: {
    width: 60,
    height: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#b04141',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fdeded',
  },
  deleteButtonText: {
    color: '#b04141',
    fontSize: 16,
    fontFamily: font.medium,
  },
  bottomBar: {
    height: 72,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e6ecf0',
    backgroundColor: '#ffffff',
  },
  secondaryButton: {
    width: 104,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e6ecf0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  secondaryButtonText: {
    color: '#273542',
    fontSize: 16,
    fontFamily: font.medium,
  },
  primaryButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1687b2',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontFamily: font.bold,
  },
})
