import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import { buildPreviewScripts, PREVIEW_HTML, previewKindOf } from '@/lib/branchUpload/documentPreview'
import { font } from '@/lib/fonts'

// 식단표 엑셀·PDF 앱 안 미리보기 (파일을 받아 WebView에서 PDF는 페이지, 엑셀은 표로 표시)

// 파일 받기 시도 횟수와 간격 (ms)
const DOWNLOAD_ATTEMPTS = 3
const RETRY_DELAY = 1000
// 표시 완료 신호를 기다리는 최대 시간 (ms)
const RENDER_TIMEOUT = 60000

// 한글·공백 파일명을 요청 가능한 주소로 변환 (이미 인코딩된 주소는 그대로)
function toRequestUrl(uri: string) {
  return /%[0-9a-f]{2}/i.test(uri) ? uri : encodeURI(uri).replace(/#/g, '%23')
}

// 파일을 받아 base64 문자열로 반환 (통신 실패 시 재시도)
async function downloadBase64(uri: string) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetch(toRequestUrl(uri))
      if (!response.ok) throw new Error(`파일 조회 실패 (${response.status})`)
      const blob = await response.blob()

      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'))
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
        reader.readAsDataURL(blob)
      })
    } catch (error) {
      if (attempt >= DOWNLOAD_ATTEMPTS) throw error
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
    }
  }
}

export default function MenuDocumentViewer({ uri }: { uri: string }) {
  const webViewRef = useRef<WebView>(null)
  // 받은 파일 내용과 WebView 틀 준비 여부 (둘 다 갖춰지면 표시 시작)
  const base64Ref = useRef('')
  const isShellLoadedRef = useRef(false)
  // 화면 상태 (loading: 불러오는 중, ready: 표시 완료, error: 실패)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  // 다시 시도 시 WebView를 새로 만들기 위한 번호
  const [attempt, setAttempt] = useState(0)

  // WebView에 라이브러리·파일을 차례로 넣어 표시 시작
  const startRender = useCallback(() => {
    if (!base64Ref.current || !isShellLoadedRef.current) return

    const scripts = buildPreviewScripts(previewKindOf(uri), base64Ref.current)
    base64Ref.current = ''
    scripts.forEach((script) => webViewRef.current?.injectJavaScript(script))
  }, [uri])

  // 미리보기를 열거나 다시 시도할 때 파일 받기, 제한 시간 안에 표시되지 않으면 실패 처리
  useEffect(() => {
    let active = true
    setStatus('loading')
    const timer = setTimeout(() => {
      if (active) setStatus((current) => (current === 'loading' ? 'error' : current))
    }, RENDER_TIMEOUT)

    downloadBase64(uri)
      .then((base64) => {
        if (!active) return
        base64Ref.current = base64
        startRender()
      })
      .catch(() => {
        if (active) setStatus('error')
      })

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [uri, attempt, startRender])

  // WebView 안 진행 신호 처리 (loaded: 틀 준비, ready: 표시 완료, 그 외: 실패)
  const handleMessage = (event: WebViewMessageEvent) => {
    const message = event.nativeEvent.data
    if (message === 'loaded') {
      isShellLoadedRef.current = true
      startRender()
    } else {
      setStatus(message === 'ready' ? 'ready' : 'error')
    }
  }

  // 다시 시도 버튼 처리 (WebView를 새로 만들고 파일을 다시 받음)
  const handleRetry = () => {
    isShellLoadedRef.current = false
    setAttempt((current) => current + 1)
  }

  return (
    <View style={styles.container}>
      <WebView
        key={attempt}
        ref={webViewRef}
        originWhitelist={['*']}
        source={{ html: PREVIEW_HTML }}
        onMessage={handleMessage}
        onError={() => setStatus('error')}
      />
      {/* 불러오는 중 로딩 표시 */}
      {status === 'loading' ? (
        <View style={styles.cover}>
          <ActivityIndicator size="large" color="#1593c4" />
          <Text style={styles.message}>식단표를 불러오는 중입니다</Text>
        </View>
      ) : null}
      {/* 표시 실패 안내와 다시 시도 버튼 */}
      {status === 'error' ? (
        <View style={styles.cover}>
          <Text style={styles.message}>식단표를 불러오지 못했습니다.</Text>
          <Pressable style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryText}>다시 시도</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

// 식단표 미리보기 스타일
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  cover: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
  },
  message: {
    color: '#52606d',
    fontSize: 16,
    fontFamily: font.medium,
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#1593c4',
  },
  retryText: {
    color: '#ffffff',
    fontSize: 16,
    fontFamily: font.bold,
  },
})
