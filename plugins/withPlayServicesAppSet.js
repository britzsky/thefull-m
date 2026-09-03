const { withProjectBuildGradle } = require('@expo/config-plugins')

// react-native-device-info의 getAppSetId()는 android/build.gradle의 rootProject.ext에
// playServicesAppSetVersion 값이 있어야 Google Play services의 App Set ID 라이브러리를
// 의존성에 포함시킨다(안드로이드 대리출근 방지용 기기 식별자). Expo prebuild로 매번 새로
// 생성되는 android 프로젝트에 이 설정을 자동으로 끼워 넣기 위한 config plugin.
const PLAY_SERVICES_APP_SET_VERSION = '16.1.0'
const MARKER = '// added by withPlayServicesAppSet plugin'

module.exports = function withPlayServicesAppSet(config) {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('withPlayServicesAppSet은 groovy build.gradle만 지원합니다.')
    }

    if (config.modResults.contents.includes(MARKER)) {
      return config
    }

    const snippet = `
allprojects {
  ext {
    playServicesAppSetVersion = "${PLAY_SERVICES_APP_SET_VERSION}" ${MARKER}
  }
}
`
    config.modResults.contents += snippet

    return config
  })
}
