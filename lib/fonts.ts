// 앱 공통 Pretendard 폰트
// 커스텀 폰트는 fontWeight로 굵기가 바뀌지 않으므로 굵기별 fontFamily를 직접 지정

// 앱 시작 시 _layout에서 불러오는 폰트 파일 목록
export const pretendardFonts = {
  'Pretendard-Regular': require('../assets/fonts/Pretendard-Regular.otf'),
  'Pretendard-Medium': require('../assets/fonts/Pretendard-Medium.otf'),
  'Pretendard-SemiBold': require('../assets/fonts/Pretendard-SemiBold.otf'),
  'Pretendard-Bold': require('../assets/fonts/Pretendard-Bold.otf'),
}

// 스타일에서 쓰는 굵기별 fontFamily 이름
export const font = {
  regular: 'Pretendard-Regular',
  medium: 'Pretendard-Medium',
  semibold: 'Pretendard-SemiBold',
  bold: 'Pretendard-Bold',
} as const
