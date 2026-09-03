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
