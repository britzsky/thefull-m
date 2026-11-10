import { requireOptionalNativeModule } from 'expo'
import { Alert } from 'react-native'

// 서명 완료 근로계약서 PDF를 휴대폰에 저장하는 함수 (안드로이드·아이폰 공통)
// 1) 앱 전용 임시 폴더(cache)에 PDF를 받고 2) 시스템 공유창을 열어 '파일에 저장'·'내 파일'·카카오톡 등으로 보관
// 앱 전용 폴더만 쓰므로 저장소 권한이 필요 없다 (app.json에서 READ/WRITE_EXTERNAL_STORAGE를 막아 둔 상태 그대로 동작)

// 저장 결과 (saved: 공유창까지 열림, unsupported: 모듈 없는 이전 빌드, failed: 다운로드·공유 실패)
export type ContractPdfSaveResult = 'saved' | 'unsupported' | 'failed'

// fileName: 확장자를 뺀 저장 파일명 (예: ㅇㅇ요양원_홍길동_000000_근로계약서)
export async function saveContractPdf(pdfUrl: string, fileName: string): Promise<ContractPdfSaveResult> {
  // 파일 시스템·공유 네이티브 모듈이 없는 이전 빌드는 불러오지 않고 안내만 표시 (불러오면 앱이 종료됨)
  if (!requireOptionalNativeModule('FileSystem') || !requireOptionalNativeModule('ExpoSharing')) {
    Alert.alert('업데이트 필요', 'PDF 저장은 앱을 최신 버전으로 업데이트한 뒤 이용할 수 있습니다.')
    return 'unsupported'
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sharing = require('expo-sharing') as typeof import('expo-sharing')

  try {
    if (!(await Sharing.isAvailableAsync())) {
      Alert.alert('저장 불가', '이 기기에서는 파일 공유 기능을 사용할 수 없습니다.')
      return 'failed'
    }

    // 공유창·파일 앱에 보이는 이름 그대로 임시 파일 저장 (같은 계약서를 다시 저장하면 기존 임시 파일을 덮어씀)
    const target = new File(Paths.cache, `${fileName}.pdf`)
    const downloaded = await File.downloadFileAsync(pdfUrl, target, { idempotent: true })

    await Sharing.shareAsync(downloaded.uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: '근로계약서 PDF 저장',
    })
    return 'saved'
  } catch (error) {
    // 서버 응답 오류(4xx·5xx)는 다운로드 단계에서 예외로 들어옴
    console.warn('[계약서 PDF 저장 실패]', error)
    Alert.alert('저장 실패', 'PDF를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    return 'failed'
  }
}
