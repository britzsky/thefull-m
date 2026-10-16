import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Dimensions,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import * as ImagePicker from 'expo-image-picker'

import Badge from '@/components/Badge'
import BrandHeader from '@/components/BrandHeader'
import HygienePhotoViewer from '@/components/HygienePhotoViewer'
import HygieneCategoryEditor, { categoryManagePoints, initialCategories } from '@/components/HygieneCategoryEditor'
import { AttendanceAccount, fetchAttendanceAccounts } from '@/lib/attendance/api'
import { getAppSession, logoutAppSession } from '@/lib/auth/storage'
import { font } from '@/lib/fonts'
import {
  HygieneCategory,
  HygieneCheckRow,
  fetchHygieneCategories,
  fetchHygieneChecks,
  saveHygieneCategories,
  saveHygieneRows,
  toDateKey,
  toHygieneImageUrl,
  uploadHygienePhoto,
} from '@/lib/hygiene/api'

// 위생 점검 화면 (Figma V6 전체 요약형)
// app/hygiene.tsx 라우트로 열림 (메인 화면 위생 점검 메뉴)
// 로그인 세션의 account_id 기준으로 오늘 날짜 점검 기록을 조회·저장
// 상세 화면 한 항목 = 조치 전 사진·전달 메모(왼쪽) + 조치 후 사진·조치 메모(오른쪽) = 위생관리 한 행

// 카테고리 점검 상태
type HygieneStatus = '완료' | '조치 필요' | '미점검'
// 전체 요약 화면 상태 필터
type HygieneFilter = '전체' | '조치 필요' | '완료' | '미점검'
// 사진 구분 (조치 전 / 조치 후)
type PhotoSide = 'before' | 'after'

// 점검 사진 (uri는 화면 표시용, path는 업로드 후 서버 경로이며 촬영 직후에는 빈 값)
type HygienePhoto = {
  uri: string
  path: string
}

// 조치 전·후 한 쌍 (위생관리 한 행 = 웹 위생관리 한 줄)
type HygienePair = {
  // 화면 목록 key
  id: string
  // 저장된 위생관리 행 번호 (신규는 null)
  idx: number | null
  // 조치 전 사진 (problem_image)
  beforePhoto: HygienePhoto | null
  // 전달 메모 (problem_note)
  memo: string
  // 조치 후 사진 (clean_image)
  afterPhoto: HygienePhoto | null
  // 조치 메모 (clean_note)
  actionNote: string
  // 등록(조치 전) 일자·사용자명, 조치(조치 후) 일자·사용자명 (조회값 표시용)
  regDt: string
  regUserName: string
  modDt: string
  modUserName: string
  // 저장 후 조치 전 쪽(사진·전달 메모) 변경 여부 → 저장 시 reg_dt·reg_user_id 갱신
  beforeChanged: boolean
  // 저장 후 조치 후 쪽(사진·조치 메모) 변경 여부 → 저장 시 mod_dt·mod_user_id 갱신
  afterChanged: boolean
  // 구분 없음 행 여부 (카테고리 없이 웹에서 등록한 예전 행: 조치 내용만 있어도 완료, 비고는 행별 유지)
  noCategory: boolean
  // 행 비고 (구분 없음 행은 저장 시 이 값을 그대로 보냄)
  note: string
}

// 카테고리 한 건의 점검 기록
type HygieneCategoryRecord = {
  // 조치 전·후 항목 목록 (등록 순서)
  pairs: HygienePair[]
  // 비고 (첫 번째 항목 행의 note에 저장)
  remark: string
  // 화면에서 삭제한 저장 행 번호 (저장 시 del_yn = 'Y')
  deletedIdxs: number[]
  // 저장 후 변경 여부 (저장 대상 판단)
  dirty: boolean
}

// 상태 필터 탭 목록
const filterTabs: HygieneFilter[] = ['전체', '조치 필요', '완료', '미점검']

// 점검 상태별 배지 배경색과 글자색
const statusTone: Record<HygieneStatus, { bg: string; fg: string }> = {
  완료: { bg: '#eaf7ef', fg: '#2a7a49' },
  '조치 필요': { bg: '#fff3e6', fg: '#a55d1d' },
  미점검: { bg: '#f0f3f5', fg: '#667584' },
}

// 아직 기록이 없는 카테고리의 빈 점검 기록
// 저장 후 목록 재조회 실패 안내 문구
const RELOAD_FAILED_TITLE = '저장 완료'
const RELOAD_FAILED_MESSAGE =
  '저장은 완료됐지만 목록을 불러오지 못했습니다.\n위생 점검 화면을 나갔다가 다시 들어와 주세요.'

const EMPTY_RECORD: HygieneCategoryRecord = {
  pairs: [],
  remark: '',
  deletedIdxs: [],
  dirty: false,
}

// 입력 중인 칸과 키보드 윗변 사이 여유 (안드로이드는 키보드 높이에 빠지기도 하는 자동완성 줄까지 고려)
const KEYBOARD_GAP = Platform.OS === 'android' ? 64 : 16

// 구분 없음(카테고리 없는 예전 웹 등록 행) 화면용 카테고리 key, 저장 시 빈 category_key로 변환
const NO_CATEGORY_KEY = '__none'

// 구분 없음 화면용 카테고리 (기록이 있을 때만 카드·칩으로 표시, 카테고리 설정에는 저장하지 않음)
const NO_CATEGORY: HygieneCategory = {
  key: NO_CATEGORY_KEY,
  title: '구분 없음',
  description: '',
  managePoint: '',
  visible: true,
  showOnMain: true,
  showStatus: true,
}

// 서버 사진 경로를 화면용 사진으로 변환 (경로가 없으면 null)
function toPhoto(path: string): HygienePhoto | null {
  return path ? { uri: toHygieneImageUrl(path), path } : null
}

// 조회한 점검 기록 행(한 행 = 한 항목)을 카테고리별 점검 기록으로 묶기
function toRecordMap(rows: HygieneCheckRow[]) {
  const recordMap: Record<string, HygieneCategoryRecord> = {}

  for (const row of rows) {
    const recordKey = row.category_key || NO_CATEGORY_KEY
    const record = recordMap[recordKey] ?? { ...EMPTY_RECORD, pairs: [] }

    // 비고는 첫 번째 항목 행의 note 사용
    if (record.pairs.length === 0) {
      record.remark = row.note
    }

    record.pairs.push({
      id: `row-${row.idx}`,
      idx: row.idx,
      beforePhoto: toPhoto(row.problem_image),
      memo: row.problem_note,
      afterPhoto: toPhoto(row.clean_image),
      actionNote: row.clean_note,
      regDt: row.reg_dt ?? '',
      regUserName: row.reg_user_name ?? '',
      modDt: row.mod_dt ?? '',
      modUserName: row.mod_user_name ?? '',
      beforeChanged: false,
      afterChanged: false,
      noCategory: !row.category_key,
      note: row.note ?? '',
    })
    recordMap[recordKey] = record
  }

  return recordMap
}

