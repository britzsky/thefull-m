import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Keyboard,
  Linking,
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
import { useFocusEffect } from 'expo-router'
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
  type PrivacyConsentStatus,
  type TodayStatus,
  agreePrivacyConsent,
  checkCommuteDeviceOwner,
  fetchAccountCoordinate,
  fetchAppVersionInfo,
  fetchAttendanceAccounts,
  fetchDeviceInfo,
  fetchPrivacyConsentStatus,
  fetchTodayStatus,
  requestCommuteDevice,
  submitCommute,
} from '@/lib/attendance/api'
import {
  getCommuteDeviceName,
  getOrCreateCommuteDeviceToken,
} from '@/lib/attendance/storage'

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

// 출퇴근 액션 한글 라벨 변환
function getActionLabel(action: CommuteAction) {
  return action === 'clockIn' ? '출근' : '퇴근'
}

// 강조 애니메이션 값을 style에 바로 적용하기 위한 Animated Pressable
const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

export default function AttendanceScreen() {
  const { width } = useWindowDimensions()
  const isCompact = width < 390
  const isTablet = width >= 768
  // 입력창 포커스 제어용 참조
  const nameInputRef = useRef<TextInput>(null)
  const phoneInputRef = useRef<TextInput>(null)
  const accountInputRef = useRef<TextInput>(null)
  // 기기 등록/지도 카드로 자동 스크롤하기 위한 참조
  const scrollViewRef = useRef<ScrollView>(null)
  const deviceCardYRef = useRef(0)
  const mapCardYRef = useRef(0)
  // 강조 테두리를 반짝이게 하는 애니메이션 값
  const attentionPulse = useRef(new Animated.Value(0)).current

  // 본인 확인 입력값(이름/휴대폰 뒷자리/근무지 검색어)
  const [name, setName] = useState('')
  const [phoneLast4, setPhoneLast4] = useState('')
  const [accountQuery, setAccountQuery] = useState('')
  // 근무지(거래처) 목록과 선택 상태
  const [accountList, setAccountList] = useState<AttendanceAccount[]>([])
  const [selectedAccount, setSelectedAccount] = useState<AttendanceAccount | null>(null)
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false)
  // 본인 확인 완료 여부 및 기기/오늘 출퇴근 상태
  const [confirmedIdentity, setConfirmedIdentity] = useState<CommuteIdentity | null>(null)
  const [deviceToken, setDeviceToken] = useState('')
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const [todayStatus, setTodayStatus] = useState<TodayStatus | null>(null)
  // 기기 등록이 필요해 해당 카드로 스크롤했음을 나타내는 강조 표시 여부
  const [deviceAttentionNeeded, setDeviceAttentionNeeded] = useState(false)
  // 근무지 반경 밖이라 지도 카드로 스크롤했음을 나타내는 강조 표시 여부
  const [mapAttentionNeeded, setMapAttentionNeeded] = useState(false)
  // 근무지 좌표, 현재 위치, 거리 상태
  const [attendanceTarget, setAttendanceTarget] = useState<AttendanceTarget | null>(null)
  const [currentLocation, setCurrentLocation] = useState<LocationSnapshot | null>(null)
  const [distanceFromOffice, setDistanceFromOffice] = useState<number | null>(null)
  // 위치 권한 상태와 안내 문구
  const [permissionState, setPermissionState] = useState<PermissionState>('idle')
  const [permissionMessage, setPermissionMessage] = useState('근무지를 선택하면 현재 위치를 확인합니다.')
  const [canAskAgain, setCanAskAgain] = useState(true)
  // 화면/목록/요청별 로딩 상태
  const [isScreenLoading, setIsScreenLoading] = useState(true)
  const [isAccountLoading, setIsAccountLoading] = useState(true)
  const [isRequestingDevice, setIsRequestingDevice] = useState(false)
  const [isSubmittingAttendance, setIsSubmittingAttendance] = useState(false)
  const [isConfirmingIdentity, setIsConfirmingIdentity] = useState(false)

  // 서버가 내려준 강제 업데이트 요구 버전 정보(없거나 현재 버전과 같으면 통과)
  const [appVersionInfo, setAppVersionInfo] = useState<AppVersionInfo | null>(null)

  // 검색어로 필터링한 근무지 목록
  const filteredAccounts = useMemo(() => {
    const query = accountQuery.trim().toLowerCase()
    const matches = query
      ? accountList.filter(
          (account) =>
            account.account_name.toLowerCase().includes(query) ||
            account.account_id.toLowerCase().includes(query)
        )
      : accountList

    return matches
  }, [accountList, accountQuery])

  // 본인 확인 상태 초기화(이름/휴대폰/근무지 변경 시 재확인 필요)
  const invalidateIdentity = useCallback(() => {
    setConfirmedIdentity(null)
    setDeviceInfo(null)
    setTodayStatus(null)
    setDeviceAttentionNeeded(false)
    setMapAttentionNeeded(false)
  }, [])

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
  const fetchDevicePosition = useCallback(async (loadingMessage: string) => {
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

    // 고정밀 현재 위치 조회
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
      mayShowUserSettingsDialog: true,
    })
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

  // 근무지가 정해지기 전, 화면 진입 시 위치 권한/좌표만 백그라운드로 미리 확보해 둡니다.
  const prefetchLocation = useCallback(async () => {
    const location = await fetchDevicePosition('위치 권한을 확인하고 있습니다.')
    setCurrentLocation(location)
    setPermissionState('granted')
    setPermissionMessage('근무지를 선택하면 현재 위치를 확인합니다.')
  }, [fetchDevicePosition])

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
  const loadAccountTarget = useCallback(
    async (account: AttendanceAccount) => {
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
          const { distance } = await resolveLocation(target)
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
    [resolveLocation]
  )

  // 30초 캐시를 건너뛰고 현재 위치를 강제로 새로 조회합니다(수동 새로고침 버튼용).
  const refreshCurrentLocation = async () => {
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
    const [nextDeviceInfo, nextTodayStatus] = await Promise.all([
      fetchDeviceInfo(identity),
      fetchTodayStatus(identity),
    ])

    const deviceInfoResult = nextDeviceInfo?.user_name ? nextDeviceInfo : null
    setDeviceInfo(deviceInfoResult)
    setTodayStatus(nextTodayStatus?.t_date ? nextTodayStatus : null)

    return deviceInfoResult
  }, [])

  // 화면 진입 시 근무지 목록과 기기 토큰을 불러오고 입력값 초기화
  useFocusEffect(
    useCallback(() => {
      let active = true

      const initializeScreen = async () => {
        setIsScreenLoading(true)
        setIsAccountLoading(true)

        try {
          const [accounts, nextDeviceToken] = await Promise.all([
            fetchAttendanceAccounts(),
            getOrCreateCommuteDeviceToken(),
          ])

          if (!active) return

          setAccountList(accounts)
          setDeviceToken(nextDeviceToken)

          // 강제 업데이트 확인은 화면 진입 즉시, 다른 초기화와 별개로 처리합니다
          // (실패해도 출퇴근 화면 자체는 계속 쓸 수 있어야 하므로 조용히 무시).
          void fetchAppVersionInfo()
            .then((info) => {
              if (active) setAppVersionInfo(info)
            })
            .catch(() => {})

          // 개인정보 수집 동의는 사람(account_id+user_name+phone_last4) 기준이라
          // 아직 본인 확인 전인 이 시점에는 조회할 수 없고, confirmIdentity에서 함께 확인합니다.
          setName('')
          setPhoneLast4('')
          setAccountQuery('')
          setSelectedAccount(null)
          setAccountDropdownOpen(false)
          setConfirmedIdentity(null)
          setDeviceInfo(null)
          setTodayStatus(null)
          setDeviceAttentionNeeded(false)
          setMapAttentionNeeded(false)
          setAttendanceTarget(null)
          setCurrentLocation(null)
          setDistanceFromOffice(null)
          setPermissionState('idle')
          setPermissionMessage('근무지를 선택하면 현재 위치를 확인합니다.')

          // 화면 진입과 동시에 위치 권한 확인/GPS 조회를 백그라운드로 미리 시작해 둡니다.
          // 근무지 선택 전에 미리 끝내 두면 이후 근무지 선택·확인 단계에서는
          // resolveLocation이 이 값을 재사용해 대기 시간이 줄어듭니다.
          // 실패(권한 거부 등)해도 조용히 무시하고, 근무지 선택 시 다시 안내됩니다.
          if (active) {
            void prefetchLocation().catch(() => {})
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : '출퇴근 화면을 준비하지 못했습니다.'
          setPermissionState('denied')
          setPermissionMessage(message)
        } finally {
          if (active) {
            setIsAccountLoading(false)
            setIsScreenLoading(false)
          }
        }
      }

      void initializeScreen()

      return () => {
        active = false
      }
    }, [])
  )

  // 이름 입력 변경 처리
  const handleNameChange = (value: string) => {
    setName(value)
    invalidateIdentity()
  }

  // 휴대폰 뒷자리 입력 변경 처리(숫자 4자리만 허용)
  const handlePhoneLast4Change = (value: string) => {
    setPhoneLast4(value.replace(/\D/g, '').slice(0, 4))
    invalidateIdentity()
  }

  // 근무지 검색어 변경 처리(선택값과 달라지면 선택 해제)
  const handleAccountQueryChange = (value: string) => {
    setAccountQuery(value)
    setAccountDropdownOpen(true)

    if (selectedAccount && value !== selectedAccount.account_name) {
      setSelectedAccount(null)
      setAttendanceTarget(null)
      // currentLocation은 근무지가 아닌 기기 위치 자체이므로 지우지 않고 재사용합니다.
      setDistanceFromOffice(null)
      setPermissionState('idle')
      setPermissionMessage('검색 결과에서 근무지를 선택해 주세요.')
      invalidateIdentity()
    }
  }

  // 드랍다운에서 근무지 선택 처리(이름/휴대폰 미입력 시 위치 조회 생략)
  const selectAccount = async (account: AttendanceAccount) => {
    setSelectedAccount(account)
    setAccountQuery(account.account_name)
    setAccountDropdownOpen(false)
    invalidateIdentity()
    Keyboard.dismiss()
    accountInputRef.current?.blur()

    const effectiveName = name.trim()
    if (!effectiveName || !/^\d{4}$/.test(phoneLast4)) {
      setAttendanceTarget(null)
      // currentLocation은 근무지가 아닌 기기 위치 자체이므로 지우지 않고 재사용합니다.
      setDistanceFromOffice(null)
      setPermissionState('idle')
      setPermissionMessage('이름과 휴대폰 번호 뒷자리를 먼저 입력해 주세요.')
      return
    }

    await loadAccountTarget(account)
  }

  // 검색창 엔터 입력 시 일치하는 근무지 자동 선택
  const selectAccountByInput = () => {
    const query = accountQuery.trim().toLowerCase()
    if (!query) return

    // 이름 완전 일치 우선, 없으면 부분 일치가 하나뿐일 때만 선택
    const exact = accountList.find(
      (account) => account.account_name.toLowerCase() === query
    )
    const partial = accountList.filter((account) =>
      account.account_name.toLowerCase().includes(query)
    )
    const matched = exact ?? (partial.length === 1 ? partial[0] : null)

    if (matched) void selectAccount(matched)
  }

  // 이름/휴대폰/근무지 입력값 검증 후 본인 확인 요청
  const confirmIdentity = async () => {
    Keyboard.dismiss()
    nameInputRef.current?.blur()
    phoneInputRef.current?.blur()
    accountInputRef.current?.blur()

    const effectiveName = name.trim()
    if (!effectiveName) {
      Alert.alert('입력 확인', '이름을 입력해 주세요.')
      return
    }
    if (!/^\d{4}$/.test(phoneLast4)) {
      Alert.alert('입력 확인', '휴대폰 번호 뒷자리 숫자 4개를 입력해 주세요.')
      return
    }
    if (!selectedAccount) {
      Alert.alert('입력 확인', '검색 결과에서 근무지를 선택해 주세요.')
      return
    }

    // 위치 권한이 차단되어 다시 요청할 수 없으면 기기 설정 화면으로 이동합니다.
    if (permissionState === 'denied' && !canAskAgain && Platform.OS !== 'web') {
      await Linking.openSettings()
      return
    }

    const identity: CommuteIdentity = {
      accountId: selectedAccount.account_id,
      userName: effectiveName,
      phoneLast4,
    }

    try {
      setIsConfirmingIdentity(true)

      // 거래처를 선택할 때 이미 해당 근무지 좌표(attendanceTarget)를 받아 두었다면
      // 좌표를 다시 조회하지 않고 resolveLocation으로 위치만(캐시 우선) 확인합니다.
      // attendanceTarget이 없는 경우에만(이름/휴대폰을 나중에 입력한 경우 등) 처음부터 조회합니다.
      // 이 위치/거리 확인(GPS 포함)은 기기등록 여부 판단과는 무관하므로, 아래에서 기다리지 않고
      // 백그라운드로 흘려보낸 뒤 지오펜스 판단이 실제로 필요한 시점에만 결과를 기다립니다.
      const geofenceRadiusM = attendanceTarget?.radiusM ?? DEFAULT_GEOFENCE_M
      const distanceTask: Promise<{ distance: number | null; radiusM: number }> = attendanceTarget
        ? resolveLocation(attendanceTarget)
            .then(({ distance }) => ({ distance, radiusM: geofenceRadiusM }))
            .catch((error) => {
              const message = error instanceof Error ? error.message : '현재 위치를 확인하지 못했습니다.'
              setPermissionState('denied')
              setPermissionMessage(message)
              return { distance: null, radiusM: geofenceRadiusM }
            })
        : loadAccountTarget(selectedAccount)

      // 기기 식별자 조회, 개인정보 수집 동의 여부 조회를 기기등록 상태 조회와 함께 한 번에 보냅니다
      // (Android/iOS는 하드웨어 식별자라 동일한 값이 즉시 반환되고, fallback 토큰만 이 사용자 전용
      // 값으로 새로 확인/생성됩니다). 기기등록 필요 여부 판단에는 위치가 필요 없으므로
      // distanceTask는 여기서 기다리지 않습니다.
      const [nextDeviceInfo, resolvedDeviceToken, consentStatus] = await Promise.all([
        refreshIdentityStatus(identity),
        getOrCreateCommuteDeviceToken(phoneLast4),
        fetchPrivacyConsentStatus(identity).catch(() => null as PrivacyConsentStatus | null),
      ])
      setDeviceToken(resolvedDeviceToken)
      setConfirmedIdentity(identity)

      const consentAgreed = String(consentStatus?.agree_yn ?? 'N').toUpperCase() === 'Y'

      if (consentAgreed) {
        await evaluateDeviceAndGeofence(identity, resolvedDeviceToken, nextDeviceInfo, distanceTask)
        return
      }

      // 아직 동의한 적 없는 사람이면, 기기등록/지오펜스 판정으로 넘어가기 전에 먼저 물어봅니다.
      // 이미 동의한 적 있는 사람은 이 단계 자체를 안 거치므로 매번 방해받지 않습니다.
      setIsConfirmingIdentity(false)
      Alert.alert(
        '개인정보 수집 동의',
        '출퇴근 관리를 위해 이름, 휴대폰번호 뒷자리, 출퇴근 위치정보(GPS), 기기 식별자를 수집합니다.\n보유 기간: 3년\n\n동의하지 않으면 앱으로 출퇴근을 기록할 수 없습니다.',
        [
          { text: '취소', style: 'cancel', onPress: () => invalidateIdentity() },
          {
            text: '동의',
            onPress: () => {
              void agreePrivacyConsent(identity, resolvedDeviceToken, getCommuteDeviceName()).catch(() => {})
              setIsConfirmingIdentity(true)
              void evaluateDeviceAndGeofence(identity, resolvedDeviceToken, nextDeviceInfo, distanceTask)
            },
          },
        ]
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '본인 정보를 확인하지 못했습니다.'
      Alert.alert('확인 실패', message)
      setIsConfirmingIdentity(false)
    }
  }

  // 기기등록 상태와 지오펜스(반경)를 확인해서 강조 표시 상태를 갱신합니다.
  // 개인정보 수집에 이미 동의한 경우 confirmIdentity에서 바로 호출되고,
  // 처음 동의한 경우에는 동의 팝업에서 "동의"를 눌렀을 때 이어서 호출됩니다.
  const evaluateDeviceAndGeofence = async (
    identity: CommuteIdentity,
    resolvedDeviceToken: string,
    nextDeviceInfo: DeviceInfo | null,
    distanceTask: Promise<{ distance: number | null; radiusM: number }>
  ) => {
    try {
      // 같은 기기인지는 여기서 서버가 저장해둔 device_token/pending_device_token 문자열과
      // 이 기기의 resolvedDeviceToken을 비교해서 판단합니다.
      const approved = String(nextDeviceInfo?.approve_yn ?? 'N').toUpperCase() === 'Y'
      const approvedHere =
        approved && !!resolvedDeviceToken && nextDeviceInfo?.device_token === resolvedDeviceToken
      const pendingHere =
        !!resolvedDeviceToken && nextDeviceInfo?.pending_device_token === resolvedDeviceToken
      const deviceNeedsAttention = !approvedHere && !pendingHere

      // 대리출근 방지: 기기등록 카드로 안내하기 전에, 이 기기가 이미 "다른 사람" 이름으로
      // 승인돼 있는 건 아닌지 먼저 확인합니다. 충돌이면 기기등록 카드로 보내는 대신 바로
      // 안내하고, 서버가 이 시도를 이력(tb_member_device_conflict_log)에 자동으로 남깁니다.
      const ownerConflict = deviceNeedsAttention
        ? await checkCommuteDeviceOwner(identity, resolvedDeviceToken, getCommuteDeviceName()).catch(
            () => null
          )
        : null

      if (ownerConflict?.conflict) {
        // 충돌이면 본인확인 자체가 실패한 것으로 취급합니다. 위에서 이미 반영된 오늘 출퇴근
        // 기록/본인확인 상태(todayStatus/confirmedIdentity 등)를 그대로 두면, 대리출근 시도가
        // 막힌 상황에서도 화면에는 그 사람의 실제 출퇴근 정보가 노출되는 문제가 생기기 때문에
        // invalidateIdentity로 전부 되돌립니다.
        invalidateIdentity()
        Alert.alert(
          '등록 불가',
          ownerConflict.msg || '이미 다른 사람의 근무기록으로 등록된 기기입니다.'
        )
      } else if (deviceNeedsAttention) {
        // 기기등록이 필요한 경우엔 거리 확인 결과를 기다리지 않고 바로 안내합니다.
        // distanceTask는 백그라운드에서 계속 진행되어 지도 카드는 준비되는 대로 갱신됩니다.
        setDeviceAttentionNeeded(true)
        setMapAttentionNeeded(false)
        requestAnimationFrame(() => {
          scrollViewRef.current?.scrollTo({ y: deviceCardYRef.current, animated: true })
        })
      } else {
        // 기기는 문제없으니 이제 근무지 반경 밖인지 판단하기 위해 거리 결과를 기다립니다.
        const { distance, radiusM } = await distanceTask
        const geofenceFails = distance !== null && distance > radiusM

        if (geofenceFails) {
          setDeviceAttentionNeeded(false)
          setMapAttentionNeeded(true)
          requestAnimationFrame(() => {
            scrollViewRef.current?.scrollTo({ y: mapCardYRef.current, animated: true })
          })
        } else {
          setDeviceAttentionNeeded(false)
          setMapAttentionNeeded(false)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '본인 정보를 확인하지 못했습니다.'
      Alert.alert('확인 실패', message)
    } finally {
      setIsConfirmingIdentity(false)
    }
  }

  // 현재 기기의 ERP 승인 상태 판정
  const isApproved = String(deviceInfo?.approve_yn ?? 'N').toUpperCase() === 'Y'
  const isCurrentDeviceApproved =
    isApproved && !!deviceToken && deviceInfo?.device_token === deviceToken
  const isCurrentDevicePending = !!deviceToken && deviceInfo?.pending_device_token === deviceToken
  const isApprovedOnAnotherDevice = isApproved && !isCurrentDeviceApproved

  // 등록 요청을 보냈거나(승인 대기) 이미 승인되면 강조 표시를 끕니다.
  useEffect(() => {
    if (isCurrentDevicePending || isCurrentDeviceApproved) {
      setDeviceAttentionNeeded(false)
    }
  }, [isCurrentDevicePending, isCurrentDeviceApproved])

  // 기기 등록/지도 카드 강조 표시가 켜져 있는 동안 테두리를 반복해서 반짝입니다.
  useEffect(() => {
    if (!deviceAttentionNeeded && !mapAttentionNeeded) {
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
  }, [deviceAttentionNeeded, mapAttentionNeeded, attentionPulse])

  // 승인 대기 중일 때 5초 간격으로 상태 자동 재조회
  useEffect(() => {
    if (!confirmedIdentity || !isCurrentDevicePending) return

    const timer = setInterval(() => {
      void refreshIdentityStatus(confirmedIdentity).catch(() => {
        // 일시적인 통신 실패는 다음 자동 조회에서 다시 확인합니다.
      })
    }, 5000)

    return () => clearInterval(timer)
  }, [confirmedIdentity, isCurrentDevicePending, refreshIdentityStatus])

  // 현재 기기 ERP 등록 요청 - 잘못된 정보로 그대로 등록되는 걸 막기 위해, 실제 서버 요청 전에
  // 입력했던 본인확인 정보(이름/휴대폰 뒷자리/근무지)를 다시 보여주고 확인받습니다.
  const requestDevice = () => {
    if (!confirmedIdentity || !deviceToken) {
      Alert.alert('본인 확인 필요', '이름, 휴대폰 번호, 근무지를 먼저 확인해 주세요.')
      return
    }

    const accountLabel = selectedAccount?.account_name || confirmedIdentity.accountId

    Alert.alert(
      '기기 등록 확인',
      `아래 정보로 현재 기기를 등록하시겠습니까?\n\n이름: ${confirmedIdentity.userName}\n휴대폰 뒷자리: ${confirmedIdentity.phoneLast4}\n근무지: ${accountLabel}`,
      [
        { text: '취소', style: 'cancel' },
        { text: '등록', onPress: () => void submitDeviceRequest() },
      ]
    )
  }

  // 위 확인을 거친 뒤 실제로 서버에 기기 등록을 요청합니다.
  const submitDeviceRequest = async () => {
    if (!confirmedIdentity || !deviceToken) return

    try {
      setIsRequestingDevice(true)
      const response = await requestCommuteDevice(
        confirmedIdentity,
        deviceToken,
        getCommuteDeviceName()
      )

      if (String(response.code ?? '') !== '200') {
        throw new Error(response.msg || '기기 등록 요청에 실패했습니다.')
      }

      await refreshIdentityStatus(confirmedIdentity)
      Alert.alert('요청 완료', response.msg || 'ERP 관리자 승인 후 출퇴근할 수 있습니다.')
    } catch (error) {
      const message = error instanceof Error ? error.message : '기기 등록 요청 중 오류가 발생했습니다.'
      Alert.alert('요청 실패', message)
    } finally {
      setIsRequestingDevice(false)
    }
  }

  // 서버가 내려준 버전과 현재 설치된 앱 버전이 다르면 강제 업데이트 대상으로 판단합니다.
  const currentAppVersion = Application.nativeApplicationVersion ?? ''
  const requiredAppVersion = String(appVersionInfo?.version ?? '').trim()
  const updateRequired = !!requiredAppVersion && requiredAppVersion !== currentAppVersion

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

  // 출근/퇴근 기록 저장 처리
  const submitAttendance = async (action: CommuteAction) => {
    if (!confirmedIdentity || !attendanceTarget || !deviceToken || !isCurrentDeviceApproved) {
      Alert.alert('출퇴근 불가', 'ERP에서 현재 기기의 등록 승인 상태를 확인해 주세요.')
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

  // 기기 등록 상태 배지 라벨
  const deviceStatusLabel = !confirmedIdentity
    ? '본인 정보 확인 필요'
    : isCurrentDeviceApproved
      ? 'ERP 등록기기 승인됨'
      : isCurrentDevicePending
        ? 'ERP 기기 승인 대기중'
        : isApprovedOnAnotherDevice
          ? '다른 기기로 승인됨'
          : '등록된 기기 없음'

  // 출근/퇴근 버튼 활성화 조건
  const canClockIn =
    isCurrentDeviceApproved && geofenceOk && nextAction === 'clockIn' && !isSubmittingAttendance
  const canClockOut =
    isCurrentDeviceApproved && geofenceOk && nextAction === 'clockOut' && !isSubmittingAttendance
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
        <Text style={styles.todayText}>{formatToday()}</Text>

        {/* 이름과 휴대폰을 한 줄에 배치하고 근무지를 아래에서 검색하는 영역 */}
        <View style={[styles.card, styles.identityCard]}>
          <View style={styles.identityInputRow}>
            <View style={styles.halfInputGroup}>
              <Text style={styles.label}>이름</Text>
              <TextInput
                ref={nameInputRef}
                value={name}
                onChangeText={handleNameChange}
                placeholder="이름 입력"
                placeholderTextColor="#9aa0a6"
                returnKeyType="next"
                onSubmitEditing={() => phoneInputRef.current?.focus()}
                style={styles.textInput}
              />
            </View>

            <View style={styles.halfInputGroup}>
              <Text style={styles.label}>휴대폰 뒷자리(4자리)</Text>
              <TextInput
                ref={phoneInputRef}
                value={phoneLast4}
                onChangeText={handlePhoneLast4Change}
                placeholder="1234"
                placeholderTextColor="#9aa0a6"
                keyboardType="number-pad"
                maxLength={4}
                style={[styles.textInput, styles.phoneInput]}
              />
            </View>
          </View>

          <View style={styles.accountInputGroup}>
            <Text style={styles.label}>근무지</Text>
            <View style={styles.accountSearchBox}>
              <View style={styles.searchIconWrap} pointerEvents="none">
                <Text style={styles.searchIcon}>⌕</Text>
              </View>
              <TextInput
                ref={accountInputRef}
                value={accountQuery}
                onFocus={() => setAccountDropdownOpen(true)}
                onChangeText={handleAccountQueryChange}
                onSubmitEditing={selectAccountByInput}
                placeholder={isAccountLoading ? '근무지 불러오는 중' : '거래처 검색...'}
                placeholderTextColor="#9aa0a6"
                returnKeyType="search"
                style={[styles.textInput, styles.accountSearchInput]}
              />
              {accountQuery.length > 0 ? (
                <Pressable
                  hitSlop={10}
                  style={styles.clearAccountButton}
                  onPress={() => {
                    handleAccountQueryChange('')
                    accountInputRef.current?.focus()
                  }}
                >
                  <Text style={styles.clearAccountText}>✕</Text>
                </Pressable>
              ) : null}
              <Pressable
                hitSlop={10}
                style={styles.dropdownArrowButton}
                onPress={() => {
                  if (accountDropdownOpen) {
                    setAccountDropdownOpen(false)
                    Keyboard.dismiss()
                    accountInputRef.current?.blur()
                  } else {
                    setAccountDropdownOpen(true)
                    accountInputRef.current?.focus()
                  }
                }}
              >
                <Text style={styles.dropdownArrow}>{accountDropdownOpen ? '▲' : '▼'}</Text>
              </Pressable>
            </View>

            {accountDropdownOpen ? (
              <View style={styles.accountDropdown}>
                {filteredAccounts.length > 0 ? (
                  <ScrollView
                    nestedScrollEnabled
                    keyboardShouldPersistTaps="always"
                    showsVerticalScrollIndicator
                    style={styles.accountDropdownScroll}
                  >
                    {filteredAccounts.map((account) => (
                      <Pressable
                        key={account.account_id}
                        style={styles.accountOption}
                        onPress={() => void selectAccount(account)}
                      >
                        <Text style={styles.accountOptionIcon}>🏢</Text>
                        <Text style={styles.accountOptionName}>{account.account_name}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : (
                  <Text style={styles.noAccountText}>검색 결과가 없습니다.</Text>
                )}
              </View>
            ) : null}
          </View>

          <Pressable
            disabled={isConfirmingIdentity || isScreenLoading}
            style={[
              styles.confirmButton,
              (isConfirmingIdentity || isScreenLoading) && styles.buttonDisabled,
            ]}
            onPress={() => void confirmIdentity()}
          >
            {isConfirmingIdentity ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.confirmButtonText}>확인</Text>
            )}
          </Pressable>
        </View>

        {/* 오늘 출퇴근 시각과 현재 진행 순서에 맞는 저장 버튼 영역 */}
        <View style={styles.commuteCard}>
          <View style={styles.titleRow}>
            <Text style={styles.sectionTitle}>오늘 출퇴근</Text>
            {confirmedIdentity ? <Text style={styles.confirmedName}>{confirmedIdentity.userName}</Text> : null}
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
            <Text style={styles.actionHint}>이름, 휴대폰 번호, 근무지를 입력하고 확인해 주세요.</Text>
          ) : !isCurrentDeviceApproved ? (
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
              <Text style={styles.mapOverlayText}>근무지를 선택하면 지도에 표시됩니다.</Text>
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
                <Text style={styles.locationRefreshIcon}>⟳</Text>
              </Pressable>
            )}
          </View>
        </Animated.View>

        {/* ERP 기기등록 상태와 현재 휴대폰 등록 요청 영역 */}
        <Animated.View
          style={[
            styles.card,
            deviceAttentionNeeded && {
              borderColor: attentionPulse.interpolate({
                inputRange: [0, 1],
                outputRange: ['#f0ad4e', '#e6342a'],
              }),
              borderWidth: 2,
            },
          ]}
          onLayout={(event) => {
            deviceCardYRef.current = event.nativeEvent.layout.y
          }}
        >
          {deviceAttentionNeeded ? (
            <Text style={styles.attentionText}>👉 출퇴근하려면 현재 기기를 등록해 주세요.</Text>
          ) : null}
          <View style={styles.titleRow}>
            <Text style={styles.sectionTitle}>기기 등록</Text>
            <View
              style={[
                styles.statusBadge,
                isCurrentDeviceApproved
                  ? styles.statusApproved
                  : isCurrentDevicePending
                    ? styles.statusPending
                    : styles.statusRejected,
              ]}
            >
              <Text style={styles.statusBadgeText}>{deviceStatusLabel}</Text>
            </View>
          </View>
          <Text style={styles.helperText}>{getCommuteDeviceName()}</Text>

          {confirmedIdentity && !isCurrentDeviceApproved && !isCurrentDevicePending ? (
            <AnimatedPressable
              disabled={isRequestingDevice}
              style={[
                styles.deviceButton,
                deviceAttentionNeeded && {
                  borderWidth: 3,
                  borderColor: attentionPulse.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['#6c5dd3', '#e6342a'],
                  }),
                },
                isRequestingDevice && styles.buttonDisabled,
              ]}
              onPress={requestDevice}
            >
              {isRequestingDevice ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.deviceButtonText}>
                  {isApprovedOnAnotherDevice ? '현재 기기로 변경 요청' : '현재 기기 등록 요청'}
                </Text>
              )}
            </AnimatedPressable>
          ) : null}

          {isCurrentDevicePending ? (
            <Text style={styles.pendingText}>
              ERP 관리자 승인을 기다리고 있습니다. 승인되면 상태가 자동으로 변경됩니다.
            </Text>
          ) : null}
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
  brandTitle: { color: '#4b5563', fontSize: 17, fontWeight: '900' },
  todayText: { color: '#747b86', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  card: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 12,
  },
  identityCard: { zIndex: 20 },
  commuteCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    gap: 16,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sectionTitle: { color: '#27303f', fontSize: 18, fontWeight: '800' },
  identityInputRow: { flexDirection: 'row', gap: 10 },
  halfInputGroup: { flex: 1, gap: 6 },
  accountInputGroup: { position: 'relative', zIndex: 30, gap: 6 },
  label: { color: '#606975', fontSize: 13, fontWeight: '800' },
  textInput: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d9dce2',
    paddingHorizontal: 14,
    backgroundColor: '#ffffff',
    color: '#27303f',
    fontSize: 15,
    fontWeight: '700',
  },
  phoneInput: { letterSpacing: 2 },
  accountSearchBox: {
    position: 'relative',
    justifyContent: 'center',
  },
  accountSearchInput: {
    paddingLeft: 40,
    paddingRight: 70,
    borderColor: '#58a6ff',
  },
  searchIconWrap: {
    position: 'absolute',
    left: 12,
    top: 0,
    bottom: 0,
    zIndex: 2,
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchIcon: {
    color: '#9aa0ac',
    fontSize: 22,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  dropdownArrowButton: {
    position: 'absolute',
    right: 6,
    top: 0,
    bottom: 0,
    width: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearAccountButton: {
    position: 'absolute',
    right: 38,
    top: 0,
    bottom: 0,
    width: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearAccountText: {
    color: '#9aa0ac',
    fontSize: 16,
    fontWeight: '900',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  dropdownArrow: {
    color: '#7d838c',
    fontSize: 22,
    fontWeight: '900',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  accountDropdown: {
    position: 'absolute',
    top: 76,
    left: 0,
    right: 0,
    maxHeight: 320,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d9dce2',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    zIndex: 40,
  },
  accountDropdownScroll: {
    maxHeight: 320,
  },
  accountOption: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  accountOptionIcon: { fontSize: 16 },
  accountOptionName: { color: '#27303f', fontSize: 14, fontWeight: '800' },
  noAccountText: { color: '#747b86', fontSize: 13, padding: 16, textAlign: 'center' },
  confirmButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#6c5dd3',
  },
  confirmButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
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
  mapOverlayIcon: { color: '#a9afb8', fontSize: 34, fontWeight: '900' },
  mapOverlayText: { marginTop: 6, color: '#747b86', fontSize: 13, fontWeight: '700' },
  mapStatusRow: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  mapStatusTextGroup: { flex: 1, gap: 4 },
  distanceLabel: { color: '#27303f', fontSize: 14, fontWeight: '900' },
  permissionMessage: { color: '#e5566b', fontSize: 12, lineHeight: 17 },
  permissionMessageOk: { color: '#1fa45c' },
  permissionMessageAlert: { color: '#e5566b', fontSize: 13, fontWeight: '900' },
  helperText: { color: '#747b86', fontSize: 12, lineHeight: 18 },
  locationRefreshButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: '#eef0ff',
  },
  locationRefreshIcon: { color: '#6c5dd3', fontSize: 18, fontWeight: '900' },
  statusBadge: { maxWidth: '70%', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  statusApproved: { backgroundColor: '#e8f8ef' },
  statusPending: { backgroundColor: '#fff4dc' },
  statusRejected: { backgroundColor: '#fdebee' },
  statusBadgeText: { color: '#3d4551', fontSize: 12, fontWeight: '800' },
  attentionText: { color: '#9a6b16', fontSize: 13, fontWeight: '800' },
  deviceButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    backgroundColor: '#6c5dd3',
  },
  deviceButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  pendingText: { color: '#9a6b16', fontSize: 13, lineHeight: 20 },
  confirmedName: { color: '#6c5dd3', fontSize: 16, fontWeight: '900' },
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
  timeLabel: { color: '#747b86', fontSize: 12, fontWeight: '700' },
  timeValue: { fontSize: 23, fontWeight: '900' },
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
  actionButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  actionHint: { color: '#747b86', fontSize: 12, lineHeight: 18, textAlign: 'center' },
  buttonDisabled: { opacity: 0.42 },
  // 강제 업데이트/개인정보 동의 화면 공통 레이아웃
  gateScreen: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 18 },
  gateTitle: { color: '#27303f', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  gateBody: { color: '#4b5563', fontSize: 14, lineHeight: 22, textAlign: 'left' },
  gateButton: {
    minHeight: 52,
    minWidth: 220,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
    paddingHorizontal: 24,
    backgroundColor: '#6c5dd3',
  },
  gateButtonText: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
})
