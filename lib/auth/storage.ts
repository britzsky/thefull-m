import AsyncStorage from '@react-native-async-storage/async-storage'

export const AUTH_STORAGE_KEYS = {
  autoLogin: 'autoLogin',
  autoLoginUserId: 'autoLoginUserId',
  autoLoginPassword: 'autoLoginPassword',
  positionName: 'position_name',
  userName: 'user_name',
  userId: 'user_id',
  userType: 'user_type',
  position: 'position',
  department: 'department',
  accountId: 'account_id',
  loginSessionId: 'login_session_id',
} as const

type StoredLoginPayload = {
  account_id?: string | number | null
  department?: string | number | null
  position?: string | number | null
  position_name?: string | null
  user_id?: string | null
  user_name?: string | null
  user_type?: string | number | null
}

export type LoginSession = {
  accountId: string
  userId: string
  userName: string
  department: string
  position: string
  positionName: string
  userType: string
  sessionId: string
}

export async function saveRememberedLogin(userId: string, password: string) {
  await AsyncStorage.multiSet([
    [AUTH_STORAGE_KEYS.autoLogin, 'true'],
    [AUTH_STORAGE_KEYS.autoLoginUserId, userId],
    [AUTH_STORAGE_KEYS.autoLoginPassword, password],
  ])
}

export async function clearRememberedLogin() {
  await AsyncStorage.multiRemove([
    AUTH_STORAGE_KEYS.autoLogin,
    AUTH_STORAGE_KEYS.autoLoginUserId,
    AUTH_STORAGE_KEYS.autoLoginPassword,
  ])
}

export async function getRememberedLogin() {
  const values = await AsyncStorage.multiGet([
    AUTH_STORAGE_KEYS.autoLogin,
    AUTH_STORAGE_KEYS.autoLoginUserId,
    AUTH_STORAGE_KEYS.autoLoginPassword,
  ])

  const lookup = Object.fromEntries(values)
  const autoLoginEnabled = lookup[AUTH_STORAGE_KEYS.autoLogin] === 'true'
  const userId = lookup[AUTH_STORAGE_KEYS.autoLoginUserId] ?? ''
  const password = lookup[AUTH_STORAGE_KEYS.autoLoginPassword] ?? ''

  return {
    autoLoginEnabled,
    userId,
    password,
  }
}

