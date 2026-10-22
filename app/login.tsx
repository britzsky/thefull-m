import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Keyboard,
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
import { router } from 'expo-router'

import BrandHeader from '@/components/BrandHeader'
import {
  type AttendanceAccount,
  type CommuteIdentity,
  agreePrivacyConsent,
  checkCommuteDeviceOwner,
  fetchAttendanceAccounts,
  fetchDeviceInfo,
  fetchPrivacyConsentStatus,
  requestCommuteDevice,
} from '@/lib/attendance/api'
import { getCommuteDeviceName, getOrCreateCommuteDeviceToken } from '@/lib/attendance/storage'
import {
  type LoginMode,
  clearCookSession,
  clearLoginSession,
  clearRememberedLogin,
  getCookLastInput,
  getLoginMode,
  getRememberedLogin,
  saveCookLastInput,
  saveCookSession,
  saveLoginMode,
  saveLoginSession,
  saveRememberedLogin,
} from '@/lib/auth/storage'
import { api } from '@/lib/api/client'
import { font } from '@/lib/fonts'

// 로그인 화면 (앱 첫 화면)
// 조리사/조리원: 이름·휴대폰 뒷자리·근무지 + 기기 승인, 본사/영양사: the_full 계정 아이디·비밀번호

// 로그인 구분 라디오 목록
// 키보드 윗변과 입력칸 사이 여유 간격 (안드로이드는 키보드 위 추천 단어 줄까지 고려)
const KEYBOARD_GAP = Platform.OS === 'android' ? 64 : 16

const loginModes: { mode: LoginMode; label: string }[] = [
  { mode: 'cook', label: '조리사' },
  { mode: 'staff', label: '본사/영양사' },
]

// 확인·취소 Alert를 기다릴 수 있게 감싼 함수 (확인 true, 취소 false)
function confirmAlert(title: string, message: string, okText: string) {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: '취소', style: 'cancel', onPress: () => resolve(false) },
        { text: okText, onPress: () => resolve(true) },
      ],
      { cancelable: false }
    )
  })
}

// 로그인 API 응답 (세션 저장값 포함)
type LoginResponse = {
  code?: string | number
  msg?: string
  use_yn?: string | null
  position_name?: string | null
  user_name?: string | null
  user_id?: string | null
  user_type?: string | number | null
  position?: string | number | null
  department?: string | number | null
  account_id?: string | number | null
}