// 선택한 연·월에 등록된 점검 기록 행만 남기기 (등록일 reg_dt 기준)
function filterRowsByMonth(rows: HygieneCheckRow[], year: number, month: number) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`

  return rows.filter((row) => (row.reg_dt ?? '').startsWith(prefix))
}

// 저장 일자(yyyy-mm-dd)·사용자명을 'MM/DD 이름' 표시 문구로 변환 (일자가 없으면 빈 값)
function formatStamp(date: string, userName: string) {
  if (!date) {
    return ''
  }

  const [, month, day] = date.split('-')

  return `${month}/${day}${userName ? ` ${userName}` : ''}`
}

// 항목 조치 완료 여부 (조치 후 사진과 조치 메모가 모두 있는 경우)
// 구분 없음 행은 조치 내용만 있어도 완료 (웹 위생점검과 같은 기준)
function isPairDone(pair: HygienePair) {
  if (pair.noCategory) return Boolean(pair.actionNote.trim())
  return Boolean(pair.afterPhoto && pair.actionNote.trim())
}

// 조치가 끝나지 않은 항목 수
function getRemainingCount(record: HygieneCategoryRecord) {
  return record.pairs.filter((pair) => !isPairDone(pair)).length
}

// 점검 상태 판정 (항목 없음: 미점검, 모든 항목 조치 완료: 완료, 그 외: 조치 필요)
function getCategoryStatus(record: HygieneCategoryRecord): HygieneStatus {
  if (record.pairs.length === 0) {
    return '미점검'
  }

  return getRemainingCount(record) === 0 ? '완료' : '조치 필요'
}

// 조치 전·후 사진이 있는 항목 수 (요약 카드 전/후 배지용)
// 구분 없음 행은 사진 또는 내용(전: 전달 메모, 후: 조치 메모)이 있으면 셈 (웹 위생점검과 같은 기준)
function getPhotoCounts(record: HygieneCategoryRecord) {
  return {
    before: record.pairs.filter((pair) => pair.beforePhoto || (pair.noCategory && pair.memo.trim())).length,
    after: record.pairs.filter((pair) => pair.afterPhoto || (pair.noCategory && pair.actionNote.trim())).length,
  }
}

// 요약 카드 한 줄 안내 문구 선택
function getCategoryHint(record: HygieneCategoryRecord, status: HygieneStatus) {
  if (status === '완료') {
    return '모든 항목 조치 완료'
  }

  if (status === '조치 필요') {
    return `조치 ${getRemainingCount(record)}건 남음`
  }

  return '아직 점검하지 않음'
}

// 목록을 한 줄에 size개씩 나누기 (요약 카드 격자 배치용)
function chunk<T>(items: T[], size: number) {
  const rows: T[][] = []

  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size))
  }

  return rows
}

// 항목 한쪽 칸 (조치 전 / 조치 후 사진 + 메모)
function PairSide({
  side,
  number,
  photo,
  note,
  stamp,
  locked = false,
  onPressPhoto,
  onChangeNote,
  onNoteResize,
}: {
  side: PhotoSide
  number: number
  photo: HygienePhoto | null
  note: string
  // 저장된 일자·사용자 표시 문구 (예: 10/13 홍길동, 없으면 빈 값)
  stamp: string
  // 읽기 전용 여부 (현장 계정의 조치 전 칸: 촬영·메모 수정 불가)
  locked?: boolean
  onPressPhoto: () => void
  onChangeNote: (value: string) => void
  // 메모를 여러 줄 입력해 입력칸 높이가 바뀔 때 (키보드에 가려지지 않게 화면 스크롤)
  onNoteResize?: () => void
}) {
  // 조치 전 / 조치 후 구분 문구
  const isBefore = side === 'before'
  // 불러오기를 마친 사진 주소 (현재 사진 주소와 다르면 로딩 중 표시)
  const [loadedUri, setLoadedUri] = useState('')

  return (
    // 한쪽 칸 (조치 전은 주황 톤, 조치 후는 초록 톤 배경)
    <View style={[styles.pairSide, isBefore ? styles.pairSideBefore : styles.pairSideAfter]}>
      {/* 칸 제목 (전 n / 후 n)과 저장 일자·사용자 */}
      <View style={styles.pairSideHead}>
        <Text style={styles.pairSideTitle}>
          {isBefore ? '전' : '후'} {number}
        </Text>
        {stamp ? (
          <Text style={styles.pairSideStamp} numberOfLines={1}>
            {stamp}
          </Text>
        ) : null}
      </View>

      {/* 사진 칸 (사진이 있으면 탭해서 크게 보기, 비어 있으면 탭해서 촬영, 잠금 칸은 크게 보기만) */}
      <Pressable disabled={locked && !photo} style={styles.pairPhotoBox} onPress={onPressPhoto}>
        {photo ? (
          <>
            <Image
              source={{ uri: photo.uri }}
              onLoadEnd={() => setLoadedUri(photo.uri)}
              style={styles.pairPhotoImage}
            />
            {/* 사진 불러오는 중 로딩 표시 */}
            {loadedUri !== photo.uri ? (
              <View pointerEvents="none" style={styles.pairPhotoLoading}>
                <ActivityIndicator color="#1593c4" />
              </View>
            ) : null}
          </>
        ) : locked ? (
          <Text style={styles.pairPhotoText}>사진 없음</Text>
        ) : (
          <>
            <MaterialCommunityIcons name="camera-outline" size={22} color="#8a97a3" />
            <Text style={styles.pairPhotoText}>{isBefore ? '조치 전 사진 추가' : '조치 후 사진 추가'}</Text>
          </>
        )}
      </Pressable>

      {/* 전달 메모 / 조치 메모 (잠금 칸은 입력칸 대신 일반 글로 전체 표시) */}
      <Text style={styles.pairNoteLabel}>{isBefore ? '전달 메모' : '조치 메모'}</Text>
      {locked ? (
        <Text selectable style={[styles.pairNoteText, !note.trim() && styles.pairNoteTextEmpty]}>
          {note.trim() || '내용 없음'}
        </Text>
      ) : (
        <TextInput
          value={note}
          onChangeText={onChangeNote}
          placeholder={isBefore ? '확인할 내용을 입력해 주세요.' : '조치 내용을 입력해 주세요.'}
          placeholderTextColor="#9aa7b3"
          multiline
          textAlignVertical="top"
          onContentSizeChange={onNoteResize}
          onFocus={onNoteResize}
          style={styles.pairNoteInput}
        />
      )}
    </View>
  )
}

// 조치 전·후 항목 카드 (번호·삭제 버튼 + 왼쪽 조치 전 → 오른쪽 조치 후)
function PairCard({
  number,
  pair,
  afterOnly,
  onPressPhoto,
  onChangePair,
  onDelete,
  onNoteResize,
}: {
  number: number
  pair: HygienePair
  // 조치 후만 입력 가능 여부 (현장 계정: 조치 전 칸 잠금, 항목 삭제 불가)
  afterOnly: boolean
  onPressPhoto: (side: PhotoSide) => void
  onChangePair: (patch: Partial<HygienePair>) => void
  onDelete: () => void
  // 메모 입력칸 높이 변경 알림 (키보드 가림 방지 스크롤)
  onNoteResize?: () => void
}) {
  return (
    // 항목 카드 (조치가 끝나지 않은 항목은 주황 테두리)
    <View style={[styles.pairCard, !isPairDone(pair) && styles.cardNeedAction]}>
      {/* 항목 번호와 삭제 버튼 줄 */}
      <View style={styles.pairCardHeader}>
        <View style={styles.pairNumber}>
          <Text style={styles.pairNumberText}>{number}</Text>
        </View>
        <Text style={styles.pairCardTitle}>항목 {number}</Text>
        <View style={styles.gridSpacer} />
        {afterOnly ? null : (
          <Pressable hitSlop={8} onPress={onDelete}>
            <Text style={styles.pairDeleteText}>삭제</Text>
          </Pressable>
        )}
      </View>

      {/* 조치 전(왼쪽) → 조치 후(오른쪽) 두 칸 */}
      <View style={styles.pairColumns}>
        <PairSide
          side="before"
          number={number}
          photo={pair.beforePhoto}
          note={pair.memo}
          stamp={formatStamp(pair.regDt, '')}
          locked={afterOnly}
          onPressPhoto={() => onPressPhoto('before')}
          onChangeNote={(value) => onChangePair({ memo: value })}
          onNoteResize={onNoteResize}
        />
        <MaterialCommunityIcons name="arrow-right" size={18} color="#1593c4" style={styles.pairArrow} />
        <PairSide
          side="after"
          number={number}
          photo={pair.afterPhoto}
          note={pair.actionNote}
          stamp={pair.afterPhoto || pair.actionNote ? formatStamp(pair.modDt, pair.modUserName) : ''}
          onPressPhoto={() => onPressPhoto('after')}
          onChangeNote={(value) => onChangePair({ actionNote: value })}
          onNoteResize={onNoteResize}
        />
      </View>
    </View>
  )
}

// 라벨이 붙은 여러 줄 입력칸
function NoteField({
  label,
  value,
  placeholder,
  minHeight,
  onChangeText,
  onResize,
}: {
  label: string
  value: string
  placeholder: string
  minHeight: number
  onChangeText: (value: string) => void
  // 여러 줄 입력으로 입력칸 높이가 바뀔 때 (키보드 가림 방지 스크롤)
  onResize?: () => void
}) {
  return (
    // 입력칸 묶음 (라벨 + 여러 줄 입력)
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#9aa7b3"
        multiline
        textAlignVertical="top"
        onContentSizeChange={onResize}
        onFocus={onResize}
        style={[styles.fieldInput, { minHeight }]}
      />
    </View>
  )
}

export default function HygieneScreen() {
  // 태블릿 폭 여부 (가운데 정렬 최대 폭 적용 기준)
  const { width } = useWindowDimensions()
  const isTablet = width >= 768

  // 오늘 날짜 (yyyy-mm-dd, 저장 시 reg_dt·mod_dt 값과 사진 업로드 폴더)
  const [checkDate] = useState(() => toDateKey())
  // 점검 기록 조회 연·월 (기본 이번 달)
  const [viewYear, setViewYear] = useState(() => Number(checkDate.slice(0, 4)))
  const [viewMonth, setViewMonth] = useState(() => Number(checkDate.slice(5, 7)))
  // 연·월 선택 창 종류 (닫힘: null)
  const [periodPicker, setPeriodPicker] = useState<'year' | 'month' | null>(null)
  // 로그인 사용자 아이디 (저장 시 reg_user_id·mod_user_id)
  const [loginUserId, setLoginUserId] = useState('')
  // 점검 대상 거래처 key (현장 계정은 로그인 거래처, 본사 계정은 선택한 거래처)
  const [accountId, setAccountId] = useState('')
  // 거래처 목록 (거래처명 표시·본사 거래처 선택용)
  const [accounts, setAccounts] = useState<AttendanceAccount[]>([])
  // 본사 계정 여부 (user_type 1: CEO, 2: 본사 → 거래처 선택 후 점검)
  const [isHeadOffice, setIsHeadOffice] = useState(false)
  // 현장 계정 여부 (user_type 3 → 조치 후 사진·조치 메모만 입력, 조치 전·항목 추가·삭제 불가)
  const [isFieldUser, setIsFieldUser] = useState(false)
  // 본사 계정 거래처 선택 화면 열림 여부
  const [isPickingAccount, setIsPickingAccount] = useState(false)
  // 거래처 선택 화면 검색어
  const [accountQuery, setAccountQuery] = useState('')
  // 화면 데이터 조회 중 여부
  const [isLoading, setIsLoading] = useState(true)
  // 점검·카테고리 저장 중 여부 (저장 버튼 중복 클릭 방지)
  const [isSaving, setIsSaving] = useState(false)
  // 점검 기록 저장 진행 중 여부 (렌더 전 연속 터치로 신규 행이 두 번 INSERT되는 것 방지)
  const savingRecordsRef = useRef(false)
  // 저장은 됐지만 목록 재조회에 실패한 카테고리 key (다음 저장 전에 먼저 다시 불러옴)
  const reloadPendingKeysRef = useRef<string[]>([])
  // 카테고리 설정 (이름·순서·숨김·표시 옵션)
  const [categories, setCategories] = useState<HygieneCategory[]>(initialCategories)
  // 카테고리별 점검 기록 (조치 전·후 항목 목록·비고, 기록이 없는 카테고리는 EMPTY_RECORD로 취급)
  const [records, setRecords] = useState<Record<string, HygieneCategoryRecord>>({})
  // 마지막으로 조회·저장한 카테고리별 점검 기록 (저장 안 하고 이동 시 되돌리기 기준)
  const savedRecordsRef = useRef<Record<string, HygieneCategoryRecord>>({})
  // 카테고리 관리 화면 열림 여부
  const [isEditingCategories, setIsEditingCategories] = useState(false)
  // 전체 요약 화면 상태 필터
  const [activeFilter, setActiveFilter] = useState<HygieneFilter>('전체')
  // 상세 화면 카테고리 key (null이면 전체 요약 화면)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  // 사진 크게 보기 대상 (카테고리·항목·처음 보여줄 사진 구분, null이면 닫힘)
  const [viewer, setViewer] = useState<{ categoryKey: string; pairId: string; side: PhotoSide } | null>(null)
  // 상세 화면 사진·메모 스크롤 영역과 현재 스크롤 위치 (입력칸 가림 방지 스크롤 계산용)
  const detailScrollRef = useRef<ScrollView>(null)
  const detailScrollYRef = useRef(0)
  // 키보드 윗변의 화면 y 좌표 (키보드가 없으면 null), 안드로이드 하단 여백용 키보드 높이
  const keyboardTopRef = useRef<number | null>(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  // 입력 중인 칸이 키보드에 가려지면 가려진 만큼 상세 화면을 위로 스크롤
  // 호출 시점(포커스·줄 추가·키보드 표시) 직후 레이아웃이 반영되도록 다음 프레임에 측정
  const keepFocusedInputVisible = useCallback(() => {
    requestAnimationFrame(() => {
      const keyboardTop = keyboardTopRef.current
      const input = TextInput.State.currentlyFocusedInput()
      if (keyboardTop === null || !input || !detailScrollRef.current) return

      input.measureInWindow((_x, y, _width, height) => {
        const overflow = y + height + KEYBOARD_GAP - keyboardTop
        if (overflow > 0) {
          detailScrollRef.current?.scrollTo({ y: detailScrollYRef.current + overflow, animated: true })
        }
      })
    })
  }, [])

  // 키보드가 올라오면 위치 기록 후 입력 중인 칸이 보이게 스크롤, 내려가면 초기화
  // (안드로이드 edge-to-edge는 키보드가 화면을 줄이지 않고 덮으므로 직접 처리)
  useEffect(() => {
    const showListener = Keyboard.addListener('keyboardDidShow', (event) => {
      // 안드로이드는 키보드 위치 값과 화면 좌표 기준이 기기마다 어긋나므로(상태바·내비게이션 바)
      // 두 방식으로 구한 키보드 윗변 중 더 위쪽 값을 사용
      keyboardTopRef.current =
        Platform.OS === 'android'
          ? Math.min(event.endCoordinates.screenY, Dimensions.get('window').height - event.endCoordinates.height)
          : event.endCoordinates.screenY
      setKeyboardHeight(event.endCoordinates.height)
      // 안드로이드 하단 여백이 화면에 반영된 뒤 스크롤해야 맨 아래 비고까지 올라감
      setTimeout(keepFocusedInputVisible, 150)
    })
    const hideListener = Keyboard.addListener('keyboardDidHide', () => {
      keyboardTopRef.current = null
      setKeyboardHeight(0)
    })

    return () => {
      showListener.remove()
      hideListener.remove()
    }
  }, [keepFocusedInputVisible])

  // 상세 화면 카테고리 칩 가로 스크롤 (선택 칩을 화면 안으로 이동)
  const chipBarRef = useRef<ScrollView>(null)
  // 칩 가로 스크롤 영역 폭과 칩별 위치·폭 (선택 칩 가운데 정렬 계산용)
  const chipBarWidthRef = useRef(0)
  const chipLayoutsRef = useRef<Record<string, { x: number; width: number }>>({})

  // 선택한 카테고리 칩이 보이도록 칩 가로 스크롤을 가운데로 이동
  const scrollChipIntoView = useCallback((key: string, animated: boolean) => {
    const layout = chipLayoutsRef.current[key]
    if (!layout || !chipBarWidthRef.current) {
      return
    }

    chipBarRef.current?.scrollTo({
      x: Math.max(0, layout.x - (chipBarWidthRef.current - layout.width) / 2),
      animated,
    })
  }, [])

  // 상세 화면에서 카테고리를 바꾸면 선택 칩으로 스크롤
  useEffect(() => {
    if (selectedKey) {
      scrollChipIntoView(selectedKey, true)
    }
  }, [selectedKey, scrollChipIntoView])

  // 화면 진입 시 로그인 세션 확인 (본사 계정은 거래처 선택, 현장 계정·조리사/조리원은 로그인 거래처로 진행)
  useEffect(() => {
    let active = true

    const loadSession = async () => {
      const appSession = await getAppSession()

      // 로그인 세션 없음 → 로그인 화면 이동
      if (!appSession) {
        Alert.alert('로그인 필요', '위생 점검은 로그인 후 이용할 수 있습니다.')
        router.replace('/login')
        return
      }

      // 조리사/조리원: 기기 승인된 근무지로 진행, 현장 계정과 같은 권한(조치 후만 입력), 등록자는 이름으로 저장
      if (appSession.mode === 'cook') {
        const accountList = await fetchAttendanceAccounts().catch(() => [])

        if (!active) {
          return
        }

        setLoginUserId(appSession.cook.userName)
        setAccounts(accountList)
        setIsHeadOffice(false)
        setIsFieldUser(true)
        setAccountId(appSession.cook.accountId)
        return
      }

      const session = appSession.staff

      setLoginUserId(session.userId)

      const headOffice = session.userType === '1' || session.userType === '2'
      const sessionAccountId = session.accountId === 'null' ? '' : session.accountId

      // 거래처가 연결되지 않은 현장 계정 → 메인 화면 복귀
      if (!headOffice && !sessionAccountId) {
        Alert.alert('이용 불가', '거래처가 연결된 계정만 위생 점검을 이용할 수 있습니다.')
        router.replace('/home')
        return
      }

      const accountList = await fetchAttendanceAccounts().catch(() => [])

      if (!active) {
        return
      }

      setAccounts(accountList)
      setIsHeadOffice(headOffice)
      setIsFieldUser(session.userType === '3')

      if (headOffice) {
        // 본사 계정 → 거래처 선택 화면부터 시작
        setIsPickingAccount(true)
        setIsLoading(false)
      } else {
        // 영양사 계정 → 소속 거래처로 바로 진입
        setAccountId(sessionAccountId)
      }
    }

    void loadSession()

    return () => {
      active = false
    }
  }, [])

  // 점검 대상 거래처 결정·변경 시 카테고리 설정·오늘 점검 기록 조회
  useEffect(() => {
    if (!accountId) {
      return
    }

    let active = true

    const loadHygiene = async () => {
      setIsLoading(true)

      try {
        const [savedCategories, checkRows] = await Promise.all([
          fetchHygieneCategories(accountId),
          fetchHygieneChecks(accountId),
        ])

        if (!active) {
          return
        }

        // 저장된 카테고리 설정이 없는 거래처는 기본 카테고리로 시작
        // 관리 포인트가 저장되지 않은 기본 카테고리는 기본 관리 포인트 문구 사용
        setCategories(
          savedCategories.length > 0
            ? savedCategories.map((category) => ({
                ...category,
                managePoint: category.managePoint || categoryManagePoints[category.key] || '',
              }))
            : initialCategories
        )
        // 현장 계정(영양사·조리사/조리원)은 연·월 구분 없이 누적 전체, 본사 계정은 선택한 연·월
        savedRecordsRef.current = toRecordMap(isFieldUser ? checkRows : filterRowsByMonth(checkRows, viewYear, viewMonth))
        reloadPendingKeysRef.current = []
        setRecords(savedRecordsRef.current)
        setSelectedKey(null)
        setActiveFilter('전체')
      } catch (error) {
        Alert.alert('조회 실패', error instanceof Error ? error.message : '위생 점검 정보를 불러오지 못했습니다.')
      } finally {
        if (active) {
          setIsLoading(false)
        }
      }
    }

    void loadHygiene()

    return () => {
      active = false
    }
  }, [accountId, viewYear, viewMonth, isFieldUser])

  // 숨김 처리되지 않은 사용 중 카테고리
  // 구분 없음 기록이 있으면 맨 뒤에 구분 없음 카테고리 추가
  const hasNoCategoryRecords = (records[NO_CATEGORY_KEY]?.pairs.length ?? 0) > 0
  const activeCategories = useMemo(
    () => [...categories.filter((category) => category.visible), ...(hasNoCategoryRecords ? [NO_CATEGORY] : [])],
    [categories, hasNoCategoryRecords]
  )

  // 헤더 표시용 점검 대상 거래처명
  const accountName = accounts.find((account) => account.account_id === accountId)?.account_name ?? ''

  // 거래처 선택 화면 검색 결과 (거래처명 포함 검색)
  const filteredAccounts = useMemo(() => {
    const query = accountQuery.trim()

    return query ? accounts.filter((account) => account.account_name.includes(query)) : accounts
  }, [accounts, accountQuery])

  // 거래처 선택 화면에서 거래처 선택 (선택 시 해당 거래처 점검 조회)
  const handleSelectAccount = (nextAccountId: string) => {
    setIsPickingAccount(false)
    setAccountQuery('')

    if (nextAccountId !== accountId) {
      savedRecordsRef.current = {}
      setRecords({})
      setAccountId(nextAccountId)
    }
  }

  // 거래처 선택 화면 닫기 (점검 중 거래처 변경을 취소하고 요약 화면 복귀)
  const handleCancelPickAccount = () => {
    setIsPickingAccount(false)
    setAccountQuery('')
  }

  // 카테고리 key 기준 점검 기록 조회 (없으면 빈 기록)
  const getRecord = (categoryKey: string) => records[categoryKey] ?? EMPTY_RECORD

  // 사용 중 카테고리별 점검 상태
  const statusMap = useMemo(
    () =>
      Object.fromEntries(
        activeCategories.map((category) => [category.key, getCategoryStatus(records[category.key] ?? EMPTY_RECORD)])
      ) as Record<string, HygieneStatus>,
    [activeCategories, records]
  )

  // 전체 점검 현황 (항목 단위 완료·조치 필요 건수와 진행률, 진행률 = 전체 항목 중 조치 완료 비율)
  // overallStatus는 상단 헤더 상태 표시용으로 카테고리 상태 기준 판정
  const summary = useMemo(() => {
    const pairs = activeCategories.flatMap((category) => (records[category.key] ?? EMPTY_RECORD).pairs)
    const doneCount = pairs.filter((pair) => isPairDone(pair)).length
    const pendingCount = pairs.length - doneCount

    const statuses = Object.values(statusMap)
    const overallStatus: HygieneStatus =
      statuses.length > 0 && statuses.every((status) => status === '완료')
        ? '완료'
        : statuses.every((status) => status === '미점검')
          ? '미점검'
          : '조치 필요'

    return {
      doneCount,
      pendingCount,
      overallStatus,
      percent: pairs.length > 0 ? Math.round((doneCount / pairs.length) * 100) : 0,
    }
  }, [activeCategories, records, statusMap])

  // 전체 요약 카드 표시 대상 카테고리 (메인 표시 옵션 + 상태 필터)
  const visibleCategories = activeCategories.filter(
    (category) => category.showOnMain && (activeFilter === '전체' || statusMap[category.key] === activeFilter)
  )

  // 상세 화면 카테고리와 점검 기록
  const selectedCategory = activeCategories.find((category) => category.key === selectedKey) ?? null
  const selectedRecord = selectedKey ? getRecord(selectedKey) : null

  // 후면 카메라 현장 사진 촬영 (사진보관함 선택 없이 촬영만 허용)
  const capturePhoto = async (): Promise<HygienePhoto | null> => {
    const permission = await ImagePicker.requestCameraPermissionsAsync()

    if (!permission.granted) {
      Alert.alert('권한 필요', '현장 촬영을 위해 카메라 접근 권한이 필요합니다.')
      return null
    }

    const cameraResult = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      cameraType: ImagePicker.CameraType.back,
      quality: 0.7,
    })

    if (cameraResult.canceled || !cameraResult.assets[0]) {
      return null
    }

    return {
      uri: cameraResult.assets[0].uri,
      path: '',
    }
  }

  // 카테고리 점검 기록 변경 (변경 표시 포함)
  const updateRecord = (categoryKey: string, updater: (record: HygieneCategoryRecord) => HygieneCategoryRecord) => {
    setRecords((current) => ({
      ...current,
      [categoryKey]: { ...updater(current[categoryKey] ?? EMPTY_RECORD), dirty: true },
    }))
  }

  // 항목 일부 값 변경 (메모·사진), 바뀐 쪽(조치 전 / 조치 후) 변경 표시
  const updatePair = (categoryKey: string, pairId: string, patch: Partial<HygienePair>) => {
    const beforeTouched = 'beforePhoto' in patch || 'memo' in patch
    const afterTouched = 'afterPhoto' in patch || 'actionNote' in patch

    updateRecord(categoryKey, (record) => ({
      ...record,
      pairs: record.pairs.map((pair) =>
        pair.id === pairId
          ? {
              ...pair,
              ...patch,
              beforeChanged: pair.beforeChanged || beforeTouched,
              afterChanged: pair.afterChanged || afterTouched,
            }
          : pair
      ),
    }))
  }

  // 항목 추가 (조치 전 사진 촬영 후 새 항목 생성, 촬영 취소 시 추가하지 않음)
  const handleAddPair = async (categoryKey: string) => {
    const beforePhoto = await capturePhoto()

    if (!beforePhoto) {
      return
    }

    updateRecord(categoryKey, (record) => ({
      ...record,
      pairs: [
        ...record.pairs,
        {
          id: `new-${Date.now()}`,
          idx: null,
          beforePhoto,
          memo: '',
          afterPhoto: null,
          actionNote: '',
          regDt: '',
          regUserName: '',
          modDt: '',
          modUserName: '',
          beforeChanged: true,
          afterChanged: false,
          noCategory: false,
          note: '',
        },
      ],
    }))
  }

  // 사진 구분별 수정 가능 여부 (현장 계정은 조치 전 사진 수정 불가)
  const canEditSide = (side: PhotoSide) => !(isFieldUser && side === 'before')

  // 촬영 후 항목의 해당 칸 사진 교체
  const retakePhoto = async (categoryKey: string, pairId: string, side: PhotoSide) => {
    const photo = await capturePhoto()

    if (photo) {
      updatePair(categoryKey, pairId, side === 'before' ? { beforePhoto: photo } : { afterPhoto: photo })
    }
  }

  // 사진 칸 탭 처리 (사진이 있으면 크게 보기, 비어 있으면 바로 촬영)
  const handlePressPhoto = (categoryKey: string, pair: HygienePair, side: PhotoSide) => {
    const photo = side === 'before' ? pair.beforePhoto : pair.afterPhoto

    if (photo) {
      setViewer({ categoryKey, pairId: pair.id, side })
      return
    }

    if (canEditSide(side)) {
      void retakePhoto(categoryKey, pair.id, side)
    }
  }

  // 크게 보기 화면의 다시 촬영 (보기 화면을 닫은 뒤 카메라 실행, 닫힘 애니메이션과 겹치지 않도록 잠시 대기)
  const handleViewerRetake = (side: PhotoSide) => {
    if (!viewer) {
      return
    }

    const { categoryKey, pairId } = viewer
    setViewer(null)
    setTimeout(() => void retakePhoto(categoryKey, pairId, side), 400)
  }

  // 크게 보기 화면의 사진 삭제 (확인 후 해당 칸 사진 제거, 보기 화면은 유지)
  const handleViewerDelete = (side: PhotoSide) => {
    if (!viewer) {
      return
    }

    const { categoryKey, pairId } = viewer

    Alert.alert('사진 삭제', `${side === 'before' ? '조치 전' : '조치 후'} 사진을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () =>
          updatePair(categoryKey, pairId, side === 'before' ? { beforePhoto: null } : { afterPhoto: null }),
      },
    ])
  }

  // 항목 삭제 확인 후 목록에서 제거 (저장된 행은 저장 시 삭제 처리)
  const handleDeletePair = (categoryKey: string, pair: HygienePair, number: number) => {
    Alert.alert('항목 삭제', `항목 ${number}을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () =>
          updateRecord(categoryKey, (record) => ({
            ...record,
            pairs: record.pairs.filter((item) => item.id !== pair.id),
            deletedIdxs: pair.idx === null ? record.deletedIdxs : [...record.deletedIdxs, pair.idx],
          })),
      },
    ])
  }

  // 사진의 서버 경로 확보 (아직 업로드하지 않은 촬영 사진은 업로드)
  const resolvePhotoPath = async (photo: HygienePhoto | null) => {
    if (!photo) {
      return ''
    }

    return photo.path || uploadHygienePhoto(photo.uri, checkDate, accountId)
  }

  // 점검 기록 저장 요청 처리 (이미 저장 중이면 무시)
  const saveRecords = async (categoryKeys: string[]) => {
    if (savingRecordsRef.current) {
      return false
    }

    savingRecordsRef.current = true

    try {
      // 이미 저장된 카테고리는 다시 불러온 뒤 이번 저장 대상에서 제외 (이 함수의 records는 재조회 전 값)
      const reloadedKeys = reloadPendingKeysRef.current

      if (!(await ensureSavedRecordsReloaded())) {
        return false
      }

      const remainingKeys = categoryKeys.filter((key) => !reloadedKeys.includes(key))

      if (remainingKeys.length < categoryKeys.length && !remainingKeys.some((key) => records[key]?.dirty)) {
        return true
      }

      return await saveChangedRecords(remainingKeys)
    } finally {
      savingRecordsRef.current = false
    }
  }

  // 변경된 카테고리 점검 기록 저장 후 서버 기준 재조회 (항목 한 개 = 위생관리 한 행)
  const saveChangedRecords = async (categoryKeys: string[]) => {
    const targets = categoryKeys.filter((key) => records[key]?.dirty)

    if (targets.length === 0) {
      Alert.alert('안내', '저장할 점검 내용이 없습니다.')
      return false
    }

    // 항목 없이 비고만 입력한 카테고리 확인 (비고는 첫 항목 행에 저장)
    const remarkOnly = targets.find((key) => records[key].pairs.length === 0 && records[key].remark.trim())

    if (remarkOnly) {
      Alert.alert('안내', '비고는 항목을 하나 이상 추가한 뒤 저장할 수 있습니다.')
      return false
    }

    setIsSaving(true)

    try {
      const rows: (HygieneCheckRow & { deleted?: boolean })[] = []

      for (const key of targets) {
        const record = records[key]

        // 항목별 행 (사진 업로드 후 경로 저장, 비고는 첫 행)
        // 조치 전 쪽이 바뀐 행(신규 포함)은 reg_dt·reg_user_id, 조치 후 쪽이 바뀐 행은 mod_dt·mod_user_id 갱신
        for (const [index, pair] of record.pairs.entries()) {
          const beforeChanged = pair.beforeChanged || pair.idx === null

          rows.push({
            idx: pair.idx,
            category_key: key === NO_CATEGORY_KEY ? '' : key,
            problem_image: await resolvePhotoPath(pair.beforePhoto),
            problem_note: pair.memo,
            clean_image: await resolvePhotoPath(pair.afterPhoto),
            clean_note: pair.actionNote,
            // 구분 없음 행은 행별 비고 유지, 그 외는 카테고리 비고를 첫 행에 저장
            note: pair.noCategory ? pair.note : index === 0 ? record.remark : '',
            ...(beforeChanged ? { reg_dt: checkDate, reg_user_id: loginUserId } : {}),
            ...(pair.afterChanged ? { mod_dt: checkDate, mod_user_id: loginUserId } : {}),
          })
        }

        // 삭제한 저장 행
        for (const idx of record.deletedIdxs) {
          rows.push({
            idx,
            category_key: key === NO_CATEGORY_KEY ? '' : key,
            problem_image: '',
            problem_note: '',
            clean_image: '',
            clean_note: '',
            note: '',
            deleted: true,
          })
        }
      }

      if (rows.length > 0) {
        await saveHygieneRows(accountId, rows)
      }
    } catch (error) {
      Alert.alert('저장 실패', error instanceof Error ? error.message : '점검 내용 저장에 실패했습니다.')
      setIsSaving(false)
      return false
    }

    // 저장은 완료된 상태, 재조회 실패 시 재시도 대상으로 남김 (다시 저장하면 신규 행이 중복 INSERT되므로)
    reloadPendingKeysRef.current = targets

    try {
      await reloadSavedRecords()
      return true
    } catch {
      Alert.alert(RELOAD_FAILED_TITLE, RELOAD_FAILED_MESSAGE)
      return false
    } finally {
      setIsSaving(false)
    }
  }

  // 저장한 카테고리를 서버 기준으로 다시 불러와 교체 (통신 실패 시 1초 간격 최대 3회 시도)
  // 다른 카테고리의 저장 전 수정 내용은 유지
  const reloadSavedRecords = async () => {
    const keys = reloadPendingKeysRef.current
    let checkRows: HygieneCheckRow[] | null = null

    for (let attempt = 0; attempt < 3 && !checkRows; attempt += 1) {
      try {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
        checkRows = await fetchHygieneChecks(accountId)
      } catch (error) {
        if (attempt === 2) {
          throw error
        }
      }
    }

    const freshRecords = toRecordMap(
      isFieldUser ? (checkRows ?? []) : filterRowsByMonth(checkRows ?? [], viewYear, viewMonth)
    )

    for (const key of keys) {
      savedRecordsRef.current[key] = freshRecords[key] ?? EMPTY_RECORD
    }

    setRecords((current) => {
      const next = { ...current }

      for (const key of keys) {
        next[key] = freshRecords[key] ?? EMPTY_RECORD
      }

      return next
    })
    reloadPendingKeysRef.current = []
  }

  // 이전 저장 후 재조회에 실패한 카테고리가 남아 있으면 먼저 다시 불러옴 (실패 시 저장 중단)
  const ensureSavedRecordsReloaded = async () => {
    if (reloadPendingKeysRef.current.length === 0) {
      return true
    }

    try {
      setIsSaving(true)
      await reloadSavedRecords()
      return true
    } catch {
      Alert.alert(RELOAD_FAILED_TITLE, RELOAD_FAILED_MESSAGE)
      return false
    } finally {
      setIsSaving(false)
    }
  }

  // 전체 저장 버튼 처리 (사용 중 카테고리 점검 기록 일괄 저장)
  const handleSaveAll = async () => {
    if (await saveRecords(activeCategories.map((category) => category.key))) {
      Alert.alert('저장 완료', '위생 점검 내용이 저장되었습니다.')
    }
  }

  // 상세 화면 저장 버튼 처리 (선택 카테고리 저장 후 상세 화면 유지)
  const handleSaveCategory = async () => {
    if (!selectedCategory) {
      return
    }

    if (await saveRecords([selectedCategory.key])) {
      Alert.alert('저장 완료', `${selectedCategory.title} 점검 내용이 저장되었습니다.`)
    }
  }

  // 상세 화면 전체로 버튼 처리 (수정사항이 있으면 저장 후 이동 / 저장 안 하고 이동 / 취소 선택)
  const handleBackToSummary = () => {
    if (!selectedCategory) {
      return
    }

    const categoryKey = selectedCategory.key

    if (!records[categoryKey]?.dirty) {
      setSelectedKey(null)
      return
    }

    Alert.alert('수정사항이 있습니다', `${selectedCategory.title}에 저장하지 않은 수정사항이 있습니다.`, [
      {
        text: '저장 후 이동',
        onPress: () => {
          void saveRecords([categoryKey]).then((saved) => {
            if (saved) {
              setSelectedKey(null)
            }
          })
        },
      },
      {
        text: '저장 안 하고 이동',
        style: 'destructive',
        onPress: () => {
          // 마지막 저장 상태로 되돌린 뒤 이동
          setRecords((current) => ({
            ...current,
            [categoryKey]: savedRecordsRef.current[categoryKey] ?? EMPTY_RECORD,
          }))
          setSelectedKey(null)
        },
      },
      { text: '취소', style: 'cancel' },
    ])
  }

  // 카테고리 관리 화면 변경사항 서버 저장 후 반영
  const handleSaveCategories = async (nextCategories: HygieneCategory[]) => {
    setIsSaving(true)

    try {
      await saveHygieneCategories(accountId, nextCategories)
      setCategories(nextCategories)
      setIsEditingCategories(false)
    } catch (error) {
      Alert.alert('저장 실패', error instanceof Error ? error.message : '카테고리 저장에 실패했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  // 저장하지 않은 점검 내용이 있으면 나가기 전 확인 후 진행
  const confirmLeave = (onLeave: () => void) => {
    if (!Object.values(records).some((record) => record.dirty)) {
      onLeave()
      return
    }

    Alert.alert('저장하지 않은 내용', '저장하지 않은 점검 내용이 있습니다. 저장하지 않고 나갈까요?', [
      { text: '취소', style: 'cancel' },
      { text: '나가기', style: 'destructive', onPress: onLeave },
    ])
  }

  // 메인으로 버튼 처리 (로그인 유지, 메인에서 위생 점검을 다시 누르면 바로 위생 화면 진입)
  const handleGoMain = () => {
    confirmLeave(() => {
      if (router.canGoBack()) {
        router.back()
      } else {
        router.replace('/home')
      }
    })
  }

  // 로그아웃 버튼 처리 (로그인 세션·저장된 비밀번호 삭제 후 로그인 화면 이동, 아이디만 남김)
  const handleLogout = () => {
    confirmLeave(() => {
      Alert.alert('로그아웃', '로그아웃할까요?', [
        { text: '취소', style: 'cancel' },
        {
          text: '로그아웃',
          style: 'destructive',
          onPress: () => {
            void logoutAppSession().then(() => {
              router.replace('/login')
            })
          },
        },
      ])
    })
  }

  // 본사 계정 거래처 선택 화면
  if (isPickingAccount) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        {/* 화면 전체 틀 (태블릿은 가운데 최대 폭) */}
        <View style={[styles.frame, isTablet && styles.frameTablet]}>
          {/* 상단 로고와 화면 제목 헤더 */}
          <BrandHeader title="위생 점검" subtitle="거래처 선택" />

          {/* 거래처명 검색 입력 영역 */}
          <View style={styles.accountSearchBar}>
            <TextInput
              value={accountQuery}
              onChangeText={setAccountQuery}
              placeholder="거래처명을 검색하세요"
              placeholderTextColor="#9aa7b3"
              style={styles.accountSearchInput}
            />
          </View>

          {/* 거래처 목록 (탭 시 해당 거래처 위생 점검으로 이동) */}
          <FlatList
            data={filteredAccounts}
            keyExtractor={(account) => account.account_id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.accountListContent}
            ListEmptyComponent={
              // 검색 결과 없음 안내
              <Text style={styles.emptyCardText}>검색된 거래처가 없습니다.</Text>
            }
            renderItem={({ item }) => (
              // 거래처 한 줄 버튼 (현재 선택 거래처는 강조)
              <Pressable
                style={[styles.accountRow, item.account_id === accountId && styles.accountRowActive]}
                onPress={() => handleSelectAccount(item.account_id)}
              >
                <Text style={styles.accountRowText}>{item.account_name}</Text>
                <Text style={styles.overviewCardLinkArrow}>›</Text>
              </Pressable>
            )}
          />

          {/* 하단 버튼 바 (점검 중 거래처 변경이면 취소, 처음 진입이면 로그아웃·메인으로) */}
          <View style={styles.bottomBar}>
            {accountId ? (
              <Pressable style={[styles.secondaryButton, styles.primaryButtonFlex]} onPress={handleCancelPickAccount}>
                <Text style={styles.secondaryButtonText}>취소</Text>
              </Pressable>
            ) : (
              <>
                <Pressable style={[styles.secondaryButton, styles.primaryButtonFlex]} onPress={handleLogout}>
                  <Text style={styles.secondaryButtonText}>로그아웃</Text>
                </Pressable>
                <Pressable style={[styles.secondaryButton, styles.primaryButtonFlex]} onPress={handleGoMain}>
                  <Text style={styles.secondaryButtonText}>메인으로</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // 첫 조회 중 로딩 화면
  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        {/* 화면 가운데 로딩 표시 */}
        <View style={styles.loadingBox}>
          <ActivityIndicator color="#1593c4" />
          <Text style={styles.loadingText}>위생 점검 정보를 불러오는 중</Text>
        </View>
      </SafeAreaView>
    )
  }

  // 카테고리 관리·수정 화면
  if (isEditingCategories) {
    return (
      <HygieneCategoryEditor
        categories={categories}
        facilityName={accountName}
        isSaving={isSaving}
        onCancel={() => setIsEditingCategories(false)}
        onSave={(nextCategories) => void handleSaveCategories(nextCategories)}
      />
    )
  }

  // 상세 화면 항목 표시 순서 (현장 계정: 조치 안 된 항목 먼저, 그다음 등록 순서)
  // 조치 여부는 마지막 저장 상태로 판단해 입력 중에 카드 순서가 바뀌지 않게 함
  const orderPairs = (categoryKey: string, pairs: HygienePair[]) => {
    if (!isFieldUser) return pairs
    const savedPairs = savedRecordsRef.current[categoryKey]?.pairs ?? []
    const isSavedDone = (pair: HygienePair) => isPairDone(savedPairs.find((saved) => saved.id === pair.id) ?? pair)
    return [...pairs].sort((a, b) => Number(isSavedDone(a)) - Number(isSavedDone(b)))
  }
  const detailPairs = selectedKey && selectedRecord ? orderPairs(selectedKey, selectedRecord.pairs) : []

  // 크게 보기 대상 항목과 항목 번호 (사진 교체·삭제 시 최신 값 반영, 번호는 화면 표시 순서 기준)
  const viewerPairs = viewer ? orderPairs(viewer.categoryKey, records[viewer.categoryKey]?.pairs ?? []) : []
  const viewerIndex = viewer ? viewerPairs.findIndex((pair) => pair.id === viewer.pairId) : -1
  const viewerPair = viewerIndex >= 0 ? viewerPairs[viewerIndex] : null

  // 헤더 상태 배지 값 (상세 화면은 선택 카테고리 상태, 요약 화면은 전체 상태)
  const headerStatus = selectedCategory ? statusMap[selectedCategory.key] : summary.overallStatus

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      {/* 화면 전체 틀 (태블릿은 가운데 최대 폭) */}
      <View style={[styles.frame, isTablet && styles.frameTablet]}>
        {/* 상단 로고, 화면 제목, 전체/카테고리 상태 배지 헤더 */}
        <BrandHeader
          title="위생 점검"
          subtitle={selectedCategory ? `${selectedCategory.title} 상세` : accountName}
          right={<Badge label={headerStatus} {...statusTone[headerStatus]} />}
        />

        {selectedCategory && selectedRecord ? (
          <>
            {/* 상세 화면 카테고리 전환 칩 가로 스크롤 영역 */}
            <ScrollView
              ref={chipBarRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              onLayout={(event) => {
                chipBarWidthRef.current = event.nativeEvent.layout.width
                // 칩 위치가 먼저 잡힌 경우 영역 폭이 정해진 뒤 선택 칩으로 스크롤
                if (selectedKey) scrollChipIntoView(selectedKey, false)
              }}
              style={styles.categoryChipsBar}
              contentContainerStyle={styles.categoryChips}
            >
              {activeCategories.map((category) => {
                const isActive = category.key === selectedKey

                return (
                  // 카테고리 칩 버튼
                  <Pressable
                    key={category.key}
                    onLayout={(event) => {
                      const { x, width } = event.nativeEvent.layout
                      chipLayoutsRef.current[category.key] = { x, width }
                      // 상세 화면 첫 진입 시 선택 칩 위치가 잡히면 바로 그 칩으로 스크롤
                      if (isActive) scrollChipIntoView(category.key, false)
                    }}
                    style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                    onPress={() => setSelectedKey(category.key)}
                  >
                    <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>
                      {category.title}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>

            {/* 선택 카테고리 사진·메모 입력 스크롤 영역 */}
            <ScrollView
              key={selectedKey}
              ref={detailScrollRef}
              style={styles.body}
              contentContainerStyle={[
                styles.detailBodyContent,
                // 안드로이드는 키보드가 내용을 덮으므로 키보드 높이만큼 아래 여백 (iOS는 자동 인셋 사용)
                Platform.OS === 'android' && keyboardHeight > 0 ? { paddingBottom: keyboardHeight + KEYBOARD_GAP + 24 } : null,
              ]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              scrollEventThrottle={16}
              onScroll={(event) => {
                detailScrollYRef.current = event.nativeEvent.contentOffset.y
              }}
            >
              {/* 선택 카테고리 이름·사진 장수·점검일 요약 박스 */}
              <View style={styles.detailSummary}>
                <View style={styles.detailSummaryText}>
                  <Text style={styles.detailSummaryTitle}>{selectedCategory.title}</Text>
                  <Text style={styles.detailSummaryMeta}>
                    조치 전 {getPhotoCounts(selectedRecord).before}건 · 조치 후 {getPhotoCounts(selectedRecord).after}건
                    {getRemainingCount(selectedRecord) > 0 ? ` (${getRemainingCount(selectedRecord)}건 남음)` : ''}
                  </Text>
                </View>
                <Text style={styles.detailSummaryHint}>누적 {selectedRecord.pairs.length}건</Text>
              </View>

              {/* 카테고리 점검 안내 박스 (주요 확인내용 칩 + 관리 포인트) */}
              {selectedCategory.description || selectedCategory.managePoint ? (
                <View style={styles.guideBox}>
                  {/* 주요 확인내용 (설명을 / 기준으로 나눈 칩 목록, /가 없는 예전 설명은 · 기준) */}
                  {selectedCategory.description ? (
                    <View style={styles.guideSection}>
                      <Text style={styles.guideLabel}>주요 확인내용</Text>
                      <View style={styles.guideChips}>
                        {selectedCategory.description
                          .split(selectedCategory.description.includes('/') ? '/' : '·')
                          .map((item) => item.trim())
                          .filter(Boolean)
                          .map((item) => (
                            // 확인내용 항목 칩
                            <View key={item} style={styles.guideChip}>
                              <Text style={styles.guideChipText}>{item}</Text>
                            </View>
                          ))}
                      </View>
                    </View>
                  ) : null}
                  {/* 관리 포인트 문구 (카테고리 수정 화면에서 입력) */}
                  {selectedCategory.managePoint ? (
                    <View style={styles.guideSection}>
                      <Text style={styles.guideLabel}>관리 포인트</Text>
                      <Text style={styles.guidePoint}>{selectedCategory.managePoint}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* 조치 전·후 항목 카드 목록 (한 항목 = 위생관리 한 줄), 항목이 없으면 안내 박스 */}
              {selectedRecord.pairs.length === 0 ? (
                <View style={styles.pairEmpty}>
                  <Text style={styles.pairEmptyText}>등록된 항목이 없습니다.</Text>
                  <Text style={styles.pairEmptyText}>
                    {isFieldUser
                      ? '본사에서 점검 항목을 등록하면 조치 후 사진을 추가할 수 있습니다.'
                      : '아래 항목 추가를 누르면 조치 전 사진 촬영이 시작됩니다.'}
                  </Text>
                </View>
              ) : (
                detailPairs.map((pair, index) => (
                  <PairCard
                    key={pair.id}
                    number={index + 1}
                    pair={pair}
                    afterOnly={isFieldUser}
                    onPressPhoto={(side) => handlePressPhoto(selectedCategory.key, pair, side)}
                    onChangePair={(patch) => updatePair(selectedCategory.key, pair.id, patch)}
                    onDelete={() => handleDeletePair(selectedCategory.key, pair, index + 1)}
                    onNoteResize={keepFocusedInputVisible}
                  />
                ))
              )}

              {/* 항목 추가 버튼 (누르면 바로 조치 전 사진 촬영, 현장 계정·구분 없음은 미표시) */}
              {isFieldUser || selectedCategory.key === NO_CATEGORY_KEY ? null : (
                <Pressable style={styles.addPairButton} onPress={() => void handleAddPair(selectedCategory.key)}>
                  <MaterialCommunityIcons name="camera-plus-outline" size={18} color="#1687b2" />
                  <Text style={styles.addPairText}>항목 추가</Text>
                </Pressable>
              )}

              {/* 비고 입력 (카테고리 공통, 첫 항목 행에 저장, 구분 없음은 행별 비고라 미표시) */}
              {selectedCategory.key === NO_CATEGORY_KEY ? null : (
                <NoteField
                  label="비고"
                  value={selectedRecord.remark}
                  placeholder="필요 시 다음 점검에서 다시 확인할 내용을 기록합니다."
                  minHeight={56}
                  onChangeText={(value) => updateRecord(selectedCategory.key, (record) => ({ ...record, remark: value }))}
                  onResize={keepFocusedInputVisible}
                />
              )}
            </ScrollView>

            {/* 전체 요약 복귀 및 카테고리 저장 하단 버튼 바 */}
            <View style={styles.bottomBar}>
              <Pressable disabled={isSaving} style={styles.secondaryButton} onPress={handleBackToSummary}>
                <Text style={styles.secondaryButtonText}>전체로 이동</Text>
              </Pressable>
              <Pressable
                disabled={isSaving}
                style={[styles.primaryButton, styles.primaryButtonFlex, isSaving && styles.buttonDisabled]}
                onPress={() => void handleSaveCategory()}
              >
                {isSaving ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.primaryButtonText}>저장</Text>}
              </Pressable>
            </View>
          </>
        ) : (
          <>
            {/* 점검 거래처 표시(본사 계정은 거래처 변경 버튼만, 거래처명은 헤더에 표시)와 메인으로·로그아웃 버튼 줄 */}
            <View style={styles.accountBar}>
              {isHeadOffice ? (
                <>
                  <Pressable style={styles.accountBarButton} onPress={() => setIsPickingAccount(true)}>
                    <Text style={styles.accountBarButtonText}>거래처 변경</Text>
                  </Pressable>
                  {/* 메인으로·로그아웃 버튼을 오른쪽으로 미는 빈 공간 */}
                  <View style={styles.accountBarSpacer} />
                </>
              ) : (
                <>
                  <Text style={styles.accountBarLabel}>거래처</Text>
                  <Text style={styles.accountBarName} numberOfLines={1}>
                    {accountName}
                  </Text>
                </>
              )}
              <Pressable style={styles.sessionButton} onPress={handleGoMain}>
                <Text style={styles.sessionButtonText}>메인으로</Text>
              </Pressable>
              <Pressable style={styles.sessionButton} onPress={handleLogout}>
                <Text style={styles.sessionButtonText}>로그아웃</Text>
              </Pressable>
            </View>

            {/* 전체 점검 진행률과 상태별 개수 영역 */}
            <View style={styles.summary}>
              {/* 진행률 제목·퍼센트(왼쪽)와 상태별 개수 배지(오른쪽) */}
              <View style={styles.summaryTitleRow}>
                <Text style={styles.summaryTitle}>
                  전체 점검 현황 <Text style={styles.summaryPercent}>{summary.percent}%</Text>
                </Text>
                <View style={styles.summaryStats}>
                  <Badge label={`완료 ${summary.doneCount}건`} {...statusTone['완료']} />
                  <Badge label={`조치 필요 ${summary.pendingCount}건`} {...statusTone['조치 필요']} />
                </View>
              </View>
              {/* 진행률 막대 */}
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${summary.percent}%` }]} />
              </View>
            </View>

            {/* 상태 필터 탭 영역 */}
            <View style={styles.filterTabs}>
              {filterTabs.map((filter) => {
                const isActive = filter === activeFilter

                return (
                  // 상태 필터 탭 버튼
                  <Pressable
                    key={filter}
                    style={[styles.filterTab, isActive && styles.filterTabActive]}
                    onPress={() => setActiveFilter(filter)}
                  >
                    <Text style={[styles.filterTabText, isActive && styles.filterTabTextActive]}>{filter}</Text>
                  </Pressable>
                )
              })}
            </View>

            {/* 점검 항목 카드 목록 스크롤 영역 */}
            <ScrollView style={styles.body} contentContainerStyle={styles.summaryBodyContent}>
              {/* 점검 항목 제목·개수와 카테고리 편집 버튼 */}
              <View style={styles.bodyHead}>
                <Text style={styles.bodyHeadTitle}>
                  점검 항목 <Text style={styles.bodyHeadCount}>{visibleCategories.length}개</Text>
                </Text>
                {/* 조회 연·월 선택 버튼과 카테고리 편집 버튼 */}
                <View style={styles.bodyHeadActions}>
                  {/* 연·월 선택은 본사 계정만 (현장 계정은 누적 전체) */}
                  {isFieldUser ? null : (
                    <>
                      <Pressable style={styles.editButton} onPress={() => setPeriodPicker('year')}>
                        <Text style={styles.editButtonText}>{viewYear}년 ▾</Text>
                      </Pressable>
                      <Pressable style={styles.editButton} onPress={() => setPeriodPicker('month')}>
                        <Text style={styles.editButtonText}>{viewMonth}월 ▾</Text>
                      </Pressable>
                    </>
                  )}
                  <Pressable style={styles.editButton} onPress={() => setIsEditingCategories(true)}>
                    <Text style={styles.editButtonText}>카테고리 편집</Text>
                  </Pressable>
                </View>
              </View>

              {/* 연·월 선택 창 (선택하면 해당 연·월 점검 기록 다시 조회) */}
              <Modal
                visible={periodPicker !== null}
                transparent
                animationType="fade"
                onRequestClose={() => setPeriodPicker(null)}
              >
                <Pressable style={styles.periodBackdrop} onPress={() => setPeriodPicker(null)}>
                  <View style={styles.periodSheet}>
                    <Text style={styles.periodTitle}>{periodPicker === 'year' ? '연도 선택' : '월 선택'}</Text>
                    <View style={styles.periodOptions}>
                      {(periodPicker === 'year'
                        ? [0, 1, 2].map((offset) => Number(checkDate.slice(0, 4)) - offset)
                        : Array.from({ length: 12 }, (_, index) => index + 1)
                      ).map((value) => {
                        const isActive = value === (periodPicker === 'year' ? viewYear : viewMonth)

                        return (
                          <Pressable
                            key={value}
                            style={[styles.periodOption, isActive && styles.periodOptionActive]}
                            onPress={() => {
                              if (periodPicker === 'year') setViewYear(value)
                              else setViewMonth(value)
                              setPeriodPicker(null)
                            }}
                          >
                            <Text style={[styles.periodOptionText, isActive && styles.periodOptionTextActive]}>
                              {periodPicker === 'year' ? `${value}년` : `${value}월`}
                            </Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  </View>
                </Pressable>
              </Modal>

              {visibleCategories.length === 0 ? (
                // 필터 결과 없음 안내 카드
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyCardText}>{activeFilter} 항목이 없습니다.</Text>
                </View>
              ) : (
                chunk(visibleCategories, 2).map((row, rowIndex) => (
                  // 요약 카드 한 줄 (2칸)
                  <View key={`card-row-${rowIndex}`} style={styles.gridRow}>
                    {row.map((category) => {
                      const record = getRecord(category.key)
                      const status = statusMap[category.key]

                      return (
                        // 요약 카드 한 칸 (내용 길이와 관계없이 줄 폭의 절반 고정)
                        <View key={category.key} style={styles.gridCell}>
                        {/* 카테고리별 요약 카드 (탭 시 상세 화면 이동, 조치 필요 카테고리는 주황 테두리) */}
                        <Pressable
                          style={[styles.overviewCard, status === '조치 필요' && styles.cardNeedAction]}
                          onPress={() => setSelectedKey(category.key)}
                        >
                          {/* 카드 상단 카테고리명 (글자 크기 고정, 긴 이름은 두 줄까지) */}
                          <View style={styles.overviewCardTop}>
                            <Text style={styles.overviewCardTitle} numberOfLines={2}>
                              {category.title}
                            </Text>
                          </View>
                          {/* 조치 전/후 사진 장수 배지(왼쪽)와 점검 상태 배지(오른쪽) */}
                          <View style={styles.overviewCardCounts}>
                            <Badge compact label={`전 ${getPhotoCounts(record).before}`} bg="#f2f5f7" fg="#667584" />
                            <Badge compact label={`후 ${getPhotoCounts(record).after}`} bg="#eef6f1" fg="#3e7652" />
                            <View style={styles.gridSpacer} />
                            {category.showStatus ? <Badge compact label={status} {...statusTone[status]} /> : null}
                          </View>
                          {/* 메모·조치 내용 요약 문구 */}
                          <Text style={styles.overviewCardHint} numberOfLines={2}>
                            {getCategoryHint(record, status)}
                          </Text>
                        </Pressable>
                        </View>
                      )
                    })}
                    {/* 홀수 개일 때 빈칸 채움 (카드 칸과 같은 절반 폭) */}
                    {row.length < 2 ? <View style={styles.gridCell} /> : null}
                  </View>
                ))
              )}

              {/* 화면 사용 안내 TIP 박스 */}
              <View style={styles.hint}>
                <Badge label="TIP" bg="#ddf0f8" fg="#24708d" />
                <Text style={styles.hintText}>전체에서는 요약만 보고, 카드 선택 시 사진·메모 상세로 이동합니다.</Text>
              </View>
            </ScrollView>

            {/* 전체 저장 하단 버튼 바 */}
            <View style={styles.bottomBar}>
              <Pressable
                disabled={isSaving}
                style={[styles.primaryButton, styles.primaryButtonFlex, isSaving && styles.buttonDisabled]}
                onPress={() => void handleSaveAll()}
              >
                {isSaving ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>전체 저장</Text>
                )}
              </Pressable>
            </View>
          </>
        )}
      </View>

      {/* 항목 사진 크게 보기 화면 (조치 전 ↔ 조치 후 비교, 수정 가능한 사진은 다시 촬영·삭제) */}
      <HygienePhotoViewer
        visible={Boolean(viewer && viewerPair)}
        number={viewerIndex + 1}
        beforeUri={viewerPair?.beforePhoto?.uri ?? ''}
        afterUri={viewerPair?.afterPhoto?.uri ?? ''}
        initialSide={viewer?.side ?? 'before'}
        canEdit={canEditSide}
        onRetake={handleViewerRetake}
        onDelete={handleViewerDelete}
        onClose={() => setViewer(null)}
      />
    </SafeAreaView>
  )
}

