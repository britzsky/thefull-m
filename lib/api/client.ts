const DEFAULT_API_URLS = {
  local: process.env.EXPO_PUBLIC_API_BASE_URL_LOCAL || 'http://localhost:9000',
  test: process.env.EXPO_PUBLIC_API_BASE_URL_TEST || 'http://172.30.1.48:8080/api',
  real: process.env.EXPO_PUBLIC_API_BASE_URL_REAL || 'https://52.64.151.137:8080/api',
} as const

type ApiTarget = keyof typeof DEFAULT_API_URLS

type QueryValue = string | number | boolean | null | undefined

type ApiErrorBody = {
  msg?: unknown
  reason?: unknown
}

const requestedTarget = (process.env.EXPO_PUBLIC_API_TARGET ?? 'local').toLowerCase()
const apiTarget: ApiTarget =
  requestedTarget === 'test' || requestedTarget === 'real' ? requestedTarget : 'local'

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_URLS[apiTarget]

if (__DEV__) {
  console.log(`[API] 연결 주소: ${API_BASE_URL}`)
}

export class ApiError extends Error {
  status: number
  reason: string | null

  constructor(message: string, status: number, reason: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.reason = reason
  }
}

function appendQuery(path: string, params?: Record<string, QueryValue>) {
  if (!params) {
    return path
  }

  const query = Object.entries(params)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&')

  if (!query) {
    return path
  }

  return `${path}${path.includes('?') ? '&' : '?'}${query}`
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const requestUrl = `${API_BASE_URL}${path}`
  let response: Response

  try {
    response = await fetch(requestUrl, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : '알 수 없는 네트워크 오류'
    const requestInfo = __DEV__ ? `\n요청 주소: ${requestUrl}` : ''
    throw new Error(`API 서버에 연결할 수 없습니다. ${reason}${requestInfo}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  const responseText = await response.text()
  let data: unknown = responseText

  // 일부 Spring API가 JSON 문자열을 text/plain으로 내려주므로 본문 모양도 함께 확인합니다.
  if (
    responseText &&
    (contentType.includes('application/json') || /^[\s]*[\[{]/.test(responseText))
  ) {
    try {
      data = JSON.parse(responseText)
    } catch {
      data = responseText
    }
  }

  if (!response.ok) {
    const errorBody = data && typeof data === 'object' ? (data as ApiErrorBody) : null
    const message =
      typeof data === 'string'
        ? data
        : typeof errorBody?.msg === 'string' && errorBody.msg.trim()
          ? errorBody.msg
          : `API 요청에 실패했습니다. (${response.status})`
    const reason = typeof errorBody?.reason === 'string' ? errorBody.reason : null

    throw new ApiError(message, response.status, reason)
  }

  return data as T
}

export const api = {
  get<T>(path: string, params?: Record<string, QueryValue>) {
    return request<T>(appendQuery(path, params), {
      method: 'GET',
    })
  },
  post<T>(path: string, body?: unknown) {
    return request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  },
}
