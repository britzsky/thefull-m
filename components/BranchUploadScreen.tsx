import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { requireOptionalNativeModule } from 'expo'
import * as ImagePicker from 'expo-image-picker'
import { router } from 'expo-router'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type ImageResizeMode,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import Badge from '@/components/Badge'
import BrandHeader from '@/components/BrandHeader'
import MenuDocumentViewer from '@/components/MenuDocumentViewer'
import ZoomableImage from '@/components/ZoomableImage'
import { AttendanceAccount, fetchAttendanceAccounts } from '@/lib/attendance/api'
import { getAppSession, logoutAppSession } from '@/lib/auth/storage'
import {
  BranchDocument,
  BranchUploadRow,
  BranchWeek,
  deleteBranchFile,
  fetchBranchUploads,
  fetchHolidayDates,
  formatMonthDay,
  formatWeekRange,
  isImagePath,
  monthWeeks,
  saveBranchPhoto,
  toBranchFileUrl,
  toDateKey,
  weekdayOf,
} from '@/lib/branchUpload/api'
import { font } from '@/lib/fonts'

// 지점 업로드 화면 (Figma V8: 주차 목록 → 주차 상세 → 일별 식판 사진 등록)
// 영양사·조리사/조리원은 소속 거래처, 본사 계정(user_type 1·2)은 거래처를 골라 진행

// 화면 단계 (loading: 로그인 세션 확인 중, picker: 본사 거래처 선택, weeks: 주차 목록, week: 주차 상세, photo: 식판 사진 등록)
type Step = 'loading' | 'picker' | 'weeks' | 'week' | 'photo'

// 배지 색상 (위생 점검 상태 색상과 동일, 완료: 초록, 등록 중·지난 날짜 미등록: 주황, 미등록: 회색, 정보: 파랑)
const tone = {
  green: { bg: '#eaf7ef', fg: '#2a7a49' },
  orange: { bg: '#fff3e6', fg: '#a55d1d' },
  gray: { bg: '#f0f3f5', fg: '#667584' },
  blue: { bg: '#eaf5fa', fg: '#1687b2' },
}

// 등록 진행률 상태 배지 (전부 등록: 완료, 일부: 등록 중, 없음: 미등록)
function progressBadge(done: number, total: number) {
  if (total > 0 && done >= total) return { label: '완료', ...tone.green }
  return done > 0 ? { label: '등록 중', ...tone.orange } : { label: '미등록', ...tone.gray }
}