// 위생 점검 화면 스타일
const styles = StyleSheet.create({
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#f3f6f8',
  },
  loadingText: {
    color: '#7a8998',
    fontSize: 14,
    fontFamily: font.medium,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
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
  accountBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 10,
    backgroundColor: '#ffffff',
  },
  accountBarLabel: {
    color: '#7a8998',
    fontSize: 14,
    fontFamily: font.medium,
  },
  accountBarName: {
    flex: 1,
    color: '#263442',
    fontSize: 16,
    fontFamily: font.bold,
  },
  accountBarSpacer: {
    flex: 1,
  },
  accountBarButton: {
    height: 28,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#9cc9db',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f8fb',
  },
  accountBarButtonText: {
    color: '#1687b2',
    fontSize: 14,
    fontFamily: font.medium,
  },
  sessionButton: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dce4ea',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7f9fa',
  },
  sessionButtonText: {
    color: '#5b6a79',
    fontSize: 14,
    fontFamily: font.medium,
  },
  accountSearchBar: {
    paddingHorizontal: 18,
    paddingBottom: 10,
    backgroundColor: '#ffffff',
  },
  accountSearchInput: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cfd8e0',
    backgroundColor: '#ffffff',
    color: '#344252',
    fontSize: 16,
    fontFamily: font.regular,
  },
  accountListContent: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    gap: 8,
  },
  accountRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dde5eb',
    backgroundColor: '#ffffff',
  },
  accountRowActive: {
    borderColor: '#1593c4',
    backgroundColor: '#f1f8fb',
  },
  accountRowText: {
    flex: 1,
    color: '#273542',
    fontSize: 16,
    fontFamily: font.medium,
  },
  summary: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 8,
    backgroundColor: '#ffffff',
  },
  summaryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  summaryTitle: {
    color: '#263442',
    fontSize: 16,
    fontFamily: font.bold,
  },
  summaryPercent: {
    color: '#1593c4',
    fontSize: 16,
    fontFamily: font.bold,
  },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: '#e7edf2',
    overflow: 'hidden',
  },
  progressFill: {
    height: 7,
    borderRadius: 999,
    backgroundColor: '#1593c4',
  },
  summaryStats: {
    flexDirection: 'row',
    gap: 8,
  },
  filterTabs: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
  },
  filterTab: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dce4ea',
    paddingHorizontal: 15,
    paddingVertical: 8,
    backgroundColor: '#f7f9fa',
  },
  filterTabActive: {
    paddingHorizontal: 18,
    borderColor: '#1593c4',
    backgroundColor: '#1593c4',
  },
  filterTabText: {
    color: '#5b6a79',
    fontSize: 14,
    fontFamily: font.medium,
  },
  filterTabTextActive: {
    color: '#ffffff',
    fontFamily: font.bold,
  },
  body: {
    flex: 1,
  },
  summaryBodyContent: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
    gap: 12,
  },
  bodyHead: {
    minHeight: 32,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bodyHeadTitle: {
    color: '#263442',
    fontSize: 16,
    fontFamily: font.bold,
  },
  bodyHeadCount: {
    color: '#7a8998',
    fontSize: 14,
    fontFamily: font.medium,
  },
  // 좁은 화면에서는 제목 아래 줄로 내려가 오른쪽 정렬, 그래도 넘치면 버튼끼리 줄바꿈
  bodyHeadActions: {
    marginLeft: 'auto',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 6,
  },
  periodBackdrop: {
    flex: 1,
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  periodSheet: {
    width: '100%',
    maxWidth: 360,
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#ffffff',
  },
  periodTitle: {
    marginBottom: 14,
    color: '#263442',
    fontSize: 18,
    fontFamily: font.bold,
  },
  periodOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  periodOption: {
    width: '30%',
    flexGrow: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e6ecf0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodOptionActive: {
    borderColor: '#1593c4',
    backgroundColor: '#1593c4',
  },
  periodOptionText: {
    color: '#273542',
    fontSize: 16,
    fontFamily: font.medium,
  },
  periodOptionTextActive: {
    color: '#ffffff',
  },
  editButton: {
    height: 32,
    paddingHorizontal: 12,
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
  // 요약 카드 한 줄 (칸 좌우 여백 6씩 = 카드 사이 12, 바깥 여백은 음수 마진으로 상쇄)
  gridRow: {
    flexDirection: 'row',
    marginHorizontal: -6,
  },
  // 요약 카드 한 칸 (줄 폭의 정확히 절반, 카드 내용이 길어도 옆 칸을 밀지 않음)
  gridCell: {
    width: '50%',
    paddingHorizontal: 6,
  },
  gridSpacer: {
    flex: 1,
  },
  overviewCard: {
    flex: 1,
    padding: 12,
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dde5eb',
    backgroundColor: '#ffffff',
  },
  overviewCardTop: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  overviewCardTitle: {
    flex: 1,
    color: '#273542',
    fontSize: 15,
    lineHeight: 20,
    fontFamily: font.bold,
  },
  // 전/후·상태 배지 한 줄 (작은 배지와 좁은 간격으로 반쪽 카드 폭에 맞춤)
  overviewCardCounts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  overviewCardHint: {
    minHeight: 24,
    color: '#728190',
    fontSize: 12,
    fontFamily: font.regular,
  },
  overviewCardLinkArrow: {
    color: '#1687b2',
    fontSize: 16,
    fontFamily: font.medium,
  },
  emptyCard: {
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dde5eb',
    backgroundColor: '#ffffff',
  },
  emptyCardText: {
    color: '#728190',
    fontSize: 14,
    fontFamily: font.regular,
    textAlign: 'center',
  },
  hint: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#eaf5fa',
  },
  hintText: {
    flex: 1,
    color: '#4e7182',
    fontSize: 12,
    fontFamily: font.regular,
  },
  bottomBar: {
    height: 72,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
  },
  primaryButton: {
    height: 48,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1593c4',
  },
  primaryButtonFlex: {
    flex: 1,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontFamily: font.bold,
  },
  secondaryButton: {
    width: 104,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ccd8e0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  secondaryButtonText: {
    color: '#52606d',
    fontSize: 16,
    fontFamily: font.medium,
  },
  categoryChipsBar: {
    flexGrow: 0,
    backgroundColor: '#ffffff',
  },
  categoryChips: {
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  categoryChip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dce4ea',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7f9fa',
  },
  categoryChipActive: {
    borderColor: '#1593c4',
    backgroundColor: '#1593c4',
  },
  categoryChipText: {
    color: '#51606f',
    fontSize: 14,
    fontFamily: font.medium,
  },
  categoryChipTextActive: {
    color: '#ffffff',
    fontFamily: font.bold,
  },
  guideBox: {
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#eaf5fa',
  },
  guideSection: {
    gap: 6,
  },
  guideLabel: {
    color: '#1687b2',
    fontSize: 14,
    fontFamily: font.bold,
  },
  guideChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  guideChip: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: '#ffffff',
  },
  guideChipText: {
    color: '#344252',
    fontSize: 14,
    fontFamily: font.medium,
  },
  guidePoint: {
    color: '#344252',
    fontSize: 14,
    fontFamily: font.medium,
  },
  detailBodyContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 18,
    gap: 14,
  },
  detailSummary: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  detailSummaryText: {
    gap: 2,
  },
  detailSummaryTitle: {
    color: '#263442',
    fontSize: 16,
    fontFamily: font.bold,
  },
  detailSummaryMeta: {
    color: '#778694',
    fontSize: 12,
    fontFamily: font.regular,
  },
  detailSummaryHint: {
    color: '#1687b2',
    fontSize: 12,
    fontFamily: font.medium,
  },
  pairCard: {
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dde5eb',
    backgroundColor: '#ffffff',
  },
  // 조치 필요 카드 강조 테두리 (요약 카드·항목 카드 공통, 웹 위생점검과 같은 주황)
  cardNeedAction: {
    borderWidth: 2,
    borderColor: '#f0a35c',
  },
  pairCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pairNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcebf3',
  },
  pairNumberText: {
    color: '#1687b2',
    fontSize: 14,
    fontFamily: font.bold,
  },
  pairCardTitle: {
    color: '#263442',
    fontSize: 16,
    fontFamily: font.bold,
  },
  pairDeleteText: {
    color: '#b04141',
    fontSize: 14,
    fontFamily: font.medium,
  },
  pairColumns: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 4,
  },
  pairArrow: {
    alignSelf: 'center',
  },
  pairSide: {
    flex: 1,
    gap: 6,
    padding: 8,
    borderRadius: 12,
  },
  pairSideBefore: {
    backgroundColor: '#fbf5f0',
  },
  pairSideAfter: {
    backgroundColor: '#eff7f1',
  },
  pairSideHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  pairSideStamp: {
    flexShrink: 1,
    color: '#7a8998',
    fontSize: 12,
    fontFamily: font.regular,
  },
  pairSideTitle: {
    color: '#3d4a56',
    fontSize: 14,
    fontFamily: font.bold,
  },
  pairPhotoBox: {
    height: 92,
    gap: 4,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#e3e9ee',
  },
  pairPhotoImage: {
    width: '100%',
    height: '100%',
  },
  pairPhotoLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pairPhotoText: {
    color: '#6f7d8a',
    fontSize: 12,
    fontFamily: font.medium,
  },
  pairNoteLabel: {
    color: '#445362',
    fontSize: 14,
    fontFamily: font.medium,
  },
  pairNoteInput: {
    minHeight: 56,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cfd8e0',
    backgroundColor: '#ffffff',
    color: '#344252',
    fontSize: 14,
    fontFamily: font.regular,
  },
  // 잠금 칸 메모 글 (줄바꿈 그대로, 넉넉한 줄 간격으로 전체 표시)
  pairNoteText: {
    paddingHorizontal: 2,
    color: '#344252',
    fontSize: 14,
    lineHeight: 21,
    fontFamily: font.regular,
  },
  pairNoteTextEmpty: {
    color: '#9aa7b3',
  },
  pairEmpty: {
    gap: 4,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  pairEmptyText: {
    color: '#8a97a3',
    fontSize: 14,
    fontFamily: font.regular,
  },
  addPairButton: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#9cc9db',
    backgroundColor: '#f1f8fb',
  },
  addPairText: {
    color: '#1687b2',
    fontSize: 16,
    fontFamily: font.bold,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: '#445362',
    fontSize: 14,
    fontFamily: font.medium,
  },
  fieldInput: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cfd8e0',
    backgroundColor: '#ffffff',
    color: '#344252',
    fontSize: 14,
    fontFamily: font.regular,
  },
})
