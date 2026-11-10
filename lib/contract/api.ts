import { api, API_BASE_URL } from '@/lib/api/client'
import type { AppSession, CookIdentity } from '@/lib/auth/storage'

// 앱 전자계약 API (ERP 인사 > 근로계약서에서 저장한 tb_account_contract 조회)
// 본인 확인: 영양사는 ERP 아이디(직원 정보의 user_id), 조리사/조리원은 거래처 + 이름 + 휴대폰 뒷자리로 직원 정보(tb_account_members)와 맞춰 본다

// 본인 계약서 목록 1건
export type ContractRow = {
  contract_id: number | string
  account_id: string
  account_name?: string
  // 근로자 성명 (서명본 PDF 저장 파일명용)
  name?: string
  contract_kind: string
  contract_start_dt: string
  contract_end_dt?: string | null
  // 진행 상태 (미확인, 확인, 서명완료)
  status: string
  // 같은 직원의 더 나중 서명완료 계약서가 있는 이전 서명본이면 'Y'
  replaced_yn?: string
  reg_dt?: string
  sign_dt?: string | null
}

// 계약서 조회 본인 정보 (staff: 본사/영양사 ERP 아이디, cook: 조리사/조리원 로그인 정보, birth6: 주민번호 앞 6자리)
export type ContractIdentity = ({ kind: 'staff'; userId: string } | { kind: 'cook'; cook: CookIdentity }) & {
  birth6: string
}

// 본인 확인용 조회 조건
function identityParams(identity: ContractIdentity) {
  if (identity.kind === 'staff') {
    return { user_id: identity.userId, birth6: identity.birth6 }
  }
  return {
    account_id: identity.cook.accountId,
    user_name: identity.cook.userName,
    phone_last4: identity.cook.phoneLast4,
    birth6: identity.birth6,
  }
}

// 로그인한 본인의 계약서 목록 조회
export async function fetchMyContracts(identity: ContractIdentity) {
  const response = await api.get<ContractRow[]>('/Operate/AppContractList', identityParams(identity))
  return Array.isArray(response) ? response : []
}

// 서명 전 본인 계약서 수 조회 (홈 화면 안내·앱 아이콘 배지용, 푸시 알림과 같은 본인 기준이라 주민번호 확인 없이 건수만 받음, 실패하면 null)
export async function fetchUnsignedContractCount(session: NonNullable<AppSession>) {
  const params =
    session.mode === 'staff'
      ? { user_id: session.staff.userId }
      : {
          account_id: session.cook.accountId,
          user_name: session.cook.userName,
          phone_last4: session.cook.phoneLast4,
        }
  const response = await api
    .get<{ count?: number | string }>('/Operate/AppContractUnsignedCount', params)
    .catch(() => null)
  return response ? Number(response.count ?? 0) || 0 : null
}

// 서버 응답 코드를 담은 오류 (404: ERP에서 회수(삭제)됐거나 본인 계약서가 아님)
function contractError(code: string | number | undefined, message: string) {
  return Object.assign(new Error(message), { code: String(code ?? '') })
}

// 회수된 계약서 응답인지 확인 (본인 확인을 마친 화면에서 404면 ERP에서 회수된 것)
export function isRecalledError(error: unknown) {
  return (error as { code?: string } | null)?.code === '404'
}

// 열어 둔 사이 회사에서 계약 내용을 수정해 서명이 막힌 응답인지 확인 (412)
export function isContentChangedError(error: unknown) {
  return (error as { code?: string } | null)?.code === '412'
}

// 계약서 보기 내용 (html: 화면 양식, contentVersion: 서명 전 계약서의 내용 지문, 서명할 때 그대로 다시 보냄)
export type ContractView = { html: string; contentVersion: string }

// 본인 계약서 1건을 엑셀 양식과 같은 HTML로 조회 (처음 열면 ERP에서 '확인' 상태로 바뀜)
export async function fetchMyContractHtml(identity: ContractIdentity, contractId: number | string): Promise<ContractView> {
  const response = await api.get<{
    code?: string | number
    message?: string
    html?: string
    content_version?: string | null
  }>('/Operate/AppContractHtml', {
    ...identityParams(identity),
    contract_id: contractId,
  })
  if (String(response?.code ?? '') !== '200' || !response?.html) {
    throw contractError(response?.code, response?.message || '계약서를 불러오지 못했습니다.')
  }
  return { html: response.html, contentVersion: response.content_version ?? '' }
}

// 본인 계약서에 동의·손가락 서명을 저장 (서버에서 서명본 PDF를 만들고 서명완료 처리)
// contentVersion: 근로자가 본 계약 내용의 지문 (서버의 현재 내용과 다르면 412로 서명이 막힘)
export async function signMyContract(
  identity: ContractIdentity,
  contractId: number | string,
  contentVersion: string,
  signImage: string,
  signDevice: string,
) {
  const response = await api.post<{ code?: string | number; message?: string }>('/Operate/AppContractSign', {
    ...identityParams(identity),
    contract_id: contractId,
    content_version: contentVersion,
    agree_yn: 'Y',
    sign_image: signImage,
    sign_device: signDevice,
  })
  if (String(response?.code ?? '') !== '200') {
    throw contractError(response?.code, response?.message || '서명을 저장하지 못했습니다.')
  }
}

// 본인 서명본 PDF 내려받기 주소 (PDF 저장 시 이 주소에서 파일을 받음)
export function myContractPdfUrl(identity: ContractIdentity, contractId: number | string) {
  const query = Object.entries({ ...identityParams(identity), contract_id: String(contractId) })
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value ?? ''))}`)
    .join('&')
  return `${API_BASE_URL}/Operate/AppContractPdf?${query}`
}
