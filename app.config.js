// app.json 설정을 기본으로 사용하고, 개발용 빌드(APP_VARIANT=development)일 때만
// 앱 이름·번들 ID·스킴을 바꿔 TestFlight/스토어 앱과 같은 폰에 함께 설치되도록 하는 설정
const IS_DEV = process.env.APP_VARIANT === 'development'

module.exports = ({ config }) => {
  // 안드로이드 FCM 설정 파일: EAS 빌드에서는 파일형 환경변수(GOOGLE_SERVICES_JSON) 경로, 로컬에서는 프로젝트 폴더의 파일
  config.android = {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  }

  if (!IS_DEV) return config

  return {
    ...config,
    name: '채움원 DEV',
    scheme: 'thefullm-dev',
    ios: {
      ...config.ios,
      bundleIdentifier: 'com.thefull.thefullm.dev',
    },
    android: {
      ...config.android,
      package: 'com.thefull.thefullm.dev',
    },
  }
}
