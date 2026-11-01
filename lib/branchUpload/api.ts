import { API_BASE_URL, api } from '@/lib/api/client'
import { resizeHygienePhoto } from '@/lib/hygiene/api'

// 앱 지점 업로드 API (웹 현장관리 > 지점업로드와 같은 tb_account_branch_upload 사용)
// 저장 구조: 거래처·일자당 1행(구분 '일일' 고정), 주간 식단표는 그 주 월요일 행에, 식판 사진은 날짜별 행에 저장

// 하루 1행 저장 시 쓰는 구분 값 (UNIQUE 키: 거래처+일자+구분)
const DAILY_MEAL_TYPE = '일일'

// 요일 표시명 (월요일 시작)
export const WEEK_DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일']

// 업로드 자료 종류 (menu: 주간 식단표, plate: 식판 사진)
export type BranchFileKind = 'menu' | 'plate'

// 지점 업로드 조회 행 (거래처·일자 1건)
export type BranchUploadRow = {
  idx?: number
  account_id: string
  account_name?: string
  meal_date: string
  meal_type?: string
  menu_file_path?: string | null
  menu_file_name?: string | null
  menu_reg_dt?: string | null
  plate_file_path?: string | null
  plate_file_name?: string | null
  plate_reg_dt?: string | null
}

// 주차 정보 (no: 그 달의 주차 번호, start: 월요일, end: 일요일, dates: 월~일 날짜)
export type BranchWeek = {
  no: number
  start: string
  end: string
  dates: string[]
}

// 저장·업로드 API 공통 응답
type MessagePayload = {
  code?: string | number
  message?: string
  image_path?: string
}

// 저장·업로드 응답 성공 여부 확인, 실패 시 예외
function assertSuccess(response: MessagePayload, failMessage: string) {
  if (String(response?.code ?? '') !== '200') {
    throw new Error(response?.message || failMessage)
  }
}

// yyyy-mm-dd 문자열을 기기 현지 날짜로 변환
function parseDateKey(key: string) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

