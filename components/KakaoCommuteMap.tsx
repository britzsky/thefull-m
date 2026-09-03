import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'

import type { AttendanceTarget } from '@/lib/attendance/api'

type KakaoCommuteMapProps = {
  target: AttendanceTarget | null
  currentLocation: {
    latitude: number
    longitude: number
  } | null
  accountName: string
  radius: number
}

type MapMessage = {
  type?: string
  message?: string
}

const KAKAO_MAP_KEY = process.env.EXPO_PUBLIC_KAKAO_MAP_KEY ?? ''
const KAKAO_MAP_BASE_URL = process.env.EXPO_PUBLIC_KAKAO_MAP_BASE_URL ?? 'https://thefull.kr'

function createMapHtml(appKey: string) {
  return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
    <style>
      html, body, #map { width: 100%; height: 100%; margin: 0; padding: 0; overflow: hidden; background: #eef2f5; }
      .current-marker { width: 18px; height: 18px; border-radius: 50%; background: #3b82f6; border: 3px solid #fff; box-shadow: 0 1px 6px rgba(0,0,0,.35); }
      #error { display: none; position: fixed; inset: 0; align-items: center; justify-content: center; padding: 24px; color: #e5566b; background: #f7f7fa; font: 13px sans-serif; text-align: center; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <div id="error"></div>
    <script>
      (function () {
        var map = null;
        var workMarker = null;
        var workCircle = null;
        var currentOverlay = null;
        var pendingPayload = null;

        function notify(type, message) {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, message: message || '' }));
          }
        }

        function showError(message) {
          var error = document.getElementById('error');
          error.style.display = 'flex';
          error.textContent = message;
          notify('error', message);
        }

        window.updateCommuteMap = function (payload) {
          pendingPayload = payload;
          if (!map || !window.kakao || !window.kakao.maps) return;

          if (workMarker) workMarker.setMap(null);
          if (workCircle) workCircle.setMap(null);
          if (currentOverlay) currentOverlay.setMap(null);
          workMarker = null;
          workCircle = null;
          currentOverlay = null;

          if (!payload || !payload.target) {
            map.setCenter(new kakao.maps.LatLng(36.5, 127.8));
            map.setLevel(13);
            return;
          }

          var workPosition = new kakao.maps.LatLng(payload.target.latitude, payload.target.longitude);
          workMarker = new kakao.maps.Marker({ position: workPosition, map: map, title: payload.accountName || '근무지' });
          workCircle = new kakao.maps.Circle({
            center: workPosition,
            radius: payload.radius || 100,
            strokeWeight: 2,
            strokeColor: '#6C5DD3',
            strokeOpacity: 0.8,
            strokeStyle: 'shortdash',
            fillColor: '#6C5DD3',
            fillOpacity: 0.1,
            map: map
          });

          if (payload.currentLocation) {
            var currentPosition = new kakao.maps.LatLng(
              payload.currentLocation.latitude,
              payload.currentLocation.longitude
            );
            currentOverlay = new kakao.maps.CustomOverlay({
              position: currentPosition,
              content: '<div class="current-marker"></div>',
              yAnchor: 0.5,
              xAnchor: 0.5,
              zIndex: 5,
              map: map
            });
            var bounds = new kakao.maps.LatLngBounds();
            bounds.extend(workPosition);
            bounds.extend(currentPosition);
            map.setBounds(bounds, 60, 60, 60, 60);
          } else {
            map.setCenter(workPosition);
            map.setLevel(3);
          }
        };

        if (!${JSON.stringify(Boolean(appKey))}) {
          showError('카카오지도 JavaScript 키가 설정되지 않았습니다.');
          return;
        }

        var script = document.createElement('script');
        script.async = true;
        script.src = 'https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey=${appKey}';
        script.onload = function () {
          if (!window.kakao || !window.kakao.maps) {
            showError('카카오지도 SDK를 초기화하지 못했습니다.');
            return;
          }
          window.kakao.maps.load(function () {
            map = new kakao.maps.Map(document.getElementById('map'), {
              center: new kakao.maps.LatLng(36.5, 127.8),
              level: 13
            });
            map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
            if (pendingPayload) window.updateCommuteMap(pendingPayload);
            notify('ready');
          });
        };
        script.onerror = function () {
          showError('카카오지도 SDK를 불러오지 못했습니다. 도메인 등록 상태를 확인해 주세요.');
        };
        document.head.appendChild(script);
      })();
    </script>
  </body>
</html>`
}

export default function KakaoCommuteMap({
  target,
  currentLocation,
  accountName,
  radius,
}: KakaoCommuteMapProps) {
  const webViewRef = useRef<WebView>(null)
  const [isReady, setIsReady] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const html = useMemo(() => createMapHtml(KAKAO_MAP_KEY), [])
  const payload = useMemo(
    () => ({
      target: target
        ? { latitude: target.yCoordinate, longitude: target.xCoordinate }
        : null,
      currentLocation,
      accountName,
      radius,
    }),
    [accountName, currentLocation, radius, target]
  )

  useEffect(() => {
    if (!isReady) return
    webViewRef.current?.injectJavaScript(
      `window.updateCommuteMap(${JSON.stringify(payload)}); true;`
    )
  }, [isReady, payload])

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as MapMessage
      if (message.type === 'ready') {
        setIsReady(true)
        setErrorMessage('')
      } else if (message.type === 'error') {
        setErrorMessage(message.message || '카카오지도를 불러오지 못했습니다.')
      }
    } catch {
      setErrorMessage('카카오지도 응답을 확인하지 못했습니다.')
    }
  }

  return (
    <View style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ html, baseUrl: KAKAO_MAP_BASE_URL }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="never"
        setSupportMultipleWindows={false}
        onMessage={handleMessage}
        onError={() => setErrorMessage('카카오지도 화면을 불러오지 못했습니다.')}
        style={styles.webView}
      />

      {!isReady && !errorMessage ? (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator color="#6c5dd3" />
          <Text style={styles.loadingText}>카카오지도 불러오는 중</Text>
        </View>
      ) : null}

      {errorMessage ? (
        <View style={styles.errorOverlay} pointerEvents="none">
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#eef2f5' },
  webView: { flex: 1, backgroundColor: '#eef2f5' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(247,247,250,0.88)',
  },
  loadingText: { color: '#747b86', fontSize: 12, fontWeight: '700' },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#f7f7fa',
  },
  errorText: { color: '#e5566b', fontSize: 12, lineHeight: 18, textAlign: 'center' },
})