export async function saveLoginSession(payload: StoredLoginPayload) {
  const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2)}`

  await AsyncStorage.multiSet([
    [AUTH_STORAGE_KEYS.positionName, payload.position_name ?? ''],
    [AUTH_STORAGE_KEYS.userName, payload.user_name ?? ''],
    [AUTH_STORAGE_KEYS.userId, payload.user_id ?? ''],
    [AUTH_STORAGE_KEYS.userType, payload.user_type?.toString() ?? ''],
    [AUTH_STORAGE_KEYS.position, payload.position?.toString() ?? ''],
    [AUTH_STORAGE_KEYS.department, payload.department?.toString() ?? ''],
    [AUTH_STORAGE_KEYS.accountId, payload.account_id?.toString() ?? ''],
    [AUTH_STORAGE_KEYS.loginSessionId, sessionId],
  ])

  return sessionId
}

// 로그아웃 시 로그인 세션 정보 삭제 (자동 로그인용 아이디·비밀번호는 유지)
export async function clearLoginSession() {
  await AsyncStorage.multiRemove([
    AUTH_STORAGE_KEYS.positionName,
    AUTH_STORAGE_KEYS.userName,
    AUTH_STORAGE_KEYS.userId,
    AUTH_STORAGE_KEYS.userType,
    AUTH_STORAGE_KEYS.position,
    AUTH_STORAGE_KEYS.department,
    AUTH_STORAGE_KEYS.accountId,
    AUTH_STORAGE_KEYS.loginSessionId,
  ])
}

// 저장된 자동 로그인 비밀번호만 삭제 (아이디는 유지, 다음 로그인 화면에서 자동 로그인되지 않음)
export async function forgetRememberedPassword() {
  await AsyncStorage.removeItem(AUTH_STORAGE_KEYS.autoLoginPassword)
}

// 로그인 화면 라디오 구분 (조리사/조리원: cook, 본사/영양사: staff)
export type LoginMode = 'cook' | 'staff'

// 조리사/조리원 로그인 정보 (이름·휴대폰 뒷자리·근무지)
export type CookIdentity = {
  accountId: string
  accountName: string
  userName: string
  phoneLast4: string
}

// 앱 로그인 상태 (조리사/조리원 또는 본사/영양사 계정, 로그인 전이면 null)
export type AppSession =
  | { mode: 'cook'; cook: CookIdentity }
  | { mode: 'staff'; staff: LoginSession }
  | null

const LOGIN_MODE_KEY = 'login_mode'
// 이 기기에서 마지막으로 입력한 조리사/조리원 정보 (로그인 화면 미리 채우기용, 로그아웃해도 유지)
const COOK_LAST_INPUT_KEY = 'cook_last_input'
// 현재 로그인한 조리사/조리원 정보 (로그아웃 시 삭제)
const COOK_SESSION_KEY = 'cook_session'

// 마지막으로 로그인에 성공한 라디오 구분 조회 (처음은 조리사/조리원)
export async function getLoginMode(): Promise<LoginMode> {
  return (await AsyncStorage.getItem(LOGIN_MODE_KEY)) === 'staff' ? 'staff' : 'cook'
}

export async function saveLoginMode(mode: LoginMode) {
  await AsyncStorage.setItem(LOGIN_MODE_KEY, mode)
}

function parseCookIdentity(value: string | null): CookIdentity | null {
  try {
    const parsed = value ? JSON.parse(value) : null
    return parsed?.userName && parsed?.accountId ? parsed : null
  } catch {
    return null
  }
}

// 이 기기에서 마지막으로 입력한 조리사/조리원 정보 조회·저장
export async function getCookLastInput() {
  return parseCookIdentity(await AsyncStorage.getItem(COOK_LAST_INPUT_KEY))
}

export async function saveCookLastInput(identity: CookIdentity) {
  await AsyncStorage.setItem(COOK_LAST_INPUT_KEY, JSON.stringify(identity))
}

// 기기 승인된 조리사/조리원 로그인 상태 저장
export async function saveCookSession(identity: CookIdentity) {
  await AsyncStorage.setItem(COOK_SESSION_KEY, JSON.stringify(identity))
}

// 조리사/조리원 로그인 상태 삭제 (본사/영양사 계정으로 로그인할 때 사용)
export async function clearCookSession() {
  await AsyncStorage.removeItem(COOK_SESSION_KEY)
}

// 현재 로그인 상태 조회 (조리사/조리원 우선, 없으면 본사/영양사 계정 세션)
export async function getAppSession(): Promise<AppSession> {
  const cook = parseCookIdentity(await AsyncStorage.getItem(COOK_SESSION_KEY))
  if (cook) {
    return { mode: 'cook', cook }
  }

  const staff = await getLoginSession()
  return staff.userId ? { mode: 'staff', staff } : null
}

// 로그아웃: 조리사/조리원·계정 세션과 자동 로그인 비밀번호 삭제 (아이디·마지막 입력값은 유지)
export async function logoutAppSession() {
  await AsyncStorage.removeItem(COOK_SESSION_KEY)
  await clearLoginSession()
  await forgetRememberedPassword()
}

export async function getLoginSession(): Promise<LoginSession> {
  const values = await AsyncStorage.multiGet([
    AUTH_STORAGE_KEYS.accountId,
    AUTH_STORAGE_KEYS.userId,
    AUTH_STORAGE_KEYS.userName,
    AUTH_STORAGE_KEYS.department,
    AUTH_STORAGE_KEYS.position,
    AUTH_STORAGE_KEYS.positionName,
    AUTH_STORAGE_KEYS.userType,
    AUTH_STORAGE_KEYS.loginSessionId,
  ])

  const lookup = Object.fromEntries(values)

  return {
    accountId: lookup[AUTH_STORAGE_KEYS.accountId] ?? '',
    userId: lookup[AUTH_STORAGE_KEYS.userId] ?? '',
    userName: lookup[AUTH_STORAGE_KEYS.userName] ?? '',
    department: lookup[AUTH_STORAGE_KEYS.department] ?? '',
    position: lookup[AUTH_STORAGE_KEYS.position] ?? '',
    positionName: lookup[AUTH_STORAGE_KEYS.positionName] ?? '',
    userType: lookup[AUTH_STORAGE_KEYS.userType] ?? '',
    sessionId: lookup[AUTH_STORAGE_KEYS.loginSessionId] ?? '',
  }
}