export default function LoginScreen() {
  // 태블릿 폭 여부 (가운데 정렬 최대 폭 적용 기준)
  const { width } = useWindowDimensions()
  const isTablet = width >= 768

  // 로그인 구분 (처음은 조리사/조리원, 이후 마지막으로 로그인한 구분)
  const [loginMode, setLoginMode] = useState<LoginMode>('cook')

  // 조리사/조리원 입력값 (이름, 휴대폰 뒷자리, 근무지 검색어·선택 근무지)
  const [cookName, setCookName] = useState('')
  const [cookPhoneLast4, setCookPhoneLast4] = useState('')
  const [accountQuery, setAccountQuery] = useState('')
  const [selectedAccount, setSelectedAccount] = useState<AttendanceAccount | null>(null)
  // 근무지 목록과 검색 목록 열림 여부
  const [accountList, setAccountList] = useState<AttendanceAccount[]>([])
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false)
  // 근무지 검색 입력칸 (화살표 버튼으로 목록 열고 닫을 때 포커스 이동)
  const accountInputRef = useRef<TextInput>(null)
  // 근무지 검색 결과 목록 (근무지 입력 중에는 목록 아래 끝까지 키보드 위로 보이게 스크롤)
  const accountDropdownRef = useRef<View>(null)

  // 로그인 입력 스크롤 영역과 현재 스크롤 위치 (가려진 입력칸을 위로 올릴 때 사용)
  const bodyScrollRef = useRef<ScrollView>(null)
  const bodyScrollYRef = useRef(0)
  // 키보드 윗변 화면 좌표 (키보드가 없으면 null)와 키보드 높이 (안드로이드 아래 여백 계산용)
  const keyboardTopRef = useRef<number | null>(null)
  const [keyboardHeight, setKeyboardHeight] = useState(0)

  // 입력 중인 칸이 키보드에 가려지면 가려진 만큼 로그인 화면을 위로 스크롤
  // 근무지 입력 중이고 검색 목록이 열려 있으면 목록 아래 끝 기준으로 판단
  // 호출 시점(포커스·키보드 표시·목록 크기 변경) 직후 레이아웃이 반영되도록 다음 프레임에 측정
  const keepFocusedInputVisible = useCallback(() => {
    requestAnimationFrame(() => {
      const keyboardTop = keyboardTopRef.current
      const input = TextInput.State.currentlyFocusedInput()
      if (keyboardTop === null || !input || !bodyScrollRef.current) return
      const target = input === accountInputRef.current && accountDropdownRef.current ? accountDropdownRef.current : input

      target.measureInWindow((_x, y, _width, height) => {
        const overflow = y + height + KEYBOARD_GAP - keyboardTop
        if (overflow > 0) {
          bodyScrollRef.current?.scrollTo({ y: bodyScrollYRef.current + overflow, animated: true })
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
      // 안드로이드 하단 여백이 화면에 반영된 뒤 스크롤해야 맨 아래 입력칸·로그인 버튼까지 올라감
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

  // 아이디 입력값
  const [userId, setUserId] = useState('')
  // 비밀번호 입력값
  const [password, setPassword] = useState('')
  // 자동 로그인 체크 여부 (기본 해제, 저장된 로그인 정보가 있으면 저장값 사용)
  const [rememberMe, setRememberMe] = useState(false)
  // 로그인 요청 중 여부
  const [isSubmitting, setIsSubmitting] = useState(false)
  // 저장된 로그인 정보 확인 중 여부
  const [isHydrating, setIsHydrating] = useState(true)

  // 로그인 API 요청, 성공 시 자동 로그인 정보·세션 저장 후 위생 점검 화면 이동
  // remember: 자동 로그인 저장 여부 (체크박스 값을 직접 받아 화면 진입 시 한 번만 생성되는 함수 유지)
  const performLogin = useCallback(async (id: string, pw: string, remember: boolean) => {
    if (!id || !pw) {
      Alert.alert('알림', 'ID와 PASSWORD를 입력해 주세요.')
      return
    }

    try {
      setIsSubmitting(true)

      const response = await api.post<LoginResponse>('/User/Login', {
        userId: id,
        password: pw,
        // 로그인 이력 구분값 (ANDROID / IOS, 웹은 값 없이 WEB 처리)
        login_type: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
      })

      const responseCode = String(response.code ?? '')

      if (responseCode === '400') {
        Alert.alert('실패', response.msg || '로그인에 실패했습니다.')
        return
      }

      if (responseCode === '403') {
        const useYn = String(response.use_yn ?? '').toUpperCase()

        if (useYn === 'N') {
          Alert.alert('승인 대기', '승인 요청 중입니다.\n관리자에게 문의해주세요.')
        } else {
          Alert.alert('로그인 불가', response.msg || '로그인할 수 없습니다.')
        }
        return
      }

      if (remember) {
        await saveRememberedLogin(id, pw)
      } else {
        await clearRememberedLogin()
      }

      await clearCookSession()
      await saveLoginSession(response)
      await saveLoginMode('staff')

      // 로그인 성공 → 메인(출퇴근·위생 점검 선택) 이동
      router.replace('/home')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '서버 통신 중 오류가 발생했습니다.'
      Alert.alert('통신 오류', message)
    } finally {
      setIsSubmitting(false)
    }
  }, [])

  // 검색어로 걸러낸 근무지 목록
  const filteredAccounts = useMemo(() => {
    const query = accountQuery.trim().toLowerCase()

    return query ? accountList.filter((account) => account.account_name.toLowerCase().includes(query)) : accountList
  }, [accountList, accountQuery])

  // 근무지 검색어 변경 (선택한 근무지명과 달라지면 선택 해제)
  const handleAccountQueryChange = (value: string) => {
    setAccountQuery(value)
    setAccountDropdownOpen(true)

    if (selectedAccount && value !== selectedAccount.account_name) {
      setSelectedAccount(null)
    }
  }

  // 근무지 입력 지우기 (검색어·선택 근무지 초기화 후 바로 다시 검색할 수 있게 입력칸 포커스)
  const handleClearAccount = () => {
    setAccountQuery('')
    setSelectedAccount(null)
    setAccountDropdownOpen(true)
    accountInputRef.current?.focus()
  }

  // 검색 목록에서 근무지 선택
  const handleSelectAccount = (account: AttendanceAccount) => {
    setSelectedAccount(account)
    setAccountQuery(account.account_name)
    setAccountDropdownOpen(false)
    Keyboard.dismiss()
  }

  // 기기 승인된 조리사/조리원 로그인 완료 (계정 세션 정리, 로그인 정보·구분 저장 후 메인 이동)
  const finishCookLogin = async (identity: CommuteIdentity, accountName: string) => {
    await clearLoginSession()
    await saveCookSession({ ...identity, accountName })
    await saveLoginMode('cook')
    router.replace('/home')
  }

  // 조리사/조리원 로그인 처리
  // 개인정보 수집 동의 → 기기 승인 확인 (승인: 로그인 / 승인 대기: 안내 / 미등록: 기기등록 신청)
  const handleCookLogin = async () => {
    Keyboard.dismiss()

    // 이름은 띄어쓰기·공백 없이 저장 (이전에 공백 포함으로 저장된 미리 채우기 값 포함)
    const userName = cookName.replace(/\s/g, '')
    if (!userName) {
      Alert.alert('입력 확인', '이름을 입력해 주세요.')
      return
    }
    if (!/^\d{4}$/.test(cookPhoneLast4)) {
      Alert.alert('입력 확인', '휴대폰 번호 뒷자리 숫자 4개를 입력해 주세요.')
      return
    }
    if (!selectedAccount) {
      Alert.alert('입력 확인', '검색 결과에서 근무지를 선택해 주세요.')
      return
    }

    const identity: CommuteIdentity = {
      accountId: selectedAccount.account_id,
      userName,
      phoneLast4: cookPhoneLast4,
    }

    try {
      setIsSubmitting(true)
      // 이 기기에서 입력한 이름·연락처·근무지 저장 (다음 로그인 화면 미리 채우기)
      await saveCookLastInput({ ...identity, accountName: selectedAccount.account_name })

      const [deviceToken, consentStatus] = await Promise.all([
        getOrCreateCommuteDeviceToken(cookPhoneLast4),
        fetchPrivacyConsentStatus(identity).catch(() => null),
      ])
      const deviceName = getCommuteDeviceName()

      // 개인정보 수집 동의 (처음 한 번)
      if (String(consentStatus?.agree_yn ?? 'N').toUpperCase() !== 'Y') {
        const agreed = await confirmAlert(
          '개인정보 수집 동의',
          '출퇴근 관리를 위해 이름, 휴대폰번호 뒷자리, 출퇴근 위치정보(GPS), 기기 식별자를 수집합니다.\n보유 기간: 3년\n\n동의하지 않으면 앱으로 출퇴근을 기록할 수 없습니다.',
          '동의'
        )
        if (!agreed) {
          return
        }
        void agreePrivacyConsent(identity, deviceToken, deviceName).catch(() => {})
      }

      // 이 기기의 승인 상태 확인 (서버에 저장된 승인·대기 기기 토큰과 비교)
      const deviceInfo = await fetchDeviceInfo(identity)
      const approved = String(deviceInfo?.approve_yn ?? 'N').toUpperCase() === 'Y'

      if (approved && deviceInfo?.device_token === deviceToken) {
        await finishCookLogin(identity, selectedAccount.account_name)
        return
      }

      if (deviceInfo?.pending_device_token === deviceToken) {
        Alert.alert('승인 대기', '아직 기기등록 승인 대기 중입니다.\n관리자 승인 후 로그인할 수 있습니다.')
        return
      }

      // 대리출근 방지: 이 기기가 다른 사람 이름으로 승인돼 있으면 등록 불가
      const ownerConflict = await checkCommuteDeviceOwner(identity, deviceToken, deviceName).catch(() => null)
      if (ownerConflict?.conflict) {
        Alert.alert('등록 불가', ownerConflict.msg || '이미 다른 사람의 근무기록으로 등록된 기기입니다.')
        return
      }

      // 미등록 기기 → 입력 정보 확인 후 기기등록 신청
      const confirmed = await confirmAlert(
        '기기 등록 신청',
        `아래 정보로 현재 기기를 등록 신청하시겠습니까?\n\n이름: ${userName}\n휴대폰 뒷자리: ${cookPhoneLast4}\n근무지: ${selectedAccount.account_name}`,
        '신청'
      )
      if (!confirmed) {
        return
      }

      const response = await requestCommuteDevice(identity, deviceToken, deviceName)
      if (String(response.code ?? '') !== '200') {
        throw new Error(response.msg || '기기등록 신청에 실패했습니다.')
      }

      Alert.alert('기기등록 신청', '기기등록 신청을 했습니다.\n관리자 승인 후 로그인할 수 있습니다.')
    } catch (error) {
      const message = error instanceof Error ? error.message : '서버 통신 중 오류가 발생했습니다.'
      Alert.alert('로그인 실패', message)
    } finally {
      setIsSubmitting(false)
    }
  }

  // 로그인 버튼 처리 (선택한 구분에 따라 조리사/조리원 또는 계정 로그인)
  const handleLogin = async () => {
    if (loginMode === 'cook') {
      await handleCookLogin()
      return
    }

    await performLogin(userId.trim(), password, rememberMe)
  }

  // 화면 진입 시 저장값 채우기 (마지막 로그인 구분, 조리사/조리원 마지막 입력값, 근무지 목록, 계정 아이디·비밀번호)
  // 마지막 구분이 본사/영양사이고 자동 로그인 + 비밀번호 저장 상태면 바로 로그인 (로그아웃하면 비밀번호가 삭제되어 자동 로그인하지 않음)
  useEffect(() => {
    let active = true

    const hydrateLogin = async () => {
      try {
        const [savedMode, cookLastInput, savedLogin, accounts] = await Promise.all([
          getLoginMode(),
          getCookLastInput(),
          getRememberedLogin(),
          fetchAttendanceAccounts().catch(() => [] as AttendanceAccount[]),
        ])

        if (!active) {
          return
        }

        setLoginMode(savedMode)
        setAccountList(accounts)

        if (cookLastInput) {
          setCookName(cookLastInput.userName)
          setCookPhoneLast4(cookLastInput.phoneLast4)
          setAccountQuery(cookLastInput.accountName)
          setSelectedAccount(
            accounts.find((account) => account.account_id === cookLastInput.accountId) ?? {
              account_id: cookLastInput.accountId,
              account_name: cookLastInput.accountName,
            }
          )
        }

        // 저장된 로그인 정보가 없으면 자동 로그인 체크 기본값(해제) 유지
        if (!savedLogin.userId) {
          return
        }

        setRememberMe(savedLogin.autoLoginEnabled)
        setUserId(savedLogin.userId)
        setPassword(savedLogin.password)

        if (savedMode === 'staff' && savedLogin.autoLoginEnabled && savedLogin.password) {
          await performLogin(savedLogin.userId, savedLogin.password, true)
        }
      } finally {
        if (active) {
          setIsHydrating(false)
        }
      }
    }

    void hydrateLogin()

    return () => {
      active = false
    }
  }, [performLogin])

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      {/* 화면 전체 틀 (태블릿은 가운데 최대 폭) */}
      <View style={[styles.frame, isTablet && styles.frameTablet]}>
        {/* 상단 가운데 로고 헤더 */}
        <BrandHeader centerLogo />

        {/* 로그인 입력 스크롤 영역 */}
        <ScrollView
          ref={bodyScrollRef}
          contentContainerStyle={[
            styles.body,
            // 안드로이드는 키보드가 내용을 덮으므로 키보드 높이만큼 아래 여백 (iOS는 자동 인셋 사용)
            Platform.OS === 'android' && keyboardHeight > 0 ? { paddingBottom: keyboardHeight + KEYBOARD_GAP + 24 } : null,
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          scrollEventThrottle={16}
          onScroll={(event) => {
            bodyScrollYRef.current = event.nativeEvent.contentOffset.y
          }}
        >
          {/* 로그인 구분 라디오 (조리사/조리원, 본사/영양사) */}
          <View style={styles.modeRow}>
            {loginModes.map((item) => {
              const checked = loginMode === item.mode

              return (
                <Pressable
                  key={item.mode}
                  style={[styles.modeOption, checked && styles.modeOptionChecked]}
                  onPress={() => setLoginMode(item.mode)}
                >
                  {/* 라디오 원 */}
                  <View style={[styles.radio, checked && styles.radioChecked]}>
                    {checked ? <View style={styles.radioDot} /> : null}
                  </View>
                  <Text style={[styles.modeText, checked && styles.modeTextChecked]}>{item.label}</Text>
                </Pressable>
              )
            })}
          </View>

          {/* 로그인 안내 문구 */}
          <View style={styles.bodyHead}>
            <Text style={styles.bodyHeadTitle}>
              {loginMode === 'cook' ? '조리사 로그인' : '더채움 계정 로그인'}
            </Text>
            <Text style={styles.bodyHeadDescription}>
              {loginMode === 'cook'
                ? '이름, 휴대폰 뒷자리, 근무지를 입력해 주세요. \n처음 쓰는 기기는 관리자 승인 후 로그인됩니다.'
                : '아이디와 비밀번호를 입력해 주세요.'}
            </Text>
          </View>

          {/* 조리사/조리원 입력 및 로그인 버튼 카드 */}
          <View style={[styles.formCard, loginMode !== 'cook' && styles.hidden]}>
            {/* 이름 입력 */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>이름</Text>
              <TextInput
                value={cookName}
                onChangeText={(text) => setCookName(text.replace(/\s/g, ''))}
                placeholder="이름을 입력하세요"
                placeholderTextColor="#9aa7b3"
                autoCorrect={false}
                onFocus={keepFocusedInputVisible}
                style={styles.input}
              />
            </View>

            {/* 휴대폰 뒷자리 입력 */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>휴대폰 뒷자리(4자리)</Text>
              <TextInput
                value={cookPhoneLast4}
                onChangeText={(value) => setCookPhoneLast4(value.replace(/\D/g, '').slice(0, 4))}
                placeholder="1234"
                placeholderTextColor="#9aa7b3"
                keyboardType="number-pad"
                maxLength={4}
                onFocus={keepFocusedInputVisible}
                style={styles.input}
              />
            </View>

            {/* 근무지 검색·선택 */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>근무지</Text>
              {/* 근무지 검색 입력칸과 목록 열기/닫기 화살표 버튼 */}
              <View style={styles.accountSearchBox}>
                <TextInput
                  ref={accountInputRef}
                  value={accountQuery}
                  onFocus={() => {
                    setAccountDropdownOpen(true)
                    keepFocusedInputVisible()
                  }}
                  onChangeText={handleAccountQueryChange}
                  placeholder="거래처 검색"
                  placeholderTextColor="#9aa7b3"
                  autoCorrect={false}
                  style={[styles.input, styles.accountSearchInput, selectedAccount && styles.inputSelected]}
                />
                {/* 근무지 입력 지우기 버튼 (입력값이 있을 때만 표시) */}
                {accountQuery ? (
                  <Pressable hitSlop={6} style={styles.clearButton} onPress={handleClearAccount}>
                    <View style={styles.clearIcon}>
                      <Text style={styles.clearIconText}>✕</Text>
                    </View>
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
              {/* 근무지 검색 결과 목록 */}
              {accountDropdownOpen ? (
                <View ref={accountDropdownRef} style={styles.accountDropdown} onLayout={keepFocusedInputVisible}>
                  {filteredAccounts.length > 0 ? (
                    <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="always" style={styles.accountScroll}>
                      {filteredAccounts.map((account) => (
                        <Pressable
                          key={account.account_id}
                          style={styles.accountOption}
                          onPress={() => handleSelectAccount(account)}
                        >
                          <Text style={styles.accountOptionText}>{account.account_name}</Text>
                        </Pressable>
                      ))}
                    </ScrollView>
                  ) : (
                    <Text style={styles.accountEmptyText}>검색 결과가 없습니다.</Text>
                  )}
                </View>
              ) : null}
            </View>

            {/* 로그인 버튼 (기기 승인 확인 중 로딩 표시) */}
            <Pressable
              disabled={isSubmitting || isHydrating}
              style={[styles.loginButton, (isSubmitting || isHydrating) && styles.loginButtonDisabled]}
              onPress={() => void handleLogin()}
            >
              {isSubmitting || isHydrating ? (
                <View style={styles.loadingInline}>
                  <ActivityIndicator color="#ffffff" />
                  <Text style={styles.loginButtonText}>{isHydrating ? '저장된 정보 확인 중' : '기기 승인 확인 중'}</Text>
                </View>
              ) : (
                <Text style={styles.loginButtonText}>로그인</Text>
              )}
            </Pressable>
          </View>

          {/* 본사/영양사 아이디·비밀번호 입력 및 로그인 버튼 카드 */}
          <View style={[styles.formCard, loginMode !== 'staff' && styles.hidden]}>
            {/* 아이디 입력 */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>아이디</Text>
              <TextInput
                value={userId}
                onChangeText={setUserId}
                placeholder="아이디를 입력하세요"
                placeholderTextColor="#9aa7b3"
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={keepFocusedInputVisible}
                style={styles.input}
              />
            </View>

            {/* 비밀번호 입력 */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>비밀번호</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="비밀번호를 입력하세요"
                placeholderTextColor="#9aa7b3"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={keepFocusedInputVisible}
                style={styles.input}
              />
            </View>

            {/* 자동 로그인 체크 영역 */}
            <Pressable style={styles.rememberRow} onPress={() => setRememberMe((current) => !current)}>
              {/* 체크박스 */}
              <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>
                {rememberMe ? <Text style={styles.checkboxMark}>✓</Text> : null}
              </View>
              <Text style={styles.rememberText}>자동 로그인</Text>
            </Pressable>

            {/* 로그인 버튼 (요청·자동 로그인 확인 중 로딩 표시) */}
            <Pressable
              disabled={isSubmitting || isHydrating}
              style={[styles.loginButton, (isSubmitting || isHydrating) && styles.loginButtonDisabled]}
              onPress={() => void handleLogin()}
            >
              {isSubmitting || isHydrating ? (
                <View style={styles.loadingInline}>
                  <ActivityIndicator color="#ffffff" />
                  <Text style={styles.loginButtonText}>
                    {isHydrating ? '저장된 로그인 확인 중' : '로그인 처리 중'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.loginButtonText}>로그인</Text>
              )}
            </Pressable>
          </View>

        </ScrollView>
      </View>
    </SafeAreaView>
  )
}

// 로그인 화면 스타일
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
  body: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 24,
    gap: 12,
  },
  bodyHead: {
    gap: 4,
    marginBottom: 2,
  },
  bodyHeadTitle: {
    color: '#263442',
    fontSize: 16,
    fontFamily: font.bold,
  },
  bodyHeadDescription: {
    color: '#7a8998',
    fontSize: 14,
    fontFamily: font.regular,
  },
  formCard: {
    padding: 16,
    gap: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dde5eb',
    backgroundColor: '#ffffff',
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    color: '#445362',
    fontSize: 14,
    fontFamily: font.medium,
  },
  input: {
    height: 46,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cfd8e0',
    backgroundColor: '#ffffff',
    color: '#344252',
    fontSize: 16,
    fontFamily: font.regular,
  },
  rememberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cfd8e0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  checkboxChecked: {
    borderColor: '#1593c4',
    backgroundColor: '#1593c4',
  },
  checkboxMark: {
    color: '#ffffff',
    fontSize: 14,
    fontFamily: font.bold,
  },
  rememberText: {
    color: '#445362',
    fontSize: 14,
    fontFamily: font.medium,
  },
  loginButton: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: '#1593c4',
  },
  loginButtonDisabled: {
    opacity: 0.7,
  },
  loadingInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loginButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontFamily: font.bold,
  },
  hidden: {
    display: 'none',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeOption: {
    flex: 1,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dde5eb',
    backgroundColor: '#ffffff',
  },
  modeOptionChecked: {
    borderColor: '#1593c4',
    backgroundColor: '#eaf5fa',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#b7c4cf',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  radioChecked: {
    borderColor: '#1593c4',
  },
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#1593c4',
  },
  modeText: {
    color: '#52606d',
    fontSize: 16,
    fontFamily: font.medium,
  },
  modeTextChecked: {
    color: '#1687b2',
    fontFamily: font.bold,
  },
  inputSelected: {
    borderColor: '#1593c4',
  },
  // 근무지 입력칸 묶음 (오른쪽 화살표 버튼 겹쳐 배치 기준)
  accountSearchBox: {
    position: 'relative',
    justifyContent: 'center',
  },
  // 지우기·화살표 버튼과 글자가 겹치지 않도록 오른쪽 여백
  accountSearchInput: {
    paddingRight: 72,
  },
  // 근무지 입력 지우기 버튼 (화살표 버튼 왼쪽, 세로 가운데)
  clearButton: {
    position: 'absolute',
    right: 40,
    top: 0,
    bottom: 0,
    width: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 지우기 버튼 회색 원
  clearIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#c3ccd4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearIconText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  // 근무지 목록 열기/닫기 화살표 버튼 (입력칸 오른쪽 세로 가운데)
  dropdownArrowButton: {
    position: 'absolute',
    right: 6,
    top: 0,
    bottom: 0,
    width: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropdownArrow: {
    color: '#7d838c',
    fontSize: 16,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  accountDropdown: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dde5eb',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  accountScroll: {
    maxHeight: 220,
  },
  accountOption: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eef2f5',
  },
  accountOptionText: {
    color: '#344252',
    fontSize: 16,
    fontFamily: font.regular,
  },
  accountEmptyText: {
    padding: 12,
    color: '#7a8998',
    fontSize: 14,
    fontFamily: font.regular,
  },
})
