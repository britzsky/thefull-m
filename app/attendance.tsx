import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, useFocusEffect } from 'expo-router'
import * as Location from 'expo-location'
import * as Application from 'expo-application'

import KakaoCommuteMap from '@/components/KakaoCommuteMap'

import {
  type AppVersionInfo,
  type AttendanceAccount,
  type AttendanceTarget,
  type CommuteAction,
  type CommuteIdentity,
  type DeviceInfo,
  type TodayStatus,
  agreePrivacyConsent,
  fetchAccountCoordinate,
  fetchAppVersionInfo,
  fetchAttendanceAccounts,
  fetchDeviceInfo,
  fetchPrivacyConsentStatus,
  fetchTodayStatus,
  getLocalDateAndTime,
  submitCommute,
} from '@/lib/attendance/api'
import { takePrefetchedLocation } from '@/lib/attendance/locationPrefetch'
import {
  getCommuteDeviceName,
  getOrCreateCommuteDeviceToken,
} from '@/lib/attendance/storage'
import { getAppSession } from '@/lib/auth/storage'
import { font } from '@/lib/fonts'

// 위치 권한 상태 타입
type PermissionState = 'idle' | 'loading' | 'granted' | 'denied'

// 현재 위치 스냅샷 타입
type LocationSnapshot = {
  latitude: number
  longitude: number
  accuracy: number | null
  mocked: boolean
  timestamp: number
}

// 근무지에 반경(radiusM)이 따로 지정돼 있지 않을 때 쓰는 기본 출퇴근 허용 반경(미터)
const DEFAULT_GEOFENCE_M = 100
// 본사 계정 아이디
const HEAD_OFFICE_ACCOUNT_ID = 'HQ'
// 본사 좌표(계정 목록에 좌표가 없을 때 사용하는 고정값)
const HEAD_OFFICE_TARGET: AttendanceTarget = {
  xCoordinate: 126.9729874683217,
  yCoordinate: 37.27480304451022,
  radiusM: DEFAULT_GEOFENCE_M,
}

// 두 좌표 사이 거리 계산(하버사인 공식)
function getDistanceInMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
) {
  const toRadians = (value: number) => (value * Math.PI) / 180
  const earthRadius = 6371000
  const latitudeDelta = toRadians(latitudeB - latitudeA)
  const longitudeDelta = toRadians(longitudeB - longitudeA)
  const haversine =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(toRadians(latitudeA)) *
      Math.cos(toRadians(latitudeB)) *
      Math.sin(longitudeDelta / 2) *
      Math.sin(longitudeDelta / 2)
  const angle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))

  return earthRadius * angle
}

// 시:분 형식 시간 문자열 변환
function formatTime(time: string | null | undefined) {
  return time ? String(time).slice(0, 5) : '--:--'
}

// 거리 값을 m/km 단위 문자열로 변환
function formatDistance(distance: number | null) {
  if (distance === null) return '확인 전'
  if (distance < 1000) return `${Math.round(distance)}m`
  return `${(distance / 1000).toFixed(1)}km`
}

