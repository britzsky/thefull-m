// app.json 설정을 기본으로 사용하고, 개발용 빌드(APP_VARIANT=development)일 때만
// 앱 이름·번들 ID·스킴을 바꿔 TestFlight/스토어 앱과 같은 폰에 함께 설치되도록 하는 설정
const IS_DEV = process.env.APP_VARIANT === 'development'

module.exports = ({ config }) => {
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
