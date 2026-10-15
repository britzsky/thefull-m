import { Platform } from 'react-native'
import * as Location from 'expo-location'

// 메인 화면에서 미리 시작해 두는 고정밀 GPS 조회
// 출퇴근 화면 진입 시 GPS 첫 측위 대기 시간을 줄이기 위해 사용하며, 위치는 서버로 보내지 않고 앱 메모리에만 보관

// 미리 받은 위치를 출퇴근 화면에서 사용할 수 있는 최대 경과 시간(출퇴근 화면의 최근 위치 재사용 기준과 동일)
const PREFETCH_MAX_AGE_MS = 30000

// 진행 중이거나 완료된 미리 조회 작업과 시작 시각
let prefetched: { promise: Promise<Location.LocationObject | null>; startedAt: number } | null = null

// 위치 권한이 이미 허용된 경우에만 권한 요청 없이 조용히 GPS 조회를 시작하는 함수
export function prefetchCommuteLocation() {
  if (Platform.OS === 'web') return
  if (prefetched && Date.now() - prefetched.startedAt <= PREFETCH_MAX_AGE_MS) return

  const promise = (async () => {
    const serviceEnabled = await Location.hasServicesEnabledAsync()
    if (!serviceEnabled) return null

    const permission = await Location.getForegroundPermissionsAsync()
    if (permission.status !== 'granted') return null
    if (Platform.OS === 'android' && permission.android?.accuracy !== 'fine') return null

    return Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
  })().catch(() => null)

  prefetched = { promise, startedAt: Date.now() }
}

// 미리 조회한 위치를 한 번만 꺼내 쓰는 함수 (없거나 오래됐으면 null → 호출한 쪽에서 새로 조회)
export async function takePrefetchedLocation() {
  const current = prefetched
  prefetched = null

  if (!current || Date.now() - current.startedAt > PREFETCH_MAX_AGE_MS) return null

  const position = await current.promise
  if (!position || Date.now() - position.timestamp > PREFETCH_MAX_AGE_MS) return null

  return position
}
