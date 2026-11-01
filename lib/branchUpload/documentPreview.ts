import { EXCEL_PREVIEW_SCRIPT } from './excelPreviewScript'

// 식단표 엑셀·PDF 미리보기 WebView 구성 (라이브러리·파일을 앱에서 직접 넣어 인터넷 CDN 없이 표시)

// 미리보기 파일 종류
export type PreviewKind = 'pdf' | 'excel'

// WebView 한 번에 넣는 글자 수 (큰 내용을 나눠 넣어 안드로이드 전달 한도 회피)
const CHUNK_SIZE = 512 * 1024

// 파일 경로의 미리보기 종류 (엑셀 xls·xlsx, 그 외 PDF)
export function previewKindOf(path: string): PreviewKind {
  return /\.xlsx?$/i.test(path.split('?')[0]) ? 'excel' : 'pdf'
}

// 미리보기 틀 HTML (시트 탭 영역 + 본문 영역, 라이브러리·파일은 틀이 뜬 뒤 나눠서 전달)
export const PREVIEW_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #ffffff; color: #172431; font-family: -apple-system, sans-serif; }
  #view canvas { display: block; width: 100%; height: auto; margin-bottom: 8px; }
  /* 엑셀 화면: 상단 시트 탭·확대 축소 줄 고정, 아래 시트 본문만 스크롤 */
  #toolbar { display: none; }
  body.excel { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
  body.excel #toolbar { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; background: #f8f9fa; }
  body.excel #view { flex: 1; min-height: 0; overflow: auto; -webkit-overflow-scrolling: touch; }
  #tabs { flex: 1; min-width: 0; display: flex; gap: 4px; overflow-x: auto; }
  #tabs button { flex: none; height: 32px; padding: 0 12px; border: 1px solid #d0d7de; border-radius: 6px; background: #ffffff; color: #374151; font-size: 14px; font-weight: 500; white-space: nowrap; }
  #tabs button.active { border-color: #1e7b45; background: #e8f5e9; color: #1e7b45; font-weight: 700; }
  .tool { width: 32px; height: 32px; border: 1px solid #d0d7de; border-radius: 6px; background: #ffffff; color: #374151; font-size: 18px; line-height: 1; }
  #zoomLabel { width: 44px; text-align: center; font-size: 13px; color: #374151; }
</style></head>
<body>
<div id="toolbar"><div id="tabs"></div><button id="zoomOut" class="tool">−</button><span id="zoomLabel">100%</span><button id="zoomIn" class="tool">+</button></div>
<div id="view"></div>
<script>
  var parts = [];
  // 앱으로 진행 신호 전달 (loaded: 틀 준비, ready: 표시 완료, error: 표시 실패)
  function notify(message) { window.ReactNativeWebView.postMessage(message); }
  window.__push = function (chunk) { parts.push(chunk); };
  // 전달받은 라이브러리 코드 실행
  window.__runLib = function () { var code = parts.join(''); parts = []; (0, eval)(code); };
  // 전달받은 base64 내용을 파일 바이트로 변환
  function takeBytes() {
    var binary = atob(parts.join(''));
    parts = [];
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  // PDF 전체 페이지를 화면 폭에 맞춰 canvas로 표시
  async function renderPdf(bytes) {
    var pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false }).promise;
    var view = document.getElementById('view');
    for (var number = 1; number <= pdf.numPages; number += 1) {
      var page = await pdf.getPage(number);
      var width = page.getViewport({ scale: 1 }).width;
      var scale = Math.min((window.innerWidth * 2.5) / width, 3);
      var viewport = page.getViewport({ scale: scale });
      var canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      view.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
    }
  }
  // 전달받은 파일을 종류에 맞게 표시 (엑셀은 excelPreviewScript의 서식 미리보기)
  window.__render = function (kind) {
    Promise.resolve()
      .then(function () { var bytes = takeBytes(); return kind === 'pdf' ? renderPdf(bytes) : window.renderStyledExcel(bytes); })
      .then(function () { notify('ready'); })
      .catch(function (error) { notify('error:' + (error && error.message)); });
  };
  notify('loaded');
</script></body></html>`

// 긴 문자열을 WebView에 넣는 실행문 목록으로 분할
function pushScripts(text: string) {
  const scripts: string[] = []
  for (let start = 0; start < text.length; start += CHUNK_SIZE) {
    scripts.push(`window.__push(${JSON.stringify(text.slice(start, start + CHUNK_SIZE))});true;`)
  }
  return scripts
}

// 라이브러리 주입 → 파일 주입 → 표시 순서의 WebView 실행문 목록 생성
export function buildPreviewScripts(kind: PreviewKind, base64: string) {
  // 라이브러리 원본이 커서 미리보기를 열 때만 불러옴
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EXCELJS_LIB, PDF_LIB, PDF_WORKER_LIB, XLSX_LIB } = require('./previewLibs') as typeof import('./previewLibs')
  const libs = kind === 'pdf' ? [PDF_WORKER_LIB, PDF_LIB] : [EXCELJS_LIB, XLSX_LIB, EXCEL_PREVIEW_SCRIPT]

  return [
    ...libs.flatMap((lib) => [...pushScripts(lib), 'window.__runLib();true;']),
    ...pushScripts(base64),
    `window.__render(${JSON.stringify(kind)});true;`,
  ]
}
