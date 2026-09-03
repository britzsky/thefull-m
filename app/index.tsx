import { Redirect } from 'expo-router'

// 현재 앱은 출퇴근 전용으로 운영하며 로그인과 메인 화면은 별도 경로에 보존합니다.
export default function IndexScreen() {
  return <Redirect href="/attendance" />
}
