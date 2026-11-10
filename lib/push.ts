import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

import { api } from '@/lib/api/client'
import { getCommuteDeviceName } from '@/lib/attendance/storage'

// 앱 푸시 알림 (근로계약서 도착 알림 등)
// 로그인할 때 이 기기의 Expo 푸시 토큰을 서버(tb_app_push_token)에 로그인한 사람과 함께 등록하고, 로그아웃하면 지운다.
// 서버는 Expo 푸시 서비스로 보내고, Expo가 안드로이드는 FCM, 아이폰은 APNs로 전달한다.

// 앱을 보고 있을 때 받은 알림도 화면 위에 배너로 표시 (앱 아이콘 숫자 배지도 알림 값으로 반영)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

// 앱 아이콘 숫자 배지를 서명 전 계약서 수로 맞춤 (0이면 배지 제거, 런처가 지원하지 않으면 무시)
export function syncAppBadge(count: number) {
  void Notifications.setBadgeCountAsync(Math.max(0, count)).catch(() => undefined)
}

// 푸시 토큰 주인 (본사/영양사: ERP 아이디, 조리사/조리원: 근무지·이름·휴대폰 뒷자리)
export type PushOwner =
  { kind: 'staff'; userId: string } | { kind: 'cook'; accountId: string | number; userName: string; phoneLast4: string }

// 알림을 눌렀을 때 이동할 수 있는 화면 (서버가 보내는 data.url 값)
type PushRoute = '/contract'

// 이번 실행에서 로그인을 마쳤는지 (로그인 전에 알림을 누르면 로그인 후 이동하도록 미뤄 둠)
let loggedIn = false
// 로그인 후 홈 대신 이동할 화면 (로그인 전에 누른 알림)
let pendingRoute: PushRoute | null = null
// 진행 중인 서버 토큰 삭제 요청 (새로 로그인해 토큰을 등록하기 전에 끝나기를 기다려 순서가 뒤바뀌지 않게 함)
let deleting: Promise<void> | null = null

// 기기 저장값 키 (registered: 로그인 때 서버에 등록한 토큰, pendingDelete: 로그아웃했지만 아직 서버에서 지우지 못한 토큰)
const PUSH_TOKEN_KEYS = {
  registered: 'push_token_registered',
  pendingDelete: 'push_token_pending_delete',
} as const

// 이 기기의 Expo 푸시 토큰 조회 (askPermission: 알림 권한이 없으면 허용 요청, 허용 안 하거나 시뮬레이터면 null)
async function getPushToken(askPermission: boolean): Promise<string | null> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: '기본 알림',
        importance: Notifications.AndroidImportance.HIGH,
      })
    }
    let { status } = await Notifications.getPermissionsAsync()
    if (status !== 'granted' && askPermission) {
      status = (await Notifications.requestPermissionsAsync()).status
    }
    if (status !== 'granted') {
      console.warn(`[푸시] 알림 권한 없음 (${status})`)
      return null
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data
  } catch (error) {
    console.warn('[푸시] 토큰 발급 실패', error)
    return null
  }
}

// 로그인 성공 시 호출: 이 기기 토큰을 로그인한 사람으로 서버에 등록 (실패해도 로그인은 그대로 진행)
export async function registerPushToken(owner: PushOwner) {
  loggedIn = true
  const token = await getPushToken(true)
  if (!token) {
    return
  }
  // 이전 로그아웃의 토큰 삭제가 아직 진행 중이면 끝난 뒤 등록 (삭제가 나중에 도착해 새 등록을 지우지 않게)
  await deleting
  // 같은 기기 토큰은 서버에서 새 로그인한 사람으로 덮어쓰므로 못 지운 삭제 예약은 버림, 로그아웃 때 바로 지울 수 있게 토큰 보관
  await AsyncStorage.removeItem(PUSH_TOKEN_KEYS.pendingDelete)
  await AsyncStorage.setItem(PUSH_TOKEN_KEYS.registered, token)
  const ownerParams =
    owner.kind === 'staff'
      ? { login_type: 'staff', user_id: owner.userId }
      : {
          login_type: 'cook',
          account_id: String(owner.accountId),
          user_name: owner.userName,
          phone_last4: owner.phoneLast4,
        }
  await api
    .post('/Operate/AppPushTokenSave', {
      push_token: token,
      ...ownerParams,
      platform: Platform.OS,
      device_name: getCommuteDeviceName(),
    })
    .then((response) => console.log('[푸시] 토큰 등록 응답', token, response))
    .catch((error) => console.warn('[푸시] 토큰 서버 등록 실패', error))
}

// 로그아웃 시 호출: 이 기기 토큰을 삭제 예약으로 옮기고 서버 삭제는 기다리지 않고 보냄 (통신이 느려도 로그아웃이 바로 끝나도록)
// 로그아웃한 기기로는 알림이 가지 않도록, 통신 실패로 못 지운 토큰은 앱을 다시 켤 때 다시 지운다
export async function unregisterPushToken() {
  loggedIn = false
  pendingRoute = null
  syncAppBadge(0)
  const token = await AsyncStorage.getItem(PUSH_TOKEN_KEYS.registered)
  if (!token) {
    // 토큰 보관 전 버전으로 로그인한 기기: Expo에서 토큰을 다시 받아 뒤에서 삭제 (로그아웃은 기다리지 않음)
    void getPushToken(false).then(async (fetched) => {
      if (!fetched) return
      await AsyncStorage.setItem(PUSH_TOKEN_KEYS.pendingDelete, fetched)
      await retryPendingPushTokenDelete()
    })
    return
  }
  await AsyncStorage.setItem(PUSH_TOKEN_KEYS.pendingDelete, token)
  await AsyncStorage.removeItem(PUSH_TOKEN_KEYS.registered)
  void retryPendingPushTokenDelete()
}

// 삭제 예약된 토큰을 서버에서 지움 (로그아웃 직후·앱 시작 시 호출, 실패하면 예약을 남겨 다음에 다시 시도)
export function retryPendingPushTokenDelete() {
  if (deleting) {
    return deleting
  }
  deleting = (async () => {
    try {
      const token = await AsyncStorage.getItem(PUSH_TOKEN_KEYS.pendingDelete)
      if (!token) {
        return
      }
      await api.post('/Operate/AppPushTokenDelete', { push_token: token })
      // 지우는 사이 다시 로그인해 같은 토큰을 새로 등록했으면 예약은 이미 비워져 있음
      if ((await AsyncStorage.getItem(PUSH_TOKEN_KEYS.pendingDelete)) === token) {
        await AsyncStorage.removeItem(PUSH_TOKEN_KEYS.pendingDelete)
      }
    } catch (error) {
      console.warn('[푸시] 토큰 서버 삭제 실패 (다음 실행 때 다시 시도)', error)
    } finally {
      deleting = null
    }
  })()
  return deleting
}

// 알림을 눌렀을 때 이동할 화면 처리 (로그인 전이면 로그인 후로 미루고 null, 로그인 상태면 바로 이동할 화면 반환)
export function routeForNotification(data: unknown): PushRoute | null {
  const url = (data as { url?: unknown } | null | undefined)?.url
  if (url !== '/contract') {
    return null
  }
  if (!loggedIn) {
    pendingRoute = url
    return null
  }
  return url
}

// 로그인 후 이동할 화면 (로그인 전에 누른 알림이 있으면 그 화면, 없으면 홈)
export function takeRouteAfterLogin(): '/home' | PushRoute {
  const route = pendingRoute
  pendingRoute = null
  return route ?? '/home'
}