// 오늘 날짜를 "연/월/일/요일" 문자열로 변환
function formatToday() {
  const now = new Date()
  const weekdays = ['일', '월', '화', '수', '목', '금', '토']

  return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일 ${weekdays[now.getDay()]}요일`
}

// 앱 버전이 요구 버전보다 낮은지 비교 (점으로 나눈 숫자 단위, 자리 수가 다르면 빈 자리는 0: 1.1 = 1.1.0)
function isVersionLower(current: string, required: string) {
  const toParts = (version: string) => version.split('.').map((part) => parseInt(part, 10) || 0)
  const a = toParts(current)
  const b = toParts(required)

  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0)
    if (diff !== 0) return diff < 0
  }

  return false
}

// 출퇴근 액션 한글 라벨 변환
function getActionLabel(action: CommuteAction) {
  return action === 'clockIn' ? '출근' : '퇴근'
}

export default function AttendanceScreen() {
  const { width } = useWindowDimensions()
  const isCompact = width < 390
  const isTablet = width >= 768
  // 지도 카드로 자동 스크롤하기 위한 참조
  const scrollViewRef = useRef<ScrollView>(null)
  const mapCardYRef = useRef(0)
  // 강조 테두리를 반짝이게 하는 애니메이션 값
  const attentionPulse = useRef(new Animated.Value(0)).current

  // 로그인 정보로 정해진 근무지
  const [selectedAccount, setSelectedAccount] = useState<AttendanceAccount | null>(null)
  // 로그인 정보로 만든 출퇴근 본인 정보 및 기기/오늘 출퇴근 상태
  const [confirmedIdentity, setConfirmedIdentity] = useState<CommuteIdentity | null>(null)
  const [deviceToken, setDeviceToken] = useState('')
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const [todayStatus, setTodayStatus] = useState<TodayStatus | null>(null)
  // 오늘 출퇴근 상태를 조회한 기준 날짜 (폰 날짜가 바뀌면 다시 조회)
  const [statusDate, setStatusDate] = useState('')
  // 근무지 반경 밖이라 지도 카드로 스크롤했음을 나타내는 강조 표시 여부
  const [mapAttentionNeeded, setMapAttentionNeeded] = useState(false)
  // 근무지 좌표, 현재 위치, 거리 상태
  const [attendanceTarget, setAttendanceTarget] = useState<AttendanceTarget | null>(null)
  const [currentLocation, setCurrentLocation] = useState<LocationSnapshot | null>(null)
  const [distanceFromOffice, setDistanceFromOffice] = useState<number | null>(null)
  // 위치 권한 상태와 안내 문구
  const [permissionState, setPermissionState] = useState<PermissionState>('idle')
  const [permissionMessage, setPermissionMessage] = useState('근무지 위치를 확인하고 있습니다.')
  const [canAskAgain, setCanAskAgain] = useState(true)
  // 화면/요청별 로딩 상태
  const [isScreenLoading, setIsScreenLoading] = useState(true)
  const [isSubmittingAttendance, setIsSubmittingAttendance] = useState(false)
  // 출퇴근 저장 진행 중 여부 (버튼 비활성화가 반영되기 전 연속 터치 방지)
  const submittingAttendanceRef = useRef(false)

  // 서버가 내려준 강제 업데이트 요구 버전 정보(없거나 현재 버전과 같으면 통과)
  const [appVersionInfo, setAppVersionInfo] = useState<AppVersionInfo | null>(null)

  // 위치/거리/권한 상태 갱신
  const updateLocationState = useCallback(
    (location: LocationSnapshot, target: AttendanceTarget) => {
      const distance = getDistanceInMeters(
        target.yCoordinate,
        target.xCoordinate,
        location.latitude,
        location.longitude
      )

      const radiusM = target.radiusM ?? DEFAULT_GEOFENCE_M

      setCurrentLocation(location)
      setDistanceFromOffice(distance)
      setPermissionState('granted')
      setPermissionMessage(
        distance <= radiusM
          ? '근무지 범위 안에 있습니다. 출퇴근할 수 있습니다.'
          : `근무지에서 ${radiusM}m 이내로 이동해야 출퇴근할 수 있습니다.`
      )

      return distance
    },
    []
  )

  // 위치 권한 확인 후 기기의 현재 위치를 새로 조회(거리 계산은 하지 않음)
  // usePrefetched: 화면 진입 시에만 메인 화면에서 미리 받아 둔 GPS 위치를 우선 사용
  const fetchDevicePosition = useCallback(async (loadingMessage: string, usePrefetched = false) => {
    setPermissionState('loading')
    setPermissionMessage(loadingMessage)

    // 위치 서비스 활성화 여부 확인
    const serviceEnabled = await Location.hasServicesEnabledAsync()
    if (!serviceEnabled) {
      setCanAskAgain(true)
      throw new Error('기기의 위치 서비스를 켠 뒤 다시 시도해 주세요.')
    }

    // 위치 권한 확인 및 요청
    const existingPermission = await Location.getForegroundPermissionsAsync()
    const permission =
      existingPermission.status === 'granted'
        ? existingPermission
        : await Location.requestForegroundPermissionsAsync()

    setCanAskAgain(permission.canAskAgain)

    if (permission.status !== 'granted') {
      throw new Error(
        permission.canAskAgain
          ? '출퇴근 기록을 위해 위치 권한을 허용해 주세요.'
          : '위치 권한이 차단되어 있습니다. 기기 설정에서 권한을 허용해 주세요.'
      )
    }

    if (Platform.OS === 'android' && permission.android?.accuracy !== 'fine') {
      setCanAskAgain(false)
      throw new Error('100m 거리 확인을 위해 기기 설정에서 정확한 위치를 허용해 주세요.')
    }

    // 고정밀 현재 위치 조회 (미리 받아 둔 30초 이내 위치가 있으면 그대로 사용)
    const prefetchedPosition = usePrefetched ? await takePrefetchedLocation() : null
    const position =
      prefetchedPosition ??
      (await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        mayShowUserSettingsDialog: true,
      }))
    const location: LocationSnapshot = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: typeof position.coords.accuracy === 'number' ? position.coords.accuracy : null,
      mocked: position.mocked === true,
      timestamp: position.timestamp,
    }

    return location
  }, [])

  // 위치 권한 확인 후 현재 위치를 새로 조회하고 근무지까지 거리를 계산
  const getFreshLocation = useCallback(
    async (target: AttendanceTarget) => {
      const location = await fetchDevicePosition('현재 위치를 확인하고 있습니다.')
      const distance = updateLocationState(location, target)

      return { location, distance }
    },
    [fetchDevicePosition, updateLocationState]
  )

  // 최근(30초 이내) 위치가 있으면 재사용하고, 없거나 오래됐으면 새로 조회합니다.
  // 화면 진입 시 백그라운드로 미리 받아 둔 위치를 근무지 선택/확인 단계에서 그대로 활용하기 위한 헬퍼입니다.
  const resolveLocation = useCallback(
    async (target: AttendanceTarget) => {
      const isFresh = currentLocation !== null && Date.now() - currentLocation.timestamp <= 30000
      if (isFresh) {
        const distance = updateLocationState(currentLocation!, target)
        return { location: currentLocation!, distance }
      }

      return getFreshLocation(target)
    },
    [currentLocation, updateLocationState, getFreshLocation]
  )

  // 선택한 근무지의 좌표 조회 후 현재 위치까지 확인
  // pendingLocation: 화면 진입 시 좌표 조회와 동시에 미리 시작해 둔 GPS 조회(있으면 그 결과로 거리 계산)
  const loadAccountTarget = useCallback(
    async (account: AttendanceAccount, pendingLocation?: Promise<LocationSnapshot>) => {
      setAttendanceTarget(null)
      setDistanceFromOffice(null)
      setPermissionState('loading')
      setPermissionMessage('근무지 기준 위치를 불러오고 있습니다.')

      try {
        // 본사는 고정 좌표, 그 외는 서버에서 좌표 조회
        const target =
          account.account_id === HEAD_OFFICE_ACCOUNT_ID
            ? HEAD_OFFICE_TARGET
            : await fetchAccountCoordinate(account.account_id)

        if (!target) throw new Error('선택한 근무지의 지도 좌표가 등록되어 있지 않습니다.')

        setAttendanceTarget(target)
        const radiusM = target.radiusM ?? DEFAULT_GEOFENCE_M

        try {
          const distance = pendingLocation
            ? updateLocationState(await pendingLocation, target)
            : (await resolveLocation(target)).distance
          return { distance, radiusM }
        } catch (error) {
          const message = error instanceof Error ? error.message : '현재 위치를 확인하지 못했습니다.'
          setPermissionState('denied')
          setPermissionMessage(message)
          return { distance: null, radiusM }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : '근무지 위치를 불러오지 못했습니다.'
        setPermissionState('denied')
        setPermissionMessage(message)
        return { distance: null, radiusM: DEFAULT_GEOFENCE_M }
      }
    },
    [resolveLocation, updateLocationState]
  )

  // 30초 캐시를 건너뛰고 현재 위치를 강제로 새로 조회합니다(수동 새로고침 버튼용).
  const refreshCurrentLocation = async () => {
    // 위치 권한이 차단되어 다시 요청할 수 없으면 기기 설정 화면으로 이동
    if (permissionState === 'denied' && !canAskAgain && Platform.OS !== 'web') {
      await Linking.openSettings()
      return
    }

    if (!attendanceTarget) return

    try {
      await getFreshLocation(attendanceTarget)
    } catch (error) {
      const message = error instanceof Error ? error.message : '현재 위치를 확인하지 못했습니다.'
      setPermissionState('denied')
      setPermissionMessage(message)
    }
  }

  // 기기 등록 상태와 오늘 출퇴근 상태를 서버에서 갱신
  const refreshIdentityStatus = useCallback(async (identity: CommuteIdentity) => {
    const date = getLocalDateAndTime().date
    const [nextDeviceInfo, nextTodayStatus] = await Promise.all([
      fetchDeviceInfo(identity),
      fetchTodayStatus(identity, date),
    ])

    const deviceInfoResult = nextDeviceInfo?.user_name ? nextDeviceInfo : null
    setDeviceInfo(deviceInfoResult)
    setTodayStatus(nextTodayStatus?.t_date ? nextTodayStatus : null)
    setStatusDate(date)

    return deviceInfoResult
  }, [])

  // 화면 진입 시 로그인 정보로 본인·근무지를 정하고, 오늘 출퇴근 상태와 근무지까지 거리를 확인
  // 조리사/조리원: 로그인 때 확인한 이름·뒷자리·근무지 + 기기 승인 상태 재확인
  // 본사/영양사: 로그인 계정의 이름·아이디, 근무지는 본사(HQ) 또는 영양사 소속 거래처, 기기 승인 불필요
  useFocusEffect(
    useCallback(() => {
      let active = true

      const initializeScreen = async () => {
        setIsScreenLoading(true)
        setMapAttentionNeeded(false)

        try {
          const session = await getAppSession()

          if (!session) {
            router.replace('/login')
            return
          }

          // 강제 업데이트 확인 (실패해도 출퇴근 화면은 계속 사용)
          void fetchAppVersionInfo()
            .then((info) => {
              if (active) setAppVersionInfo(info)
            })
            .catch(() => {})

          const staff = session.mode === 'staff' ? session.staff : null
          const staffAccountId =
            staff?.userType === '1' || staff?.userType === '2'
              ? HEAD_OFFICE_ACCOUNT_ID
              : staff?.userType === '3' && staff.accountId !== 'null'
                ? staff.accountId
                : ''

          if (staff && !staffAccountId) {
            Alert.alert('이용 불가', '출퇴근을 기록할 근무지가 연결되지 않은 계정입니다.')
            router.replace('/home')
            return
          }

          const identity: CommuteIdentity =
            session.mode === 'cook'
              ? {
                  accountId: session.cook.accountId,
                  userName: session.cook.userName,
                  phoneLast4: session.cook.phoneLast4,
                }
              : { accountId: staffAccountId, userName: staff!.userName, phoneLast4: '', userId: staff!.userId }

          // 조리사/조리원은 로그인 때 고른 거래처 이름, 본사는 '본사'를 쓰므로
          // 거래처명이 세션에 없는 영양사 소속 거래처일 때만 거래처 목록을 조회
          const needsAccountList =
            session.mode !== 'cook' && identity.accountId !== HEAD_OFFICE_ACCOUNT_ID

          const [accounts, nextDeviceToken] = await Promise.all([
            needsAccountList
              ? fetchAttendanceAccounts().catch(() => [] as AttendanceAccount[])
              : Promise.resolve([] as AttendanceAccount[]),
            getOrCreateCommuteDeviceToken(identity.phoneLast4),
          ])

          if (!active) return

          const account = accounts.find((item) => item.account_id === identity.accountId) ?? {
            account_id: identity.accountId,
            account_name:
              session.mode === 'cook'
                ? session.cook.accountName
                : identity.accountId === HEAD_OFFICE_ACCOUNT_ID
                  ? '본사'
                  : identity.accountId,
          }

          setSelectedAccount(account)
          setConfirmedIdentity(identity)
          setDeviceToken(nextDeviceToken)
          setTodayStatus(null)
          setDeviceInfo(null)

          // 본사/영양사 개인정보 수집 동의 (처음 한 번, 조리사/조리원은 로그인 때 동의)
          if (staff) {
            const consentStatus = await fetchPrivacyConsentStatus(identity).catch(() => null)

            if (String(consentStatus?.agree_yn ?? 'N').toUpperCase() !== 'Y') {
              const agreed = await new Promise<boolean>((resolve) => {
                Alert.alert(
                  '개인정보 수집 동의',
                  '출퇴근 관리를 위해 이름, 출퇴근 위치정보(GPS), 기기 식별자를 수집합니다.\n보유 기간: 3년\n\n동의하지 않으면 앱으로 출퇴근을 기록할 수 없습니다.',
                  [
                    { text: '취소', style: 'cancel', onPress: () => resolve(false) },
                    { text: '동의', onPress: () => resolve(true) },
                  ],
                  { cancelable: false }
                )
              })

              if (!agreed) {
                router.replace('/home')
                return
              }
              void agreePrivacyConsent(identity, nextDeviceToken, getCommuteDeviceName()).catch(() => {})
            }
          }

          if (!active) return

          // GPS 조회는 서버 응답과 무관하므로 근무지 좌표 조회와 동시에 시작
          // (좌표 조회가 먼저 실패해도 처리되지 않은 오류 경고가 나지 않도록 catch를 붙여 둠)
          const pendingLocation = fetchDevicePosition('현재 위치를 확인하고 있습니다.', true)
          pendingLocation.catch(() => {})

          // 오늘 출퇴근 상태·기기 승인 상태 조회와 근무지 좌표·현재 위치 확인
          const [, { distance, radiusM }] = await Promise.all([
            refreshIdentityStatus(identity).catch(() => null),
            loadAccountTarget(account, pendingLocation),
          ])

          // 근무지 반경 밖이면 지도 카드로 스크롤해서 강조
          if (active && distance !== null && distance > radiusM) {
            setMapAttentionNeeded(true)
            requestAnimationFrame(() => {
              scrollViewRef.current?.scrollTo({ y: mapCardYRef.current, animated: true })
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '출퇴근 화면을 준비하지 못했습니다.'
          setPermissionState('denied')
          setPermissionMessage(message)
        } finally {
          if (active) {
            setIsScreenLoading(false)
          }
        }
      }

      void initializeScreen()

      return () => {
        active = false
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  )

  // 화면을 켜둔 채 자정이 지나거나 앱으로 돌아왔을 때 날짜가 바뀌었으면 오늘 상태를 다시 조회
  useEffect(() => {
    if (!confirmedIdentity || !statusDate) return

    const checkDateChange = () => {
      if (getLocalDateAndTime().date !== statusDate) {
        refreshIdentityStatus(confirmedIdentity).catch(() => null)
      }
    }
    const timer = setInterval(checkDateChange, 30000)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkDateChange()
    })

    return () => {
      clearInterval(timer)
      subscription.remove()
    }
  }, [confirmedIdentity, statusDate, refreshIdentityStatus])

  // 메인으로 버튼 처리 (로그인 유지, 업무 선택 화면으로 이동)
  const handleGoMain = () => {
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/home')
    }
  }

  // 현재 기기의 ERP 승인 상태 판정 (조리사/조리원만 해당)
  const isApproved = String(deviceInfo?.approve_yn ?? 'N').toUpperCase() === 'Y'
  const isCurrentDeviceApproved =
    isApproved && !!deviceToken && deviceInfo?.device_token === deviceToken
  // 본사/영양사 계정 로그인 여부 (기기 승인 없이 출퇴근 가능)
  const isAccountLogin = !!confirmedIdentity?.userId
  // 출퇴근 기록 가능한 본인 확인 상태 (계정 로그인 또는 승인된 기기)
  const canCommute = !!confirmedIdentity && (isAccountLogin || isCurrentDeviceApproved)

  // 지도 카드 강조 표시가 켜져 있는 동안 테두리를 반복해서 반짝입니다.
  useEffect(() => {
    if (!mapAttentionNeeded) {
      attentionPulse.setValue(0)
      return
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(attentionPulse, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(attentionPulse, { toValue: 0, duration: 900, useNativeDriver: false }),
      ])
    )
    loop.start()

    return () => loop.stop()
  }, [mapAttentionNeeded, attentionPulse])

  // 현재 설치된 앱 버전이 서버가 내려준 요구 버전보다 낮을 때만 강제 업데이트 대상으로 판단
  // (심사 중인 새 버전은 서버 값이 이전 버전이어도 통과)
  const currentAppVersion = Application.nativeApplicationVersion ?? ''
  const requiredAppVersion = String(appVersionInfo?.version ?? '').trim()
  const updateRequired = !!requiredAppVersion && isVersionLower(currentAppVersion, requiredAppVersion)

  // 오늘 출퇴근 완료 여부와 다음 진행할 액션 판정
  const checkedIn = !!todayStatus?.start_time
  const checkedOut = !!todayStatus?.end_time
  const nextAction: CommuteAction | null = !checkedIn
    ? 'clockIn'
    : !checkedOut
      ? 'clockOut'
      : null
  // 현재 선택된 근무지의 출퇴근 허용 반경(미터). 근무지별로 다르게 지정될 수 있어 기본값과 분리합니다.
  const geofenceRadiusM = attendanceTarget?.radiusM ?? DEFAULT_GEOFENCE_M
  // 지오펜스(반경) 이내 여부 판정
  const geofenceOk =
    permissionState === 'granted' &&
    distanceFromOffice !== null &&
    distanceFromOffice <= geofenceRadiusM

  // 근무지 반경 안으로 들어오면 지도 카드 강조 표시를 끕니다.
  useEffect(() => {
    if (geofenceOk) setMapAttentionNeeded(false)
  }, [geofenceOk])

  // 출근/퇴근 버튼 처리 (이미 저장 중이면 무시)
  const submitAttendance = async (action: CommuteAction) => {
    if (submittingAttendanceRef.current) {
      return
    }

    submittingAttendanceRef.current = true

    try {
      await saveAttendance(action)
    } finally {
      submittingAttendanceRef.current = false
    }
  }

  // 출근/퇴근 기록 저장 처리
  const saveAttendance = async (action: CommuteAction) => {
    if (!confirmedIdentity || !attendanceTarget || !deviceToken || !canCommute) {
      Alert.alert('출퇴근 불가', 'ERP에서 현재 기기의 등록 승인 상태를 확인해 주세요.')
      return
    }

    // 어제 불러온 상태로 오늘 출퇴근을 찍지 않도록 날짜가 바뀌었으면 다시 조회 후 중단
    if (statusDate !== getLocalDateAndTime().date) {
      await refreshIdentityStatus(confirmedIdentity)
      Alert.alert('날짜 변경', '날짜가 바뀌어 오늘 출퇴근 상태를 다시 불러왔습니다.\n다시 눌러 주세요.')
      return
    }

    if (action !== nextAction) {
      Alert.alert('처리 순서 확인', '오늘의 출퇴근 진행 상태를 다시 확인해 주세요.')
      await refreshIdentityStatus(confirmedIdentity)
      return
    }

    try {
      setIsSubmittingAttendance(true)
      // 30초 이내 최근 위치가 있으면 재사용, 없으면 새로 조회
      const hasRecentLocation =
        currentLocation !== null && Date.now() - currentLocation.timestamp <= 30000
      const { location, distance } = hasRecentLocation
        ? {
            location: currentLocation!,
            distance: updateLocationState(currentLocation!, attendanceTarget),
          }
        : await getFreshLocation(attendanceTarget)

      if (distance > geofenceRadiusM) {
        throw new Error(`근무지에서 ${geofenceRadiusM}m 이내에 있을 때만 출퇴근할 수 있습니다.`)
      }

      const response = await submitCommute(
        confirmedIdentity,
        action,
        location,
        distance,
        deviceToken,
        getCommuteDeviceName()
      )

      if (String(response.code ?? '200') !== '200') {
        throw new Error(response.msg || `${getActionLabel(action)} 저장에 실패했습니다.`)
      }

      await refreshIdentityStatus(confirmedIdentity)
      Alert.alert(
        '저장 완료',
        `${getActionLabel(action)} 정보가 저장되었습니다. (근무지까지 약 ${Math.round(distance)}m)`
      )
      setPermissionMessage(response.msg || `${getActionLabel(action)} 정보가 저장되었습니다.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '출퇴근 저장 중 오류가 발생했습니다.'
      setPermissionMessage(message)
      Alert.alert('저장 실패', message)
    } finally {
      setIsSubmittingAttendance(false)
    }
  }

  // 출근/퇴근 버튼 활성화 조건
  const canClockIn = canCommute && geofenceOk && nextAction === 'clockIn' && !isSubmittingAttendance
  const canClockOut = canCommute && geofenceOk && nextAction === 'clockOut' && !isSubmittingAttendance
  // 근무지 반경을 벗어나 출퇴근이 불가능한 상태인지 여부(안내 문구 강조용)
  const isTooFarFromOffice =
    permissionState === 'granted' && distanceFromOffice !== null && distanceFromOffice > geofenceRadiusM

  // 강제 업데이트 대상이면 다른 화면 진입 전에 업데이트 안내만 보여줍니다.
  if (updateRequired) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.gateScreen}>
          <Text style={styles.gateTitle}>업데이트가 필요합니다</Text>
          <Text style={styles.gateBody}>
            새로운 버전이 있어야 출퇴근 기능을 계속 이용할 수 있습니다.{'\n'}
            스토어에서 최신 버전으로 업데이트해 주세요.
          </Text>
          {appVersionInfo?.update_url ? (
            <Pressable
              style={styles.gateButton}
              onPress={() => Linking.openURL(String(appVersionInfo.update_url))}
            >
              <Text style={styles.gateButtonText}>업데이트하러 가기</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        ref={scrollViewRef}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          isCompact && styles.contentCompact,
          isTablet && styles.contentTablet,
        ]}
      >
        {/* 앱 단독 출퇴근 화면 제목 영역 */}
        <View style={styles.brandHeader}>
          <Image source={require('../public/image/thefull_logo.png')} style={styles.logo} />
          <Text style={styles.brandTitle}>더채움 근태 관리</Text>
          {isScreenLoading ? <ActivityIndicator color="#6c5dd3" /> : null}
        </View>
        {/* 메인으로 버튼과 오늘 날짜 */}
        <View style={styles.subHeaderRow}>
          <Pressable hitSlop={8} style={styles.mainButton} onPress={handleGoMain}>
            <Text style={styles.mainButtonText}>메인으로</Text>
          </Pressable>
          <Text style={styles.todayText}>{formatToday()}</Text>
          <View style={styles.subHeaderSpacer} />
        </View>

        {/* 오늘 출퇴근 시각과 현재 진행 순서에 맞는 저장 버튼 영역 */}
        <View style={styles.commuteCard}>
          <View style={styles.titleRow}>
            <Text style={styles.sectionTitle}>오늘 출퇴근</Text>
            {confirmedIdentity ? (
              <Text style={styles.confirmedName}>
                {confirmedIdentity.userName}
                {selectedAccount ? ` · ${selectedAccount.account_name}` : ''}
              </Text>
            ) : null}
          </View>

          <View style={styles.timeRow}>
            <View style={[styles.timeBox, styles.clockInTimeBox]}>
              <Text style={styles.timeLabel}>출근</Text>
              <Text style={[styles.timeValue, styles.clockInText]}>{formatTime(todayStatus?.start_time)}</Text>
            </View>
            <View style={[styles.timeBox, styles.clockOutTimeBox]}>
              <Text style={styles.timeLabel}>퇴근</Text>
              <Text style={[styles.timeValue, styles.clockOutText]}>{formatTime(todayStatus?.end_time)}</Text>
            </View>
          </View>

          <View style={[styles.buttonRow, isTablet && styles.buttonRowTablet]}>
            <Pressable
              disabled={!canClockIn}
              style={[styles.actionButton, styles.clockInButton, !canClockIn && styles.buttonDisabled]}
              onPress={() => void submitAttendance('clockIn')}
            >
              <Text style={styles.actionButtonText}>
                {isSubmittingAttendance && nextAction === 'clockIn' ? '처리 중' : '출근'}
              </Text>
            </Pressable>
            <Pressable
              disabled={!canClockOut}
              style={[styles.actionButton, styles.clockOutButton, !canClockOut && styles.buttonDisabled]}
              onPress={() => void submitAttendance('clockOut')}
            >
              <Text style={styles.actionButtonText}>
                {isSubmittingAttendance && nextAction === 'clockOut' ? '처리 중' : '퇴근'}
              </Text>
            </Pressable>
          </View>

          {!confirmedIdentity ? (
            <Text style={styles.actionHint}>로그인 정보를 확인하고 있습니다.</Text>
          ) : !canCommute ? (
            <Text style={styles.actionHint}>ERP에서 현재 기기를 승인해야 출퇴근할 수 있습니다.</Text>
          ) : !geofenceOk ? (
            <Text style={styles.actionHint}>근무지에서 {geofenceRadiusM}m 이내인지 확인해 주세요.</Text>
          ) : nextAction === null ? (
            <Text style={styles.actionHint}>오늘 출근과 퇴근 기록이 모두 완료되었습니다.</Text>
          ) : (
            <Text style={styles.actionHint}>현재 {getActionLabel(nextAction)} 기록이 가능합니다.</Text>
          )}
        </View>

        {/* 근무지와 현재 위치를 함께 표시하는 지도 영역 */}
        <Animated.View
          style={[
            styles.mapCard,
            mapAttentionNeeded && {
              borderColor: attentionPulse.interpolate({
                inputRange: [0, 1],
                outputRange: ['#f0ad4e', '#e6342a'],
              }),
              borderWidth: 2,
            },
          ]}
          onLayout={(event) => {
            mapCardYRef.current = event.nativeEvent.layout.y
          }}
        >
          <View style={styles.map}>
            <KakaoCommuteMap
              target={attendanceTarget}
              currentLocation={currentLocation}
              accountName={selectedAccount?.account_name || ''}
              radius={geofenceRadiusM}
            />
          </View>

          {!attendanceTarget ? (
            <View style={styles.mapOverlay} pointerEvents="none">
              <Text style={styles.mapOverlayIcon}>⌖</Text>
              <Text style={styles.mapOverlayText}>근무지 위치를 불러오고 있습니다.</Text>
            </View>
          ) : null}

          <View style={styles.mapStatusRow}>
            <View style={styles.mapStatusTextGroup}>
              <Text style={styles.distanceLabel}>근무지까지 {formatDistance(distanceFromOffice)}</Text>
              <Text
                style={[
                  styles.permissionMessage,
                  geofenceOk && styles.permissionMessageOk,
                  isTooFarFromOffice && styles.permissionMessageAlert,
                ]}
              >
                {permissionMessage}
              </Text>
            </View>
            {permissionState === 'loading' ? (
              <ActivityIndicator color="#6c5dd3" />
            ) : (
              <Pressable
                hitSlop={10}
                disabled={!attendanceTarget}
                style={[styles.locationRefreshButton, !attendanceTarget && styles.buttonDisabled]}
                onPress={() => void refreshCurrentLocation()}
                >
                {/* 새로고침 버튼 안에 화살표 */}
                <MaterialCommunityIcons name="refresh" size={24} color="#6c5dd3" />
              </Pressable>
            )}
          </View>
        </Animated.View>

      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f0f2f5' },
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 40, gap: 14 },
  contentCompact: { paddingHorizontal: 14 },
  contentTablet: { alignSelf: 'center', width: '100%', maxWidth: 720, paddingTop: 24 },
  brandHeader: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    paddingHorizontal: 18,
  },
  logo: { width: 42, height: 30, resizeMode: 'contain' },
  brandTitle: { color: '#4b5563', fontSize: 17, fontFamily: font.bold },
  todayText: { color: '#747b86', fontSize: 16, fontFamily: font.bold, textAlign: 'center' },
  subHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subHeaderSpacer: { width: 72 },
  mainButton: {
    width: 72,
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d9dce2',
    backgroundColor: '#ffffff',
    paddingVertical: 7,
  },
  mainButtonText: { color: '#4b5563', fontSize: 14, fontFamily: font.bold },
  card: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 12,
  },
  commuteCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 16,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionTitle: { color: '#27303f', fontSize: 18, fontFamily: font.bold },
  mapCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  map: { width: '100%', height: 240 },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    bottom: 82,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.76)',
  },
  mapOverlayIcon: { color: '#a9afb8', fontSize: 34, fontFamily: font.bold },
  mapOverlayText: { marginTop: 6, color: '#747b86', fontSize: 16, fontFamily: font.bold },
  mapStatusRow: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  mapStatusTextGroup: { flex: 1, gap: 4 },
  distanceLabel: { color: '#27303f', fontSize: 16, fontFamily: font.bold },
  permissionMessage: { color: '#e5566b', fontSize: 14, fontFamily: font.regular, lineHeight: 20 },
  permissionMessageOk: { color: '#1fa45c' },
  permissionMessageAlert: { color: '#e5566b', fontSize: 16, fontFamily: font.bold },
  helperText: { color: '#747b86', fontSize: 14, fontFamily: font.regular, lineHeight: 20 },
  // 새로고침 버튼 동그라미
  locationRefreshButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#eef0ff',
  },
  confirmedName: { flexShrink: 1, color: '#6c5dd3', fontSize: 16, fontFamily: font.bold, textAlign: 'right' },
  timeRow: { flexDirection: 'row', gap: 12 },
  timeBox: {
    flex: 1,
    minHeight: 86,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    gap: 5,
  },
  clockInTimeBox: { backgroundColor: '#e8f8ef' },
  clockOutTimeBox: { backgroundColor: '#fdebee' },
  timeLabel: { color: '#747b86', fontSize: 14, fontFamily: font.bold },
  timeValue: { fontSize: 23, fontFamily: font.bold },
  clockInText: { color: '#1fa45c' },
  clockOutText: { color: '#e5566b' },
  buttonRow: { flexDirection: 'row', gap: 12 },
  buttonRowTablet: { flexDirection: 'row' },
  actionButton: {
    flex: 1,
    minHeight: 58,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  clockInButton: { backgroundColor: '#1fa45c' },
  clockOutButton: { backgroundColor: '#e5566b' },
  actionButtonText: { color: '#ffffff', fontSize: 16, fontFamily: font.bold },
  actionHint: { color: '#747b86', fontSize: 14, fontFamily: font.regular, lineHeight: 20, textAlign: 'center' },
  buttonDisabled: { opacity: 0.42 },
  // 강제 업데이트/개인정보 동의 화면 공통 레이아웃
  gateScreen: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 18 },
  gateTitle: { color: '#27303f', fontSize: 20, fontFamily: font.bold, textAlign: 'center' },
  gateBody: { color: '#4b5563', fontSize: 16, fontFamily: font.regular, lineHeight: 24, textAlign: 'left' },
  gateButton: {
    minHeight: 52,
    minWidth: 220,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    paddingHorizontal: 24,
    backgroundColor: '#6c5dd3',
  },
  gateButtonText: { color: '#ffffff', fontSize: 15, fontFamily: font.bold },
})
