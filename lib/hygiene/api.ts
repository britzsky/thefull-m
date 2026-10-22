import { requireOptionalNativeModule } from 'expo'

import { API_BASE_URL, api } from '@/lib/api/client'

// 앱 위생점검 API (카테고리 설정은 tb_account_hygiene_category, 점검 기록은 tb_account_hygiene_management)
// 점검 기록 한 행 = 조치 전 사진·전달 메모 + 조치 후 사진·조치 메모 한 쌍 (웹 위생관리 한 줄과 동일)

// 위생점검 카테고리 설정 (화면용)
export type HygieneCategory = {
  key: string
  title: string
  description: string
  // 상세 화면 점검 안내의 관리 포인트 문구
  managePoint: string
  // 목록 토글 상태, 꺼지면 점검 화면 전체에서 숨김
  visible: boolean
  // 전체 요약 카드 목록 표시 여부
  showOnMain: boolean
  // 전체 요약 카드 점검 상태 배지 표시 여부
  showStatus: boolean
}

// 카테고리 설정 조회 응답 행
type HygieneCategoryRow = {
  category_key?: string
  category_name?: string
  description?: string
  manage_point?: string
  use_yn?: string
  main_yn?: string
  status_yn?: string
}

// 거래처 점검 기록 한 행 (조치 전·후 한 쌍, 조회 응답·저장 요청 공통)
export type HygieneCheckRow = {
  idx: number | null
  category_key: string
  problem_image: string
  problem_note: string
  clean_image: string
  clean_note: string
  note: string
  // 등록 일자·사용자 (조치 전 사진·전달 메모 저장 기준)
  reg_dt?: string
  reg_user_id?: string
  // 조치 일자·사용자 (조치 후 사진·조치 메모 저장 기준)
  mod_dt?: string
  mod_user_id?: string
  // 조회 응답 전용 사용자명
  reg_user_name?: string
  mod_user_name?: string
}

// 저장·업로드 API 공통 응답
type MessagePayload = {
  code?: string | number
  message?: string
  image_path?: string
}

// 날짜를 yyyy-mm-dd 문자열로 변환 (기기 현지 날짜 기준)
export function toDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

// 'Y'/'N' 값을 boolean으로 변환 (값이 없으면 기본 Y)
const isYes = (value: unknown) => String(value ?? 'Y').toUpperCase() !== 'N'

// boolean 값을 'Y'/'N'으로 변환
const toYn = (value: boolean) => (value ? 'Y' : 'N')

// 저장·업로드 응답 성공 여부 확인, 실패 시 예외
function assertSuccess(response: MessagePayload, failMessage: string) {
  if (String(response?.code ?? '') !== '200') {
    throw new Error(response?.message || failMessage)
  }
}

// 서버 사진 경로를 화면 표시용 전체 URL로 변환
export function toHygieneImageUrl(path: string) {
  if (!path) {
    return ''
  }

  return /^(https?|file|content):/i.test(path) ? path : `${API_BASE_URL}${path}`
}

// 거래처별 카테고리 설정 조회 (저장된 설정이 없으면 빈 배열)
export async function fetchHygieneCategories(accountId: string): Promise<HygieneCategory[]> {
  const response = await api.get<HygieneCategoryRow[]>('/Operate/HygieneCategoryList', {
    account_id: accountId,
  })

  return Array.isArray(response)
    ? response.map((row) => ({
        key: String(row.category_key ?? ''),
        title: String(row.category_name ?? ''),
        description: String(row.description ?? ''),
        managePoint: String(row.manage_point ?? ''),
        visible: isYes(row.use_yn),
        showOnMain: isYes(row.main_yn),
        showStatus: isYes(row.status_yn),
      }))
    : []
}

