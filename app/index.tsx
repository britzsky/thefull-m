import { Redirect } from 'expo-router'

// 앱 첫 진입 경로 (항상 로그인 화면부터 시작, 로그인 후 메인에서 출퇴근·위생 점검 선택)
export default function IndexScreen() {
  return <Redirect href="/login" />
}
