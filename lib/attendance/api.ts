import { Platform } from 'react-native'

import { api } from '@/lib/api/client'

export type CommuteIdentity = {
  accountId: string
  userName: string
  phoneLast4: string
}

export type AttendanceAccount = {
  account_id: string
  account_name: string
}

export type AttendanceTarget = {
  xCoordinate: number
  yCoordinate: number
  radiusM: number | null
}

export type DeviceInfo = {
  user_name?: string | null
  approve_yn?: string | null
  device_token?: string | null
  device_name?: string | null
  pending_device_token?: string | null
  pending_device_name?: string | null
  request_dt?: string | null
}

export type TodayStatus = {
  t_date?: string | null
  start_time?: string | null
  end_time?: string | null
}

type CoordinatePayload = {
  x_coordinate?: number | string | null
  y_coordinate?: number | string | null
  radius_m?: number | string | null
}

type MessagePayload = {
  code?: string | number
  msg?: string
  reason?: string
}

export type CommuteLocation = {
  latitude: number
  longitude: number
}

export type CommuteAction = 'clockIn' | 'clockOut'

function toFiniteNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(numberValue) ? numberValue : null
}

export async function fetchAttendanceAccounts() {
  const response = await api.get<Array<Record<string, unknown>>>('/Account/AccountList', {
    account_type: '0',
  })

  const accounts = Array.isArray(response)
    ? response
        .map((item) => ({
          account_id: String(item.account_id ?? '').trim(),
          account_name: String(item.account_name ?? '').trim(),
        }))
        .filter((item) => item.account_id && item.account_name)
        // ✅ 가나다순 정렬 - API가 정렬해서 안 주므로 프론트에서 처리 (본사는 아래서 맨 앞에 고정)
        .sort((a, b) => a.account_name.localeCompare(b.account_name, 'ko'))
    : []

  return [{ account_id: 'HQ', account_name: '본사' }, ...accounts]
}

export async function fetchAccountCoordinate(accountId: string) {
  const response = await api.post<CoordinatePayload>('/Account/AccountCoordinateInfo', {
    account_id: accountId,
  })
  const xCoordinate = toFiniteNumber(response?.x_coordinate)
  const yCoordinate = toFiniteNumber(response?.y_coordinate)

  if (xCoordinate === null || yCoordinate === null) {
    return null
  }

  return { xCoordinate, yCoordinate, radiusM: toFiniteNumber(response?.radius_m) }
}

export function fetchDeviceInfo(identity: CommuteIdentity) {
  return api.get<DeviceInfo | null>('/Account/CommuteDeviceInfo', {
    account_id: identity.accountId,
    user_name: identity.userName,
    phone_last4: identity.phoneLast4,
  })
}

export function fetchTodayStatus(identity: CommuteIdentity) {
  return api.get<TodayStatus>('/Account/CommuteTodayStatus', {
    account_id: identity.accountId,
    user_name: identity.userName,
    phone_last4: identity.phoneLast4,
  })
}

export type DeviceOwnerCheck = {
  conflict?: boolean
  owner_user_name?: string | null
  msg?: string
}

// 대리출근 방지: 이 device_token이 이미 "다른 사람" 이름으로 승인돼 있는지 확인합니다.
// 충돌이 감지되면 서버가 이력(tb_member_device_conflict_log)에 자동으로 남깁니다.
export function checkCommuteDeviceOwner(
  identity: CommuteIdentity,
  deviceToken: string,
  deviceName: string
) {
  return api.get<DeviceOwnerCheck>('/Account/CommuteDeviceOwnerCheck', {
    account_id: identity.accountId,
    user_name: identity.userName,
    phone_last4: identity.phoneLast4,
    device_token: deviceToken,
    device_name: deviceName,
  })
}

export function requestCommuteDevice(
  identity: CommuteIdentity,
  deviceToken: string,
  deviceName: string
) {
  return api.post<MessagePayload>('/Account/CommuteDeviceRequest', {
    account_id: identity.accountId,
    user_name: identity.userName,
    phone_last4: identity.phoneLast4,
    device_token: deviceToken,
    device_name: deviceName,
  })
}

function getLocalDateAndTime() {
  const now = new Date()
  const year = now.getFullYear()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  const hours = `${now.getHours()}`.padStart(2, '0')
  const minutes = `${now.getMinutes()}`.padStart(2, '0')
  const seconds = `${now.getSeconds()}`.padStart(2, '0')

  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}:${seconds}`,
  }
}

export function submitCommute(
  identity: CommuteIdentity,
  action: CommuteAction,
  location: CommuteLocation,
  distance: number,
  deviceToken: string,
  deviceName: string
) {
  const { date, time } = getLocalDateAndTime()
  const commonPayload = {
    account_id: identity.accountId,
    user_name: identity.userName,
    phone_last4: identity.phoneLast4,
    device_token: deviceToken,
    device_name: deviceName,
    t_date: date,
  }
  const actionPayload =
    action === 'clockIn'
      ? {
          start_time: time,
          st_x_coordinate: location.longitude,
          st_y_coordinate: location.latitude,
          st_error_margin: Math.round(distance),
        }
      : {
          end_time: time,
          ed_x_coordinate: location.longitude,
          ed_y_coordinate: location.latitude,
          ed_error_margin: Math.round(distance),
        }

  return api.post<MessagePayload>('/Account/CommuteSave', {
    ...commonPayload,
    ...actionPayload,
  })
}

export type AppVersionInfo = {
  platform?: string | null
  version?: string | null
  update_url?: string | null
}

// 앱 진입 시 강제 업데이트 여부 판단을 위해 서버에 등록된 최신 요구 버전을 조회합니다.
export function fetchAppVersionInfo() {
  return api.get<AppVersionInfo | null>('/Account/CommuteAppVersionInfo', {
    platform: Platform.OS,
  })
}

export type PrivacyConsentStatus = {
  account_id?: string | null
  user_name?: string | null
  phone_last4?: string | null
  agree_yn?: string | null
  agree_dt?: string | null
}

// 이 사람(account_id+user_name+phone_last4)이 개인정보(이름/휴대폰 뒷자리/GPS 위치/기기식별자)
// 수집에 이미 동의했는지 조회합니다. device_token은 재설치 시 바뀔 수 있어 기준으로 쓰지 않습니다.
export function fetchPrivacyConsentStatus(identity: CommuteIdentity) {
  return api.get<PrivacyConsentStatus | null>('/Account/CommutePrivacyConsentStatus', {
    account_id: identity.accountId,
    user_name: identity.userName,
    phone_last4: identity.phoneLast4,
  })
}

// 개인정보 수집 동의를 사람(account_id+user_name+phone_last4) 기준으로 서버에 저장합니다.
// device_token/deviceName은 어떤 기기로 동의했는지 참고용으로 함께 남깁니다.
export function agreePrivacyConsent(identity: CommuteIdentity, deviceToken: string, deviceName: string) {
  return api.post<MessagePayload>('/Account/CommutePrivacyConsentAgree', {
    account_id: identity.accountId,
    user_name: identity.userName,
    phone_last4: identity.phoneLast4,
    device_token: deviceToken,
    device_name: deviceName,
  })
}