// 진행률 막대 (위생 점검 전체 점검 현황 막대와 같은 모양)
function ProgressBar({ percent }: { percent: number }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${percent}%` }]} />
    </View>
  )
}

// 사진 표시 칸 (불러오는 동안 가운데 로딩 스피너 표시, 칸 크기·모서리는 style로 지정)
function LoadingImage({ uri, style, resizeMode }: { uri: string; style: StyleProp<ViewStyle>; resizeMode?: ImageResizeMode }) {
  // 불러오기를 마친 사진 주소 (현재 사진 주소와 다르면 로딩 중 표시)
  const [loadedUri, setLoadedUri] = useState('')

  return (
    <View style={[style, styles.imageBox]}>
      <Image source={{ uri }} resizeMode={resizeMode} onLoadEnd={() => setLoadedUri(uri)} style={StyleSheet.absoluteFill} />
      {/* 사진 불러오는 중 로딩 표시 */}
      {loadedUri !== uri ? (
        <View pointerEvents="none" style={styles.imageLoading}>
          <ActivityIndicator color="#1593c4" />
        </View>
      ) : null}
    </View>
  )
}

// "2026년 10월 29일 (목)" 형식 날짜 문자열
function formatLongDate(key: string) {
  return `${key.slice(0, 4)}년 ${Number(key.slice(5, 7))}월 ${Number(key.slice(8, 10))}일 (${weekdayOf(key)})`
}

// 사진 가져오기 방법 선택 후 사진 1장 경로 반환 (camera: 후면 카메라 촬영, library: 앨범 선택, 취소 시 null)
// 앨범 선택은 시스템 사진 선택 창을 써서 권한이 필요 없음 (앱에 사진 권한 설명이 없어 iOS에서 권한을 요청하면 앱이 종료됨)
async function pickPhoto(source: 'camera' | 'library') {
  if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
    Alert.alert('권한 필요', '사진 촬영을 위해 카메라 권한이 필요합니다.')
    return null
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], cameraType: ImagePicker.CameraType.back, quality: 0.8 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 })

  return result.canceled || !result.assets[0] ? null : result.assets[0].uri
}

// 식단표로 올릴 수 있는 문서 형식 (엑셀 xls·xlsx, PDF)
const MENU_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]

// 기기 파일에서 엑셀·PDF 식단표 1개를 골라 경로와 파일 정보 반환 (취소 시 null)
// 파일 선택 모듈은 네이티브 모듈이 설치된 빌드에서만 불러옴 (없는 이전 빌드는 안내 후 종료)
async function pickMenuDocument(): Promise<{ uri: string; document: BranchDocument } | null> {
  if (!requireOptionalNativeModule('ExpoDocumentPicker')) {
    Alert.alert('업데이트 필요', '파일 선택은 앱을 최신 버전으로 업데이트한 뒤 이용할 수 있습니다.')
    return null
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DocumentPicker = require('expo-document-picker') as typeof import('expo-document-picker')
  const result = await DocumentPicker.getDocumentAsync({ type: MENU_DOCUMENT_TYPES, copyToCacheDirectory: true })
  const asset = result.canceled ? null : result.assets[0]

  return asset ? { uri: asset.uri, document: { name: asset.name, mimeType: asset.mimeType } } : null
}

// 화면 상단 제목 바 (왼쪽 뒤로 버튼, 가운데 제목·부제목, 오른쪽 추가 요소)
// 좌우 칸을 같은 폭으로 나눠 오른쪽 버튼 유무와 관계없이 제목을 화면 정중앙에 맞춤
function TitleBar({ title, subtitle, onBack, right }: { title: string; subtitle: string; onBack: () => void; right?: ReactNode }) {
  return (
    <View style={styles.titleBar}>
      {/* 왼쪽 뒤로 버튼 칸 */}
      <View style={styles.titleSide}>
        <Pressable hitSlop={8} style={styles.backButton} onPress={onBack}>
          <MaterialCommunityIcons name="chevron-left" size={26} color="#273542" />
        </Pressable>
      </View>
      {/* 가운데 제목·부제목 */}
      <View style={styles.titleText}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      {/* 오른쪽 추가 요소 칸 */}
      <View style={[styles.titleSide, styles.titleSideRight]}>{right}</View>
    </View>
  )
}

export default function BranchUploadScreen() {
  // 태블릿 폭 여부 (가운데 정렬 최대 폭 적용 기준)
  const { width } = useWindowDimensions()
  const isTablet = width >= 768

  // 오늘 날짜 (현재 주차 표시 기준)
  const [today] = useState(() => toDateKey())
  // 현재 화면 단계 (세션 확인이 끝나기 전에는 loading)
  const [step, setStep] = useState<Step>('loading')
  // 로그인 사용자 아이디 (저장 시 reg_user_id·mod_user_id, 조리사/조리원은 이름)
  const [loginUserId, setLoginUserId] = useState('')
  // 업로드 대상 거래처 key (현장 계정은 로그인 거래처, 본사 계정은 선택한 거래처)
  const [accountId, setAccountId] = useState('')
  // 거래처 목록 (거래처명 표시·본사 거래처 선택용)
  const [accounts, setAccounts] = useState<AttendanceAccount[]>([])
  // 본사 계정 여부 (거래처 선택 행 표시)
  const [isHeadOffice, setIsHeadOffice] = useState(false)
  // 거래처 선택 화면 검색어
  const [accountQuery, setAccountQuery] = useState('')
  // 조회 연·월 (기본 이번 달)
  const [viewYear, setViewYear] = useState(() => Number(today.slice(0, 4)))
  const [viewMonth, setViewMonth] = useState(() => Number(today.slice(5, 7)))
  // 연·월 선택 창 종류 (닫힘: null)
  const [periodPicker, setPeriodPicker] = useState<'year' | 'month' | null>(null)
  // 조회한 지점 업로드 행 (날짜 key → 행)
  const [rowsByDate, setRowsByDate] = useState<Record<string, BranchUploadRow>>({})
  // 조회 기간의 공휴일 날짜 (yyyy-mm-dd, 일요일과 같이 빨간 글씨로 표시)
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set())
  // 목록 조회 중 여부 (첫 조회가 끝날 때까지 true라 주차 목록이 비었다가 나타나지 않음)
  const [isLoading, setIsLoading] = useState(true)
  // 업로드·저장 중 여부 (버튼 중복 클릭 방지)
  const [isSaving, setIsSaving] = useState(false)
  // 상세 화면 주차 시작일(월요일)
  const [selectedWeekStart, setSelectedWeekStart] = useState('')
  // 식판 사진 등록 화면 날짜
  const [photoDate, setPhotoDate] = useState('')
  // 크게 보기 중인 식단표 파일 주소 (빈 값이면 닫힘)
  const [menuViewerUri, setMenuViewerUri] = useState('')

  // 선택 연월의 주차 목록
  const weeks = useMemo(() => monthWeeks(viewYear, viewMonth), [viewYear, viewMonth])
  // 상세 화면 주차
  const selectedWeek = weeks.find((week) => week.start === selectedWeekStart) ?? null
  // 업로드 대상 거래처명
  const accountName = accounts.find((account) => account.account_id === accountId)?.account_name ?? ''

  // 거래처 선택 화면 검색 결과 (거래처명 포함 검색)
  const filteredAccounts = useMemo(() => {
    const query = accountQuery.trim()
    return query ? accounts.filter((account) => account.account_name.includes(query)) : accounts
  }, [accounts, accountQuery])

  // 화면 진입 시 로그인 세션 확인 (본사 계정은 거래처 선택, 현장 계정·조리사/조리원은 로그인 거래처로 진행)
  useEffect(() => {
    let active = true

    const loadSession = async () => {
      const appSession = await getAppSession()

      if (!appSession) {
        Alert.alert('로그인 필요', '지점 업로드는 로그인 후 이용할 수 있습니다.')
        router.replace('/login')
        return
      }

      const accountList = await fetchAttendanceAccounts().catch(() => [])
      if (!active) return
      setAccounts(accountList)

      // 조리사/조리원: 기기 승인된 근무지로 진행, 등록자는 이름으로 저장
      if (appSession.mode === 'cook') {
        setLoginUserId(appSession.cook.userName)
        setAccountId(appSession.cook.accountId)
        setStep('weeks')
        return
      }

      const session = appSession.staff
      const headOffice = session.userType === '1' || session.userType === '2'
      const sessionAccountId = session.accountId === 'null' ? '' : session.accountId

      setLoginUserId(session.userId)
      setIsHeadOffice(headOffice)

      if (headOffice) {
        // 본사 계정 → 거래처 선택 화면부터 시작
        setStep('picker')
      } else if (sessionAccountId) {
        // 영양사 계정 → 소속 거래처로 바로 진입
        setAccountId(sessionAccountId)
        setStep('weeks')
      } else {
        Alert.alert('이용 불가', '거래처가 연결된 계정만 지점 업로드를 이용할 수 있습니다.')
        router.replace('/home')
      }
    }

    void loadSession()

    return () => {
      active = false
    }
  }, [])

  // 선택 거래처·연월의 첫 주 월요일 ~ 마지막 주 일요일 자료를 다시 조회하는 함수
  // silent: 화면 이동 시 로딩 화면·실패 알림 없이 조용히 최신 자료로 교체
  const loadRows = useCallback(
    async (silent = false) => {
      if (!accountId || weeks.length === 0) {
        setRowsByDate({})
        return
      }

      if (!silent) setIsLoading(true)
      try {
        const rows = await fetchBranchUploads(accountId, weeks[0].start, weeks[weeks.length - 1].end)
        setRowsByDate(Object.fromEntries(rows.map((row) => [row.meal_date, row])))
      } catch (error) {
        if (!silent) Alert.alert('조회 실패', error instanceof Error ? error.message : '지점 업로드 자료를 불러오지 못했습니다.')
      } finally {
        if (!silent) setIsLoading(false)
      }
    },
    [accountId, weeks]
  )

  // 거래처·연월이 바뀌면 자료 다시 조회
  useEffect(() => {
    void loadRows()
  }, [loadRows])

  // 연월이 바뀌면 주차 기간(월 경계 주 포함)에 걸친 달들의 공휴일 조회 (실패하면 공휴일 표시 없이 진행)
  useEffect(() => {
    if (weeks.length === 0) return
    let active = true
    const months = Array.from(new Set([weeks[0].start, weeks[weeks.length - 1].end].map((date) => date.slice(0, 7))))

    Promise.all(months.map((ym) => fetchHolidayDates(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)))))
      .then((lists) => {
        if (active) setHolidayDates(new Set(lists.flat()))
      })
      .catch(() => {
        if (active) setHolidayDates(new Set())
      })

    return () => {
      active = false
    }
  }, [weeks])

  // 주차의 식단표 행(월요일 행), 식판 사진 등록 일수, 등록 진행 수(식단표 1 + 식판 사진 7 = 8건 기준)
  const weekStatus = (week: BranchWeek) => {
    const menuRow = rowsByDate[week.start]?.menu_file_path ? rowsByDate[week.start] : null
    const plateCount = week.dates.filter((date) => rowsByDate[date]?.plate_file_path).length
    return { menuRow, plateCount, done: (menuRow ? 1 : 0) + plateCount }
  }

  // 선택 연월 전체 등록 현황 (식단표 등록 주 수, 식판 사진 등록 일수, 진행률)
  const monthSummary = useMemo(() => {
    const statuses = weeks.map((week) => weekStatus(week))
    const total = weeks.length * 8
    const done = statuses.reduce((sum, status) => sum + status.done, 0)
    return {
      menuWeeks: statuses.filter((status) => status.menuRow).length,
      plateDays: statuses.reduce((sum, status) => sum + status.plateCount, 0),
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeks, rowsByDate])

  // 뒤로 버튼 처리 (사진 등록 → 주차 상세 → 주차 목록 → 메인, 이동한 화면은 최신 자료로 다시 조회)
  const handleBack = useCallback(() => {
    if (step === 'photo') {
      setStep('week')
      void loadRows(true)
    } else if (step === 'week') {
      setStep('weeks')
      void loadRows(true)
    } else if (step === 'picker' && accountId) {
      setStep('weeks')
      void loadRows(true)
    } else if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/home')
    }
  }, [step, accountId, loadRows])

  // 안드로이드 하드웨어 뒤로 버튼도 화면 단계 뒤로 처리
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isSaving) return true
      handleBack()
      return true
    })
    return () => subscription.remove()
  }, [handleBack, isSaving])

  // 본사 거래처 선택 처리 (선택 후 주차 목록으로 이동)
  const handleSelectAccount = (id: string) => {
    setAccountId(id)
    setAccountQuery('')
    setStep('weeks')
  }

  // 거래처 선택 화면 닫기 (거래처 변경을 취소하고 주차 목록 복귀)
  const handleCancelPickAccount = () => {
    setAccountQuery('')
    setStep('weeks')
    void loadRows(true)
  }

  // 메인으로 버튼 처리 (이전 화면이 없으면 메인 화면으로 이동)
  const handleGoMain = () => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/home')
    }
  }

  // 로그아웃 버튼 처리 (로그인 세션·저장된 비밀번호 삭제 후 로그인 화면 이동)
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

  // 주차 카드 선택 처리 (주차 상세로 이동 후 최신 자료 조회)
  const handleOpenWeek = (week: BranchWeek) => {
    setSelectedWeekStart(week.start)
    setStep('week')
    void loadRows(true)
  }

  // 일자 카드 선택 처리 (식판 사진 등록 화면으로 이동 후 최신 자료 조회)
  const handleOpenDay = (date: string) => {
    setPhotoDate(date)
    setStep('photo')
    void loadRows(true)
  }

  // 등록된 식단표 열기 (사진·엑셀·PDF 모두 앱 안 전체 화면으로 표시)
  const handleOpenMenuFile = (path?: string | null) => {
    setMenuViewerUri(toBranchFileUrl(path))
  }

  // 주간 식단표 등록·교체 버튼 처리 (촬영·앨범 사진 또는 엑셀·PDF 파일을 그 주 월요일 행에 바로 저장)
  const handleUploadMenu = (week: BranchWeek) => {
    const upload = async (source: 'camera' | 'library' | 'file') => {
      const picked = source === 'file' ? await pickMenuDocument() : await pickPhoto(source).then((uri) => (uri ? { uri, document: undefined } : null))
      if (!picked) return

      setIsSaving(true)
      try {
        await saveBranchPhoto('menu', picked.uri, accountId, week.start, loginUserId, picked.document)
        await loadRows()
        Alert.alert('저장 완료', '주간 식단표가 등록되었습니다.')
      } catch (error) {
        Alert.alert('저장 실패', error instanceof Error ? error.message : '식단표 저장에 실패했습니다.')
      } finally {
        setIsSaving(false)
      }
    }

    // 안드로이드 알림창은 버튼이 최대 3개라 취소 버튼 없이 바깥 터치·뒤로 버튼으로 닫음
    Alert.alert(
      '주간 식단표',
      '식단표를 어떻게 등록할까요?',
      [
        { text: '사진 촬영', onPress: () => void upload('camera') },
        { text: '앨범에서 선택', onPress: () => void upload('library') },
        { text: '파일 선택 (엑셀·PDF)', onPress: () => void upload('file') },
        ...(Platform.OS === 'ios' ? [{ text: '취소', style: 'cancel' as const }] : []),
      ],
      { cancelable: true }
    )
  }

  // 식판 사진 촬영·앨범 선택 버튼 처리 (고른 사진을 선택 날짜 행에 바로 저장 후 주차 상세로 복귀)
  const handlePickPlate = async (source: 'camera' | 'library') => {
    const uri = await pickPhoto(source)
    if (!uri) return

    setIsSaving(true)
    try {
      await saveBranchPhoto('plate', uri, accountId, photoDate, loginUserId)
      await loadRows()
      setStep('week')
      Alert.alert('저장 완료', '식판 사진이 저장되었습니다.')
    } catch (error) {
      Alert.alert('저장 실패', error instanceof Error ? error.message : '식판 사진 저장에 실패했습니다.')
    } finally {
      setIsSaving(false)
    }
  }

  // 등록된 식단표·식판 사진 삭제 버튼 처리 (확인 후 경로를 비우고 목록 다시 조회)
  const handleDeleteFile = (kind: 'menu' | 'plate', mealDate: string) => {
    const label = kind === 'menu' ? '주간 식단표' : '식판 사진'

    Alert.alert(`${label} 삭제`, `등록된 ${label}을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          setIsSaving(true)
          try {
            await deleteBranchFile(kind, accountId, mealDate, loginUserId)
            await loadRows()
            Alert.alert('삭제 완료', `${label}이 삭제되었습니다.`)
          } catch (error) {
            Alert.alert('삭제 실패', error instanceof Error ? error.message : `${label} 삭제에 실패했습니다.`)
          } finally {
            setIsSaving(false)
          }
        },
      },
    ])
  }

  // 로그인 세션 확인·주차 목록 조회 중 로딩 화면 (위생 점검과 같은 화면 가운데 로딩 표시)
  if (step === 'loading' || (step === 'weeks' && isLoading)) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        {/* 화면 가운데 로딩 표시 */}
        <View style={styles.loadingBox}>
          <ActivityIndicator color="#1593c4" />
          <Text style={styles.loadingText}>지점 업로드 정보를 불러오는 중</Text>
        </View>
      </SafeAreaView>
    )
  }

  // 저장 중 전체 화면 로딩 (사진 업로드~저장 완료까지 화면 터치 차단)
  const savingOverlay = isSaving ? (
    <View style={styles.savingOverlay}>
      <ActivityIndicator size="large" color="#1593c4" />
      <Text style={styles.loadingText}>저장 중입니다</Text>
    </View>
  ) : null

  // 본사 계정 거래처 선택 화면 (위생 점검 거래처 선택 화면과 같은 구성)
  if (step === 'picker') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        {/* 화면 전체 틀 (태블릿은 가운데 최대 폭) */}
        <View style={[styles.frame, isTablet && styles.frameTablet]}>
          {/* 상단 로고와 화면 제목 헤더 */}
          <BrandHeader title="지점 업로드" subtitle="거래처 선택" />

          {/* 거래처명 검색 입력 영역 */}
          <View style={styles.searchBar}>
            <TextInput
              value={accountQuery}
              onChangeText={setAccountQuery}
              placeholder="거래처명을 검색하세요"
              placeholderTextColor="#9aa7b3"
              style={styles.searchInput}
            />
          </View>

          {/* 거래처 목록 (탭 시 해당 거래처 주차 목록으로 이동) */}
          <FlatList
            data={filteredAccounts}
            keyExtractor={(account) => account.account_id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              // 검색 결과 없음 안내
              <Text style={styles.emptyText}>검색된 거래처가 없습니다.</Text>
            }
            renderItem={({ item }) => (
              // 거래처 한 줄 버튼 (현재 선택 거래처는 강조)
              <Pressable
                style={[styles.accountRow, item.account_id === accountId && styles.accountRowActive]}
                onPress={() => handleSelectAccount(item.account_id)}
              >
                <Text style={styles.accountRowText}>{item.account_name}</Text>
                <Text style={styles.accountRowArrow}>›</Text>
              </Pressable>
            )}
          />

          {/* 하단 버튼 바 (거래처 변경 중이면 취소, 처음 진입이면 로그아웃·메인으로) */}
          <View style={styles.bottomBar}>
            {accountId ? (
              <Pressable style={styles.secondaryButton} onPress={handleCancelPickAccount}>
                <Text style={styles.secondaryButtonText}>취소</Text>
              </Pressable>
            ) : (
              <>
                <Pressable style={styles.secondaryButton} onPress={handleLogout}>
                  <Text style={styles.secondaryButtonText}>로그아웃</Text>
                </Pressable>
                <Pressable style={styles.secondaryButton} onPress={handleGoMain}>
                  <Text style={styles.secondaryButtonText}>메인으로</Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // 일별 식판 사진 등록 화면
  if (step === 'photo' && selectedWeek) {
    const savedPath = rowsByDate[photoDate]?.plate_file_path
    const previewUri = toBranchFileUrl(savedPath)

    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <View style={[styles.frame, isTablet && styles.frameTablet]}>
          <TitleBar
            title="식판 사진 등록"
            subtitle={`${viewMonth}월 ${selectedWeek.no}주차 · ${weekdayOf(photoDate)}요일`}
            onBack={handleBack}
          />

          <ScrollView contentContainerStyle={styles.bodyContent}>
            {/* 업로드 대상 거래처·날짜 영역 */}
            <View style={styles.card}>
              <Text style={styles.metaText}>{accountName}</Text>
              <Text style={styles.targetDate}>{formatLongDate(photoDate)}</Text>
            </View>

            {/* 식판 사진 소제목과 등록 상태 */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>식판 사진</Text>
              <Badge label={savedPath ? '1장 등록' : '미등록'} {...(savedPath ? tone.green : tone.gray)} large />
            </View>

            {/* 사진 미리보기 카드 (등록된 사진, 없으면 빈 칸 안내) */}
            <View style={[styles.card, styles.previewCard]}>
              {previewUri ? (
                <LoadingImage uri={previewUri} style={styles.previewImage} resizeMode="contain" />
              ) : (
                <View style={[styles.previewImage, styles.previewEmpty]}>
                  <MaterialCommunityIcons name="image-outline" size={40} color="#a7b4c0" />
                </View>
              )}
              <Text style={styles.metaText}>식판 사진 미리보기</Text>
            </View>

            {/* 사진 선택 방법 (촬영 / 앨범) */}
            <View style={styles.row}>
              <Pressable style={[styles.card, styles.pickButton]} disabled={isSaving} onPress={() => void handlePickPlate('camera')}>
                <MaterialCommunityIcons name="camera-outline" size={20} color="#1687b2" />
                <Text style={styles.pickButtonText}>사진 촬영</Text>
              </Pressable>
              <Pressable style={[styles.card, styles.pickButton]} disabled={isSaving} onPress={() => void handlePickPlate('library')}>
                <MaterialCommunityIcons name="image-outline" size={20} color="#1687b2" />
                <Text style={styles.pickButtonText}>앨범에서 선택</Text>
              </Pressable>
            </View>

            {/* 등록된 식판 사진 삭제 버튼 (등록된 사진이 있을 때만) */}
            {savedPath ? (
              <Pressable style={styles.deleteWideButton} disabled={isSaving} onPress={() => handleDeleteFile('plate', photoDate)}>
                <MaterialCommunityIcons name="trash-can-outline" size={20} color="#d93838" />
                <Text style={styles.deleteWideButtonText}>식판 사진 삭제하기</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
        {savingOverlay}
      </SafeAreaView>
    )
  }

  // 주차 상세 화면 (주간 식단표 1건 + 요일별 식판 사진)
  if (step === 'week' && selectedWeek) {
    const { menuRow, plateCount, done } = weekStatus(selectedWeek)
    const weekBadge = progressBadge(done, 8)

    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <View style={[styles.frame, isTablet && styles.frameTablet]}>
          <TitleBar title={`${viewMonth}월 ${selectedWeek.no}주차`} subtitle={formatWeekRange(selectedWeek)} onBack={handleBack} />

          {/* 대상 지점과 이번 주 등록 진행률 요약 띠 */}
          <View style={styles.summary}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryAccount}>
                <MaterialCommunityIcons name="briefcase-outline" size={17} color="#1593c4" />
                <Text style={styles.metaText}>거래처</Text>
                <Text style={styles.summaryAccountText} numberOfLines={1}>
                  {accountName}
                </Text>
              </View>
              <Badge label={weekBadge.label} bg={weekBadge.bg} fg={weekBadge.fg} large />
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryTitle}>
                이번 주 등록 현황 <Text style={styles.summaryPercent}>{Math.round((done / 8) * 100)}%</Text>
              </Text>
              <Text style={styles.metaText}>
                식단표 {menuRow ? 1 : 0}/1 · 사진 {plateCount}/7
              </Text>
            </View>
            <ProgressBar percent={Math.round((done / 8) * 100)} />
          </View>

          <ScrollView contentContainerStyle={styles.bodyContent}>
            {/* 주간 식단표 카드 (등록 시 파일 정보와 교체 버튼, 미등록 시 등록 버튼, 미등록이면 주황 테두리) */}
            <View style={[styles.card, !menuRow && styles.cardNeedAction]}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>주간 식단표</Text>
                <Badge label={menuRow ? '등록 완료' : '등록 필요'} {...(menuRow ? tone.green : tone.orange)} large />
              </View>
              {menuRow ? (
                // 등록된 식단표 파일 (탭 시 파일 열기)
                <Pressable style={styles.menuFile} onPress={() => handleOpenMenuFile(menuRow.menu_file_path)}>
                  {isImagePath(menuRow.menu_file_path) ? (
                    <LoadingImage uri={toBranchFileUrl(menuRow.menu_file_path)} style={styles.menuThumb} />
                  ) : (
                    <View style={[styles.menuThumb, styles.menuIcon]}>
                      <MaterialCommunityIcons name="file-document-outline" size={28} color="#2a7a49" />
                    </View>
                  )}
                  <View style={styles.menuInfo}>
                    <Text style={styles.menuTitle}>
                      {viewMonth}월 {selectedWeek.no}주차 식단표
                    </Text>
                    <Text style={styles.metaText}>{menuRow.menu_reg_dt ? `${menuRow.menu_reg_dt} 등록` : '1개 파일 등록됨'}</Text>
                  </View>
                  <Pressable style={styles.smallButton} disabled={isSaving} onPress={() => handleUploadMenu(selectedWeek)}>
                    <Text style={styles.smallButtonText}>교체</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.smallButton, styles.deleteButton]}
                    disabled={isSaving}
                    onPress={() => handleDeleteFile('menu', selectedWeek.start)}
                  >
                    <Text style={[styles.smallButtonText, styles.deleteButtonText]}>삭제</Text>
                  </Pressable>
                </Pressable>
              ) : (
                // 식단표 등록 버튼
                <Pressable style={styles.addArea} disabled={isSaving} onPress={() => handleUploadMenu(selectedWeek)}>
                  {isSaving ? (
                    <ActivityIndicator color="#1593c4" />
                  ) : (
                    <>
                      <MaterialCommunityIcons name="camera-plus-outline" size={18} color="#1687b2" />
                      <Text style={styles.addAreaText}>식단표 등록</Text>
                    </>
                  )}
                </Pressable>
              )}
              <Text style={styles.metaText}>주차당 식단표 1개를 등록할 수 있습니다.</Text>
            </View>

            {/* 일별 식판 사진 소제목과 등록 일수 */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>일별 식판 사진</Text>
              <Badge
                label={`${plateCount} / 7일 등록`}
                bg={progressBadge(plateCount, 7).bg}
                fg={progressBadge(plateCount, 7).fg}
                large
              />
            </View>

            {/* 요일별 식판 사진 카드 (2열, 탭 시 식판 사진 등록 화면) */}
            <View style={styles.dayGrid}>
              {selectedWeek.dates.map((date) => {
                const platePath = rowsByDate[date]?.plate_file_path
                // 오늘까지 지난 날짜인데 사진이 없으면 주황(등록 필요), 앞으로 올 날짜는 회색(예정)
                const dayBadge = platePath
                  ? { label: '완료', ...tone.green }
                  : date <= today
                    ? { label: '등록 필요', ...tone.orange }
                    : { label: '예정', ...tone.gray }
                return (
                  // 요일 카드 (등록: 사진 썸네일, 미등록: 사진 추가 영역, 오늘은 파란 테두리)
                  <Pressable
                    key={date}
                    style={[styles.card, styles.dayCard, date === today && styles.cardActive]}
                    onPress={() => handleOpenDay(date)}
                  >
                    <View style={styles.dayHeader}>
                      <Text
                        style={[
                          styles.dayLabel,
                          weekdayOf(date) === '토' && styles.daySaturday,
                          (weekdayOf(date) === '일' || holidayDates.has(date)) && styles.daySunday,
                        ]}
                      >
                        {weekdayOf(date)} {formatMonthDay(date)}
                      </Text>
                      <Badge label={dayBadge.label} bg={dayBadge.bg} fg={dayBadge.fg} large />
                    </View>
                    {platePath ? (
                      <LoadingImage uri={toBranchFileUrl(platePath)} style={styles.dayThumb} />
                    ) : (
                      <View style={[styles.dayThumb, styles.addArea]}>
                        <MaterialCommunityIcons name="camera-plus-outline" size={16} color="#1687b2" />
                        <Text style={styles.addAreaText}>사진 추가</Text>
                      </View>
                    )}
                    <Text style={styles.dayLink}>{platePath ? '사진 보기 · 교체 ›' : '사진 등록하기 ›'}</Text>
                  </Pressable>
                )
              })}
            </View>

            {/* 등록 안내 박스 */}
            <View style={styles.hint}>
              <MaterialCommunityIcons name="information-outline" size={18} color="#1593c4" />
              <Text style={styles.hintText}>해당 날짜를 눌러 식판 사진을 등록하거나 교체하세요.</Text>
            </View>
          </ScrollView>
        </View>

        {/* 식단표 크게 보기 화면 (사진은 손가락 확대·이동, 엑셀·PDF는 미리보기, 오른쪽 위 닫기 버튼) */}
        <Modal visible={Boolean(menuViewerUri)} animationType="fade" onRequestClose={() => setMenuViewerUri('')}>
          <SafeAreaView style={styles.menuViewer} edges={['top', 'bottom']}>
            <View style={styles.menuViewerHeader}>
              <Pressable hitSlop={8} style={styles.menuViewerClose} onPress={() => setMenuViewerUri('')}>
                <MaterialCommunityIcons name="close" size={24} color="#ffffff" />
              </Pressable>
            </View>
            {isImagePath(menuViewerUri) ? <ZoomableImage uri={menuViewerUri} /> : <MenuDocumentViewer uri={menuViewerUri} />}
          </SafeAreaView>
        </Modal>
        {savingOverlay}
      </SafeAreaView>
    )
  }

  // 주차 목록 화면
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <View style={[styles.frame, isTablet && styles.frameTablet]}>
        {/* 부제목은 지점(거래처)명, 본사 계정만 오른쪽 거래처 변경 버튼 */}
        <TitleBar
          title="지점 업로드"
          subtitle={accountName}
          onBack={handleBack}
          right={
            isHeadOffice ? (
              <Pressable hitSlop={6} style={styles.changeButton} onPress={() => setStep('picker')}>
                <Text style={styles.changeButtonText} numberOfLines={1}>
                  거래처 변경
                </Text>
              </Pressable>
            ) : null
          }
        />

        {/* 월 선택과 이번 달 등록 진행률 요약 띠 (위생 점검 전체 점검 현황과 같은 구성) */}
        <View style={styles.summary}>
          {/* 연·월 선택 창 (선택하면 해당 연·월 주차 목록 다시 조회) */}
          <Modal visible={periodPicker !== null} transparent animationType="fade" onRequestClose={() => setPeriodPicker(null)}>
            <Pressable style={styles.periodBackdrop} onPress={() => setPeriodPicker(null)}>
              <View style={styles.periodSheet}>
                <Text style={styles.periodTitle}>{periodPicker === 'year' ? '연도 선택' : '월 선택'}</Text>
                <View style={styles.periodOptions}>
                  {(periodPicker === 'year'
                    ? [0, 1, 2].map((offset) => Number(today.slice(0, 4)) - offset)
                    : Array.from({ length: 12 }, (_, index) => index + 1)
                  ).map((value) => {
                    const isActive = value === (periodPicker === 'year' ? viewYear : viewMonth)
                    return (
                      // 연·월 선택 항목 (현재 조회 값은 파란 배경)
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
          {/* 진행률 제목·퍼센트(왼쪽)와 식단표·사진 등록 개수 배지(오른쪽, 좁으면 다음 줄) */}
          <View style={[styles.summaryRow, styles.summaryRowWrap]}>
            <Text style={styles.summaryTitle}>
              월 등록 현황 <Text style={styles.summaryPercent}>{monthSummary.percent}%</Text>
            </Text>
            <View style={styles.summaryBadges}>
              <Badge label={`식단표 ${monthSummary.menuWeeks}/${weeks.length}주`} {...tone.green} large />
              <Badge label={`사진 ${monthSummary.plateDays}/${weeks.length * 7}일`} {...tone.blue} large />
            </View>
          </View>
          <ProgressBar percent={monthSummary.percent} />
        </View>

        <ScrollView contentContainerStyle={styles.bodyContent}>
          {/* 주차 소제목·주차 수(왼쪽)와 조회 연·월 선택 버튼(오른쪽), 위생 점검 점검 항목 줄과 같은 배치 */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              주차 <Text style={styles.sectionCount}>{weeks.length}개</Text>
            </Text>
            <View style={styles.periodActions}>
              <Pressable style={styles.periodButton} onPress={() => setPeriodPicker('year')}>
                <Text style={styles.periodButtonText}>{viewYear}년 ▾</Text>
              </Pressable>
              <Pressable style={styles.periodButton} onPress={() => setPeriodPicker('month')}>
                <Text style={styles.periodButtonText}>{viewMonth}월 ▾</Text>
              </Pressable>
            </View>
          </View>

          {/* 주차 카드 목록 (식단표 등록 여부·식판 사진 등록 일수, 탭 시 주차 상세) */}
          {weeks.map((week) => {
              const { menuRow, plateCount, done } = weekStatus(week)
              const isCurrent = today >= week.start && today <= week.end
              const weekBadge = progressBadge(done, 8)
              return (
                // 주차 카드 (현재 주차는 파란 테두리, 상태 배지·진행 막대·식단표/사진 등록 배지)
                <Pressable
                  key={week.start}
                  style={({ pressed }) => [styles.card, isCurrent && styles.cardActive, pressed && styles.cardPressed]}
                  onPress={() => handleOpenWeek(week)}
                >
                  <View style={styles.weekTop}>
                    <View style={styles.weekTitleBox}>
                      <Text style={styles.weekTitle}>
                        {viewMonth}월 {week.no}주차
                      </Text>
                      <Text style={styles.metaText}>{formatWeekRange(week)}</Text>
                    </View>
                    <View style={styles.summaryBadges}>
                      {isCurrent ? <Badge label="현재 주차" {...tone.blue} large /> : null}
                      <Badge label={weekBadge.label} bg={weekBadge.bg} fg={weekBadge.fg} large />
                    </View>
                  </View>
                  <ProgressBar percent={Math.round((done / 8) * 100)} />
                  <View style={styles.weekBottom}>
                    <View style={styles.weekBadges}>
                      <Badge label={menuRow ? '식단표 등록' : '식단표 미등록'} {...(menuRow ? tone.green : tone.gray)} large />
                      <Badge label={`식판 사진 ${plateCount} / 7일`} {...(plateCount > 0 ? tone.blue : tone.gray)} large />
                    </View>
                    <Text style={styles.weekLink}>상세 ›</Text>
                  </View>
                </Pressable>
              )
            })}
        </ScrollView>
      </View>
    </SafeAreaView>
  )
}

// 지점 업로드 화면 스타일
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
  titleBar: {
    height: 70,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
  },
  // 제목 바 좌우 칸 (같은 폭으로 나눠 제목 가운데 정렬)
  titleSide: {
    flex: 1,
    alignItems: 'flex-start',
  },
  titleSideRight: {
    alignItems: 'flex-end',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f4f7',
  },
  titleText: {
    flex: 1.4,
    alignItems: 'center',
  },
  title: {
    color: '#172431',
    fontSize: 20,
    fontFamily: font.bold,
  },
  subtitle: {
    color: '#7a8998',
    fontSize: 14,
    fontFamily: font.regular,
  },
  bodyContent: {
    padding: 18,
    gap: 12,
  },
  listContent: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    gap: 8,
  },
  card: {
    padding: 15,
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dde5eb',
    backgroundColor: '#ffffff',
  },
  cardActive: {
    borderColor: '#1593c4',
    borderWidth: 2,
  },
  // 등록이 필요한 카드 주황 테두리 (위생 점검 조치 필요 카드와 같은 색)
  cardNeedAction: {
    borderWidth: 2,
    borderColor: '#f0a35c',
  },
  cardPressed: {
    backgroundColor: '#f1f8fb',
  },
  // 화면 제목 아래 흰색 요약 띠 (월 선택·진행률)
  summary: {
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 14,
    gap: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e6ecf0',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  summaryRowWrap: {
    flexWrap: 'wrap',
  },
  summaryAccount: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  summaryAccountText: {
    flex: 1,
    color: '#263442',
    fontSize: 17,
    fontFamily: font.semibold,
  },
  summaryTitle: {
    color: '#263442',
    fontSize: 18,
    fontFamily: font.bold,
  },
  summaryPercent: {
    color: '#1593c4',
    fontSize: 18,
    fontFamily: font.bold,
  },
  summaryBadges: {
    flexDirection: 'row',
    gap: 6,
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
  changeButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#9cc9db',
    backgroundColor: '#f1f8fb',
  },
  changeButtonText: {
    color: '#1687b2',
    fontSize: 14,
    fontFamily: font.medium,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#eaf5fa',
  },
  hintText: {
    flex: 1,
    color: '#4e7182',
    fontSize: 14,
    fontFamily: font.regular,
  },
  // 거래처 선택 화면 (위생 점검 거래처 선택 화면과 같은 스타일)
  searchBar: {
    paddingHorizontal: 18,
    paddingBottom: 10,
    backgroundColor: '#ffffff',
  },
  searchInput: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cfd8e0',
    backgroundColor: '#ffffff',
    color: '#344252',
    fontSize: 18,
    fontFamily: font.regular,
  },
  emptyText: {
    color: '#728190',
    fontSize: 16,
    fontFamily: font.regular,
    textAlign: 'center',
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
    fontSize: 18,
    fontFamily: font.medium,
  },
  accountRowArrow: {
    color: '#1687b2',
    fontSize: 18,
    fontFamily: font.medium,
  },
  // 거래처 선택 화면 하단 버튼 바 (취소 또는 로그아웃·메인으로)
  bottomBar: {
    height: 72,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
  },
  secondaryButton: {
    flex: 1,
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
    fontSize: 18,
    fontFamily: font.medium,
  },
  // 연·월 선택 버튼 묶음 (제목 줄 오른쪽)
  periodActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // 연·월 선택 버튼 (위생 점검 editButton과 같은 스타일)
  periodButton: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e6ecf0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  periodButtonText: {
    color: '#273542',
    fontSize: 16,
    fontFamily: font.medium,
  },
  sectionCount: {
    color: '#7a8998',
    fontSize: 16,
    fontFamily: font.medium,
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
    fontSize: 20,
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
    height: 50,
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
    fontSize: 18,
    fontFamily: font.medium,
  },
  periodOptionTextActive: {
    color: '#ffffff',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: '#273542',
    fontSize: 19,
    fontFamily: font.bold,
  },
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#f3f6f8',
  },
  loadingText: {
    color: '#7a8998',
    fontSize: 16,
    fontFamily: font.medium,
  },
  // 식단표 사진 크게 보기 화면 (검은 배경)
  menuViewer: {
    flex: 1,
    backgroundColor: '#000000',
  },
  menuViewerHeader: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  menuViewerClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  savingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(243, 246, 248, 0.85)',
  },
  weekTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  weekTitleBox: {
    flex: 1,
  },
  weekBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekLink: {
    color: '#1687b2',
    fontSize: 15,
    fontFamily: font.medium,
  },
  weekTitle: {
    color: '#273542',
    fontSize: 18,
    fontFamily: font.bold,
    marginBottom: 2,
  },
  weekBadges: {
    flexDirection: 'row',
    gap: 6,
  },
  metaText: {
    color: '#7a8998',
    fontSize: 14,
    fontFamily: font.regular,
  },
  menuFile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e3e9ee',
  },
  menuThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#eef1f4',
  },
  menuIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e8f5ec',
  },
  menuInfo: {
    flex: 1,
    gap: 4,
  },
  menuTitle: {
    color: '#273542',
    fontSize: 16,
    fontFamily: font.semibold,
  },
  smallButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#9cc9db',
    backgroundColor: '#f1f8fb',
  },
  smallButtonText: {
    color: '#1687b2',
    fontSize: 15,
    fontFamily: font.medium,
  },
  // 삭제 버튼 (빨간 테두리 알약 모양)
  deleteButton: {
    borderColor: '#f1b5b5',
    backgroundColor: '#fff5f5',
  },
  deleteButtonText: {
    color: '#d93838',
  },
  // 식판 사진 등록 화면 하단 삭제 버튼
  deleteWideButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 52,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#f1b5b5',
    backgroundColor: '#fff5f5',
  },
  deleteWideButtonText: {
    color: '#d93838',
    fontSize: 17,
    fontFamily: font.bold,
  },
  addArea: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 56,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#9cc9db',
    backgroundColor: '#f1f8fb',
  },
  addAreaText: {
    color: '#1687b2',
    fontSize: 15,
    fontFamily: font.medium,
  },
  dayGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  dayCard: {
    width: '48.5%',
    padding: 12,
    gap: 8,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayLabel: {
    color: '#273542',
    fontSize: 15,
    fontFamily: font.bold,
  },
  // 토요일 파랑, 일요일·공휴일 빨강 (ERP 달력 표기, 공휴일이 토요일이면 빨강 우선)
  daySaturday: {
    color: '#1f6fd1',
  },
  daySunday: {
    color: '#d93838',
  },
  dayThumb: {
    width: '100%',
    height: 64,
    borderRadius: 8,
    backgroundColor: '#eef1f4',
  },
  dayLink: {
    color: '#1687b2',
    fontSize: 14,
    fontFamily: font.medium,
    textAlign: 'center',
  },
  targetDate: {
    color: '#172431',
    fontSize: 20,
    fontFamily: font.bold,
  },
  previewCard: {
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: 12,
    backgroundColor: '#eef1f4',
  },
  // 사진 칸 (모서리 밖으로 사진이 넘치지 않게 자름)
  imageBox: {
    overflow: 'hidden',
  },
  // 사진 위 가운데 로딩 스피너 영역
  imageLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
  pickButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 18,
  },
  pickButtonText: {
    color: '#273542',
    fontSize: 17,
    fontFamily: font.semibold,
  },
})
