import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Application from 'expo-application'
import { Platform } from 'react-native'

const PHONE_LAST4_PREFIX = 'commute_phone_last4'

// Expo Go 안에서 실행 중인지 여부. react-native-device-info는 Expo Go 바이너리에 포함되지
// 않은 서드파티 네이티브 모듈이라, Expo Go에서 시도하면 콘솔에 매번 에러가 찍힙니다(치명적이진
// 않지만 시끄러움). 미리 걸러서 Expo Go에서는 아예 시도하지 않고 바로 ANDROID_ID로 폴백합니다.
const isRunningInExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient

// 출퇴근 등록 기기 식별자로, 스토어 정책상 권장되는 방식을 우선순위대로 사용합니다.
// - Android: App Set ID (Google이 부정행위 방지 등 비광고 목적에 공식 권장하는 값).
//   Play Services App Set 라이브러리를 못 가져오는 기기(구글 서비스 미탑재 등)는 ANDROID_ID로 폴백.
// - iOS: identifierForVendor(IDFV). Apple 정책상 정당한 부정행위 방지 목적으로 허용되는 API.
// - 그 외(웹 등, 위 값을 못 가져오는 환경)는 휴대폰 뒷자리로 결정되는 고정 토큰을 사용합니다.
//   랜덤값을 섞지 않는 이유는, 랜덤 토큰은 앱 재설치/캐시 삭제 시 값이 바뀌어서 이미 관리자
//   승인을 받은 기기인데도 "새 기기"로 인식돼 버리는 문제가 있었기 때문입니다. 같은 뒷자리
//   번호로는 항상 같은 값이 나오므로, 저장소를 거치지 않고도 재현 가능합니다.
//
// 참고: App Set ID/ANDROID_ID/IDFV 모두 "앱을 완전히 삭제 후 재설치"하면 초기화될 수 있습니다.
// (2025-04-10 Google Play 정책 변경 이후 ANDROID_ID도 영구 식별자로 취급되지 않음, IDFV는
// 원래부터 그런 특성). Keychain 등으로 이 초기화를 우회하는 건 앱스토어 핑거프린팅 금지 정책
// 위반 리스크가 있어 의도적으로 하지 않았습니다 — 자세한 내용은
// docs/attendance-device-identifier-and-store-privacy.md 참고.
export async function getOrCreateCommuteDeviceToken(phoneLast4 = '') {
  if (Platform.OS === 'android') {
    if (!isRunningInExpoGo) {
      try {
        // react-native-device-info는 Expo Go에는 포함되지 않은 네이티브 모듈이라, Expo Go
        // 안에서는 위에서 미리 걸러 아예 시도하지 않습니다(그래도 실패하면 조용히 폴백).
        // 실제 빌드(EAS/Xcode/Android Studio)에서는 네이티브 모듈이 정상 링크되어 있어
        // App Set ID를 그대로 사용합니다.
        const { default: DeviceInfo } = await import('react-native-device-info')
        const { id: appSetId } = await DeviceInfo.getAppSetId()

        if (appSetId && appSetId !== 'unknown') {
          return appSetId
        }
      } catch {
        // Play Services App Set 라이브러리를 사용할 수 없는 기기는 아래 ANDROID_ID로 폴백합니다.
      }
    }

    const androidId = Application.getAndroidId()

    if (androidId) {
      return androidId
    }
  }

  if (Platform.OS === 'ios') {
    const iosIdForVendor = await Application.getIosIdForVendorAsync()

    if (iosIdForVendor) {
      return iosIdForVendor
    }
  }

  return `device_${phoneLast4 || 'unknown'}`
}

// 관리자가 기기 등록 요청을 구분할 수 있도록 운영체제와 모델명을 표시합니다.
export function getCommuteDeviceName() {
  if (Platform.OS === 'android') {
    const brand = Platform.constants.Brand?.trim() || 'Android'
    const model = Platform.constants.Model?.trim() || '기기'

    return `${brand} · ${model}`
  }

  if (Platform.OS === 'ios') {
    return 'Apple · iPhone/iPad'
  }

  return `${Platform.OS} · Expo`
}

function getPhoneLast4Key(accountId: string, userName: string) {
  return `${PHONE_LAST4_PREFIX}:${encodeURIComponent(accountId)}:${encodeURIComponent(userName)}`
}

export async function getStoredPhoneLast4(accountId: string, userName: string) {
  return (await AsyncStorage.getItem(getPhoneLast4Key(accountId, userName))) ?? ''
}

export async function saveStoredPhoneLast4(accountId: string, userName: string, phoneLast4: string) {
  await AsyncStorage.setItem(getPhoneLast4Key(accountId, userName), phoneLast4)
}