// 날짜를 yyyy-mm-dd 문자열로 변환 (기기 현지 날짜 기준)
export function toDateKey(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

// 날짜 key에 일수를 더한 날짜 key
function addDays(key: string, days: number) {
  const date = parseDateKey(key)
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

// 날짜가 속한 주의 월요일 (일요일은 그 주의 마지막 날)
export function mondayOf(key: string) {
  return addDays(key, -((parseDateKey(key).getDay() + 6) % 7))
}

// 선택 연월의 주차 목록 (월요일이 그 달인 주만 포함, 월 경계 주는 월요일이 속한 달에서 일요일까지 표시)
// 웹 지점업로드 monthWeeks와 같은 기준
export function monthWeeks(year: number, month: number): BranchWeek[] {
  const first = toDateKey(new Date(year, month - 1, 1))
  const last = toDateKey(new Date(year, month, 0))
  const weeks: BranchWeek[] = []
  let monday = mondayOf(first)

  // 1일이 월요일이 아니면 그 주는 전월 주차이므로 다음 월요일부터 시작
  if (monday < first) monday = addDays(monday, 7)

  while (monday <= last) {
    weeks.push({
      no: weeks.length + 1,
      start: monday,
      end: addDays(monday, 6),
      dates: WEEK_DAY_LABELS.map((_, index) => addDays(monday, index)),
    })
    monday = addDays(monday, 7)
  }

  return weeks
}

// 날짜 key의 요일 표시명 (월~일)
export function weekdayOf(key: string) {
  return WEEK_DAY_LABELS[(parseDateKey(key).getDay() + 6) % 7]
}

// "10.26" 형식 월·일 문자열
export function formatMonthDay(key: string) {
  return `${Number(key.slice(5, 7))}.${key.slice(8, 10)}`
}

// "10.26 (월) ~ 11.01 (일)" 형식 주차 기간 문자열
export function formatWeekRange(week: BranchWeek) {
  return `${formatMonthDay(week.start)} (월) ~ ${formatMonthDay(week.end)} (일)`
}

// 서버 파일 경로를 화면 표시용 전체 URL로 변환
export function toBranchFileUrl(path?: string | null) {
  if (!path) {
    return ''
  }

  return /^(https?|file|content):/i.test(path) ? path : `${API_BASE_URL}${path}`
}

// 파일 경로가 사진인지 여부 (식단표는 엑셀·PDF도 있어 미리보기 구분용)
export function isImagePath(path?: string | null) {
  return /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(path || '')
}

// 거래처의 기간 내 지점 업로드 행 조회 (start_date ~ end_date)
export async function fetchBranchUploads(accountId: string, startDate: string, endDate: string) {
  const response = await api.get<BranchUploadRow[]>('/Operate/BranchUploadList', {
    account_id: accountId,
    start_date: startDate,
    end_date: endDate,
  })

  return Array.isArray(response) ? response : []
}

// 선택 연·월의 공휴일 날짜 목록 조회 (ERP 달력과 같은 tb_holiday 기준, yyyy-mm-dd)
export async function fetchHolidayDates(year: number, month: number) {
  const response = await api.get<{ holiday_date?: string }[]>('/Operate/HolidayList', { year, month })

  return Array.isArray(response) ? response.map((row) => String(row.holiday_date ?? '')).filter(Boolean) : []
}

// 기기에서 고른 문서 파일 정보 (엑셀·PDF 식단표, name: 원본 파일명, mimeType: 파일 형식)
export type BranchDocument = {
  name: string
  mimeType?: string | null
}

// 파일 1개를 서버에 올리고 저장 경로 반환 (웹과 같은 branch_upload/연월/거래처 폴더)
// 사진은 축소해서, 문서(엑셀·PDF)는 원본 그대로 업로드
async function uploadBranchFile(localUri: string, accountId: string, mealDate: string, document?: BranchDocument) {
  const uploadUri = document ? localUri : await resizeHygienePhoto(localUri)
  const formData = new FormData()
  const fileName = document?.name || localUri.split('/').pop() || `branch_${Date.now()}.jpg`
  const mimeType = document ? document.mimeType || 'application/octet-stream' : 'image/jpeg'

  // React Native FormData 파일 항목 (uri·name·type 형식)
  formData.append('file', { uri: uploadUri, name: fileName, type: mimeType } as unknown as Blob)
  formData.append('type', 'branch_upload')
  formData.append('gubun', mealDate.slice(0, 7).replace('-', ''))
  formData.append('folder', accountId)

  const response = await fetch(`${API_BASE_URL}/Operate/OperateImgUpload`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: formData,
  })
  const payload = (await response.json().catch(() => ({}))) as MessagePayload

  assertSuccess(payload, '사진 업로드에 실패했습니다.')

  return { path: payload.image_path ?? '', name: fileName }
}

// 거래처·일자 1건에 식단표 또는 식판 사진을 올리고 경로 저장 (같은 건이 있으면 보낸 자료만 교체)
// 식단표는 그 주 월요일 날짜로 호출, 엑셀·PDF 식단표는 document에 파일 정보 전달
export async function saveBranchPhoto(
  kind: BranchFileKind,
  localUri: string,
  accountId: string,
  mealDate: string,
  userId: string,
  document?: BranchDocument
) {
  const file = await uploadBranchFile(localUri, accountId, mealDate, document)
  const response = await api.post<MessagePayload>('/Operate/BranchUploadSave', {
    account_id: accountId,
    meal_date: mealDate,
    meal_type: DAILY_MEAL_TYPE,
    user_id: userId,
    [`${kind}_file_path`]: file.path,
    [`${kind}_file_name`]: file.name,
  })

  assertSuccess(response, '저장에 실패했습니다.')
}

// 거래처·일자 1건의 식단표 또는 식판 사진 경로를 비우는 함수 (둘 다 비면 서버에서 행 삭제 처리)
export async function deleteBranchFile(kind: BranchFileKind, accountId: string, mealDate: string, userId: string) {
  const response = await api.post<MessagePayload>('/Operate/BranchUploadSave', {
    account_id: accountId,
    meal_date: mealDate,
    meal_type: DAILY_MEAL_TYPE,
    user_id: userId,
    [`${kind}_delete`]: 'Y',
  })

  assertSuccess(response, '삭제에 실패했습니다.')
}