// 거래처 카테고리 목록 전체 저장 (목록 순서가 표시 순서)
export async function saveHygieneCategories(accountId: string, categories: HygieneCategory[]) {
  const response = await api.post<MessagePayload>('/Operate/HygieneCategorySave', {
    account_id: accountId,
    categories: categories.map((category) => ({
      category_key: category.key,
      category_name: category.title,
      description: category.description,
      manage_point: category.managePoint,
      use_yn: toYn(category.visible),
      main_yn: toYn(category.showOnMain),
      status_yn: toYn(category.showStatus),
    })),
  })

  assertSuccess(response, '카테고리 저장에 실패했습니다.')
}

// 거래처 점검 기록 누적 조회 (날짜 구분 없이 전체, 카테고리별 여러 행, 등록일자 → 등록 순서)
export async function fetchHygieneChecks(accountId: string) {
  const response = await api.get<HygieneCheckRow[]>('/Operate/HygieneCheckList', {
    account_id: accountId,
  })

  return Array.isArray(response) ? response : []
}

// 업로드 사진 긴 변 최대 크기(px), 웹 위생관리 업로드 축소와 같은 기준
const UPLOAD_MAX_SIZE = 1600

// 업로드 전 사진 축소 (긴 변 최대 1600px, JPEG 80% 품질, 실패하면 원본 경로 반환)
// 축소 모듈은 네이티브 모듈이 설치된 빌드에서만 불러옴 (없는 이전 빌드는 원본 그대로 업로드)
async function resizeHygienePhoto(localUri: string) {
  if (!requireOptionalNativeModule('ExpoImageManipulator')) {
    return localUri
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator')
    const original = await ImageManipulator.manipulate(localUri).renderAsync()
    const context = ImageManipulator.manipulate(original)
    if (Math.max(original.width, original.height) > UPLOAD_MAX_SIZE) {
      context.resize(original.width >= original.height ? { width: UPLOAD_MAX_SIZE } : { height: UPLOAD_MAX_SIZE })
    }
    const resized = await context.renderAsync()
    const result = await resized.saveAsync({ compress: 0.8, format: SaveFormat.JPEG })
    return result.uri
  } catch (error) {
    console.warn('사진 축소 실패, 원본으로 업로드:', error)
    return localUri
  }
}

// 카메라로 촬영한 사진 1장을 축소해 업로드하고 서버 사진 경로 반환 (웹 위생관리와 같은 hygiene/업로드일/거래처 폴더)
export async function uploadHygienePhoto(localUri: string, uploadDate: string, accountId: string) {
  const uploadUri = await resizeHygienePhoto(localUri)
  const formData = new FormData()
  const fileName = localUri.split('/').pop() || `hygiene_${Date.now()}.jpg`

  // React Native FormData 파일 항목 (uri·name·type 형식)
  formData.append('file', { uri: uploadUri, name: fileName, type: 'image/jpeg' } as unknown as Blob)
  formData.append('type', 'hygiene')
  formData.append('gubun', uploadDate)
  formData.append('folder', accountId)

  const response = await fetch(`${API_BASE_URL}/Operate/OperateImgUpload`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: formData,
  })
  const payload = (await response.json().catch(() => ({}))) as MessagePayload

  assertSuccess(payload, '사진 업로드에 실패했습니다.')

  return payload.image_path ?? ''
}

// 점검 기록 행 저장 (웹 위생관리와 같은 HygieneSave API, idx가 있으면 수정, deleted가 true면 삭제 처리)
// reg_dt·reg_user_id / mod_dt·mod_user_id는 값을 보낸 행만 갱신 (보내지 않으면 기존 값 유지)
export async function saveHygieneRows(accountId: string, rows: (HygieneCheckRow & { deleted?: boolean })[]) {
  const response = await api.post<MessagePayload>(
    '/Operate/HygieneSave',
    rows.map(({ deleted, ...row }) => ({
      ...row,
      account_id: accountId,
      del_yn: deleted ? 'Y' : 'N',
    }))
  )

  assertSuccess(response, '점검 내용 저장에 실패했습니다.')
}
