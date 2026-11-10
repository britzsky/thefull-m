import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { router, useNavigation } from 'expo-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'

import Badge from '@/components/Badge'
import { getCommuteDeviceName, getOrCreateCommuteDeviceToken } from '@/lib/attendance/storage'
import { getAppSession } from '@/lib/auth/storage'
import {
  ContractIdentity,
  ContractRow,
  fetchMyContractHtml,
  fetchMyContracts,
  isContentChangedError,
  isRecalledError,
  myContractPdfUrl,
  signMyContract,
} from '@/lib/contract/api'
import { saveContractPdf } from '@/lib/contract/pdf'
import { syncAppBadge } from '@/lib/push'
import { font } from '@/lib/fonts'
import { usePullRefresh } from '@/lib/usePullRefresh'

// 전자계약 화면 (내 계약서 목록 → 계약서 보기)
// ERP 인사 > 근로계약서에서 회사가 저장한 계약서를 원본 엑셀 양식 그대로 보여준다 (영양사·조리사/조리원 본인 건만)

// 화면 단계 (loading: 세션·목록 조회 중, verify: 주민번호 앞 6자리 확인, list: 내 계약서 목록, view: 계약서 보기, sign: 동의·서명)
type Step = 'loading' | 'verify' | 'list' | 'view' | 'sign'

// 서명 동의 항목 (모두 체크해야 서명 가능, 전자문서 교부 동의는 노동부 전자근로계약서 가이드라인 기준)
const AGREE_ITEMS = [
  '근로계약서의 내용을 모두 확인했으며, 이에 동의합니다.',
  '근로계약서를 전자문서로 교부받는 것에 동의합니다.',
  '서명한 근로계약서와 서명 정보(서명 이미지·서명 일시·기기)가 최대 5년간 보관될 수 있음에 동의합니다.',
]

// 손가락 서명칸 HTML (캔버스에 그린 서명을 투명 배경 PNG로 앱에 전달)
// 앱에서 window.sendSign()을 호출하면 서명이 없을 때 'empty', 있으면 서명한 부분만 잘라낸 PNG data URL을 보낸다
// (빈 여백까지 보내면 PDF 서명칸에 줄여 넣을 때 획이 너무 가늘어져 보이지 않음)
// 안드로이드 WebView는 처음 뜰 때 높이가 0일 수 있어, 화면 크기가 바뀌거나 서명을 시작할 때 캔버스 크기를 다시 맞춘다 (그린 뒤에는 지워지지 않게 유지)
const SIGN_PAD_HTML = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;background:#fff;overflow:hidden;touch-action:none}canvas{display:block;width:100%;height:100%}
.guide{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;color:#c5ced6;font:16px sans-serif;pointer-events:none}</style></head>
<body><div class="guide" id="guide">이곳에 서명해 주세요</div><canvas id="pad"></canvas><script>
var c=document.getElementById('pad'),g=c.getContext('2d'),drawn=false,last=null,box=null;
function size(){c.width=c.clientWidth;c.height=c.clientHeight;g.lineWidth=5;g.lineCap='round';g.lineJoin='round';g.strokeStyle='#111';}
size();
function fit(){if(!drawn&&(c.width!==c.clientWidth||c.height!==c.clientHeight))size();}
window.addEventListener('resize',fit);
function pos(e){var t=e.touches?e.touches[0]:e,r=c.getBoundingClientRect();return{x:t.clientX-r.left,y:t.clientY-r.top};}
function start(e){e.preventDefault();fit();last=pos(e);document.getElementById('guide').style.display='none';}
function grow(p){box=box?{x1:Math.min(box.x1,p.x),y1:Math.min(box.y1,p.y),x2:Math.max(box.x2,p.x),y2:Math.max(box.y2,p.y)}:{x1:p.x,y1:p.y,x2:p.x,y2:p.y};}
function move(e){if(!last)return;e.preventDefault();var p=pos(e);g.beginPath();g.moveTo(last.x,last.y);g.lineTo(p.x,p.y);g.stroke();grow(last);grow(p);last=p;drawn=true;}
function end(){last=null;}
c.addEventListener('touchstart',start,{passive:false});c.addEventListener('touchmove',move,{passive:false});c.addEventListener('touchend',end);
c.addEventListener('mousedown',start);c.addEventListener('mousemove',move);window.addEventListener('mouseup',end);
window.clearSign=function(){g.clearRect(0,0,c.width,c.height);drawn=false;box=null;document.getElementById('guide').style.display='block';};
window.sendSign=function(){if(!drawn){window.ReactNativeWebView.postMessage('empty');return;}
var m=8,x=Math.max(0,Math.floor(box.x1-m)),y=Math.max(0,Math.floor(box.y1-m)),w=Math.min(c.width,Math.ceil(box.x2+m))-x,h=Math.min(c.height,Math.ceil(box.y2+m))-y;
var t=document.createElement('canvas');t.width=w;t.height=h;t.getContext('2d').drawImage(c,x,y,w,h,0,0,w,h);
window.ReactNativeWebView.postMessage(t.toDataURL('image/png'));};
</script></body></html>`


// 진행 상태별 배지 색상 (미확인: 주황, 확인: 파랑, 서명완료: 초록)
const STATUS_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  미확인: { label: '새 계약서', bg: '#fdf1e6', fg: '#d9822b' },
  확인: { label: '확인함', bg: '#eaf5fa', fg: '#1687b2' },
  서명완료: { label: '서명완료', bg: '#eaf7ef', fg: '#2a7a49' },
  // 새 계약서로 다시 서명해 효력이 바뀐 이전 서명본 (회색)
  이전계약: { label: '이전 계약', bg: '#eceff1', fg: '#7a8998' },
}

// yyyy-mm-dd를 yyyy.mm.dd로 표시
const dotDate = (value?: string | null) => (value ? value.replace(/-/g, '.') : '')

export default function ContractScreen() {
  const { width } = useWindowDimensions()
  const isTablet = width >= 768

  // 현재 화면 단계
  const [step, setStep] = useState<Step>('loading')
  // 로그인한 본인 정보 (영양사: ERP 아이디, 조리사/조리원: 거래처·이름·휴대폰 뒷자리)
  const [identity, setIdentity] = useState<ContractIdentity | null>(null)
  // 내 계약서 목록
  const [contracts, setContracts] = useState<ContractRow[]>([])
  // 보고 있는 계약서 양식 HTML
  const [contractHtml, setContractHtml] = useState('')
  // 보고 있는 계약서의 내용 지문 (서명할 때 서버로 보내 열람 후 내용이 바뀌지 않았는지 확인)
  const [contentVersion, setContentVersion] = useState('')
  // 계약서 WebView 실제 폭 (아이폰 배율 계산용, 측정 전에는 창 폭으로 추정)
  const [webWidth, setWebWidth] = useState(0)
  // 계약서 HTML 조회 중 여부
  const [isOpening, setIsOpening] = useState(false)
  // 본인 확인 입력값 (주민번호 앞 6자리)
  const [birthInput, setBirthInput] = useState('')
  // 본인 확인 조회 중 여부
  const [isVerifying, setIsVerifying] = useState(false)
  // 보고 있는 계약서 1건 (서명 여부에 따라 하단 버튼이 서명하기 / PDF 저장으로 바뀜)
  const [openedRow, setOpenedRow] = useState<ContractRow | null>(null)
  // 동의 항목 체크 여부 (AGREE_ITEMS 순서)
  const [agreeChecks, setAgreeChecks] = useState<boolean[]>(AGREE_ITEMS.map(() => false))
  // 서명 저장 중 여부
  const [isSigning, setIsSigning] = useState(false)
  // 서명 요청 진행 중 잠금 (빠르게 두 번 눌러 화면이 다시 그려지기 전에 들어오는 중복 요청 차단)
  const signingRef = useRef(false)
  // PDF 내려받는 중 여부
  const [isSavingPdf, setIsSavingPdf] = useState(false)
  // 서명칸 WebView (서명 지우기·서명 이미지 요청에 사용)
  const signPadRef = useRef<WebView>(null)

  // 내 계약서 목록을 다시 조회하는 함수 (조회한 목록을 반환)
  const loadContracts = useCallback(async (me: ContractIdentity) => {
    try {
      const rows = await fetchMyContracts(me)
      setContracts(rows)
      // 본인 확인된 목록이면 앱 아이콘 배지를 서명 전 계약서 수로 맞춤 (서명 직후 바로 줄어들게)
      if (rows.length > 0) {
        syncAppBadge(rows.filter((row) => row.status !== '서명완료').length)
      }
      return rows
    } catch {
      Alert.alert('조회 실패', '계약서 목록을 불러오지 못했습니다.')
      setContracts([])
      return []
    }
  }, [])

  // 회수 등으로 바뀐 내 계약서 목록을 오류 창 없이 다시 조회 (실패하면 null, 본인 확인을 마친 상태에서만 호출)
  const refreshContracts = useCallback(async (me: ContractIdentity) => {
    try {
      const rows = await fetchMyContracts(me)
      setContracts(rows)
      syncAppBadge(rows.filter((row) => row.status !== '서명완료').length)
      return rows
    } catch {
      return null
    }
  }, [])

  // 계약서 목록을 아래로 당겨 새로고침 (실패하면 조회 실패 안내)
  const pullRefresh = usePullRefresh(async () => {
    if (identity?.birth6) await loadContracts(identity)
  })

  // 보고 있던 계약서가 ERP에서 회수된 경우 안내 후 목록을 새로 받아 목록 화면으로 이동
  const showRecalled = useCallback(
    (me: ContractIdentity) => {
      setOpenedRow(null)
      setStep('list')
      void refreshContracts(me)
      Alert.alert('회수된 계약서', '회사에서 회수한 근로계약서입니다.\n새 계약서가 도착하면 다시 알려 드립니다.')
    },
    [refreshContracts],
  )

  // 열어 둔 사이 회사에서 계약 내용을 수정해 서명이 막힌 경우 안내 후 목록을 새로 받아 목록 화면으로 이동 (다시 열면 바뀐 내용으로 보임)
  const showContentChanged = useCallback(
    (me: ContractIdentity, message: string) => {
      setOpenedRow(null)
      setStep('list')
      void refreshContracts(me)
      Alert.alert('계약서 내용 변경', message)
    },
    [refreshContracts],
  )

  // 앱이 다시 화면에 올라오면 목록을 새로 받아 ERP 회수·추가를 반영 (보고 있던 계약서가 빠졌으면 회수 안내)
  useEffect(() => {
    if (!identity?.birth6 || step === 'verify' || step === 'loading') return
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      void refreshContracts(identity).then((rows) => {
        const opened = openedRow && (step === 'view' || step === 'sign')
        if (rows && opened && !rows.some((row) => String(row.contract_id) === String(openedRow.contract_id))) {
          showRecalled(identity)
        }
      })
    })
    return () => subscription.remove()
  }, [identity, step, openedRow, refreshContracts, showRecalled])

  // 화면 진입 시 로그인 정보 확인 후 본인 계약서 목록 조회
  useEffect(() => {
    let active = true
    void (async () => {
      const session = await getAppSession()
      if (!active) return
      if (!session) {
        router.replace('/login')
        return
      }
      const base: ContractIdentity =
        session.mode === 'cook'
          ? { kind: 'cook', cook: session.cook, birth6: '' }
          : { kind: 'staff', userId: session.staff.userId, birth6: '' }
      // 들어올 때마다 주민번호 앞 6자리 확인 화면부터 시작
      setIdentity(base)
      setStep('verify')
    })()
    return () => {
      active = false
    }
  }, [])

  // 주민번호 앞 6자리 확인 버튼 처리 (직원 정보 주민번호와 일치하는 계약서가 있으면 목록으로 이동)
  const handleVerify = async () => {
    if (!identity || isVerifying) return
    if (!/^[0-9]{6}$/.test(birthInput)) {
      Alert.alert('입력 확인', '주민등록번호 앞 6자리를 숫자로 입력해 주세요.')
      return
    }
    setIsVerifying(true)
    const me = { ...identity, birth6: birthInput }
    const rows = await loadContracts(me)
    setIsVerifying(false)
    if (rows.length === 0) {
      Alert.alert('확인 실패', '일치하는 근로계약서가 없습니다.\n주민등록번호 앞 6자리를 다시 확인해 주세요.')
      return
    }
    setIdentity(me)
    setStep('list')
  }

  // 목록에서 계약서를 눌렀을 때 양식 HTML을 불러와 보기 화면으로 이동
  const handleOpenContract = async (row: ContractRow) => {
    if (!identity || isOpening) return
    setIsOpening(true)
    try {
      const view = await fetchMyContractHtml(identity, row.contract_id)
      setContractHtml(view.html)
      setContentVersion(view.contentVersion)
      setOpenedRow(row)
      setStep('view')
    } catch (error) {
      if (isRecalledError(error)) {
        showRecalled(identity)
        return
      }
      Alert.alert('조회 실패', error instanceof Error ? error.message : '계약서를 불러오지 못했습니다.')
    } finally {
      setIsOpening(false)
    }
  }

  // 서명본 PDF를 내려받아 공유창(파일에 저장·카카오톡 등)을 여는 함수 (파일명: 요양원_성명_생년월일_근로계약서.pdf)
  const handleSavePdf = async (row: ContractRow) => {
    if (!identity || isSavingPdf) return
    setIsSavingPdf(true)
    // 파일명에 쓸 수 없는 문자(\ / : * ? " < > |)는 빼고 밑줄로 연결
    const fileName = [row.account_name, row.name, identity.birth6, '근로계약서']
      .map((part) => String(part ?? '').replace(/[\\/:*?"<>|]/g, '').trim())
      .filter(Boolean)
      .join('_')
    await saveContractPdf(myContractPdfUrl(identity, row.contract_id), fileName)
    setIsSavingPdf(false)
  }

  // 계약서 보기에서 서명하기를 눌렀을 때 동의·서명 화면으로 바로 이동
  // 그 사이 ERP에서 회수됐는지는 화면을 연 뒤 뒤에서 확인해 회수 안내 (서버 응답을 기다리지 않음)
  const handleStartSign = () => {
    setAgreeChecks(AGREE_ITEMS.map(() => false))
    setStep('sign')
    if (identity && openedRow) {
      void refreshContracts(identity).then((rows) => {
        if (rows && !rows.some((row) => String(row.contract_id) === String(openedRow.contract_id))) {
          showRecalled(identity)
        }
      })
    }
  }

  // 서명 완료 버튼 처리 (동의 확인 후 서명칸에 서명 이미지를 요청)
  const handleSubmitSign = () => {
    if (isSigning) return
    if (agreeChecks.some((checked) => !checked)) {
      Alert.alert('동의 확인', '동의 항목을 모두 체크해 주세요.')
      return
    }
    signPadRef.current?.injectJavaScript('window.sendSign(); true;')
  }

  // 서명칸에서 받은 서명 이미지를 서버에 저장 (서명본 PDF 생성)
  const handleSignMessage = async (data: string) => {
    if (!identity || !openedRow || signingRef.current) return
    if (data === 'empty' || !data.startsWith('data:image/png;base64,')) {
      Alert.alert('서명 확인', '서명칸에 서명해 주세요.')
      return
    }
    signingRef.current = true
    setIsSigning(true)
    try {
      const phoneLast4 = identity.kind === 'cook' ? identity.cook.phoneLast4 : ''
      const device = `${getCommuteDeviceName()} / ${await getOrCreateCommuteDeviceToken(phoneLast4)}`
      await signMyContract(identity, openedRow.contract_id, contentVersion, data, device)
      const signedRow = openedRow
      setStep('list')
      void loadContracts(identity)
      Alert.alert('서명 완료', '근로계약서 서명이 완료되었습니다.\n서명본 PDF를 저장해 두세요.', [
        { text: '닫기', style: 'cancel' },
        { text: 'PDF 저장', onPress: () => void handleSavePdf(signedRow) },
      ])
    } catch (error) {
      if (isRecalledError(error)) {
        showRecalled(identity)
        return
      }
      if (isContentChangedError(error)) {
        showContentChanged(identity, (error as Error).message)
        return
      }
      Alert.alert('서명 실패', error instanceof Error ? error.message : '서명을 저장하지 못했습니다.')
    } finally {
      signingRef.current = false
      setIsSigning(false)
    }
  }

  // 뒤로 버튼 처리 (서명 → 계약서 보기, 계약서 보기 → 목록 다시 조회, 목록 → 홈)
  const handleBack = () => {
    if (step === 'sign') {
      setStep('view')
      // 서명 화면에 있는 동안 날짜가 바뀌었을 수 있어 작성일자 기준 시각을 새로 받음 (실패하면 기존 화면 유지)
      if (identity && openedRow) {
        void fetchMyContractHtml(identity, openedRow.contract_id)
          .then((view) => {
            setContractHtml(view.html)
            setContentVersion(view.contentVersion)
          })
          .catch((error) => {
            if (isRecalledError(error)) showRecalled(identity)
          })
      }
      return
    }
    if (step === 'view' && identity) {
      setStep('list')
      void loadContracts(identity)
      return
    }
    // 알림을 눌러 바로 들어온 경우 등 이전 화면이 없으면 홈으로 이동
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace('/home')
    }
  }

  // 안드로이드 하드웨어 뒤로가기도 상단 뒤로 버튼과 같은 단계로 이동 (서명 저장 중에는 무시)
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!signingRef.current) handleBack()
      return true
    })
    return () => subscription.remove()
  })

  // iOS 밀어서 뒤로가기는 목록 단계에서만 허용 (계약서 보기·서명 중에는 화면 전체가 닫히지 않도록 막음)
  const navigation = useNavigation()
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: step !== 'view' && step !== 'sign' })
  }, [navigation, step])

  // 상단 제목 바 (왼쪽 뒤로 버튼, 가운데 제목·부제목)
  const titleBar = (subtitle: string) => (
    <View style={styles.titleBar}>
      <View style={styles.titleSide}>
        <Pressable hitSlop={8} style={styles.backButton} onPress={handleBack}>
          <MaterialCommunityIcons name="chevron-left" size={26} color="#273542" />
        </Pressable>
      </View>
      <View style={styles.titleText}>
        <Text style={styles.title}>전자계약</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      <View style={styles.titleSide} />
    </View>
  )

  // 세션 확인·목록 조회 중 로딩 화면
  if (step === 'loading') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.loadingBox}>
          <ActivityIndicator color="#1593c4" />
          <Text style={styles.loadingText}>계약서를 불러오는 중</Text>
        </View>
      </SafeAreaView>
    )
  }

  // 본인 확인 화면 (주민번호 앞 6자리 입력)
  if (step === 'verify') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <View style={[styles.frame, isTablet && styles.frameTablet]}>
          {titleBar('본인 확인')}
          <View style={styles.verifyBox}>
            <Text style={styles.verifyText}>
              계약서에는 주민등록번호와 급여가 표시됩니다.{'\n'}본인 확인을 위해 주민등록번호 앞 6자리를 입력해 주세요.
            </Text>
            <TextInput
              value={birthInput}
              onChangeText={(text) => setBirthInput(text.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="예: 900101"
              placeholderTextColor="#a8b4c0"
              style={styles.verifyInput}
              onSubmitEditing={() => void handleVerify()}
            />
            <Pressable
              onPress={() => void handleVerify()}
              disabled={isVerifying}
              style={({ pressed }) => [styles.verifyButton, (pressed || isVerifying) && styles.cardPressed]}
            >
              {isVerifying ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.verifyButtonText}>확인</Text>}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  // 계약서 보기 화면 (엑셀 양식 그대로, 화면 폭에 맞춰 축소되고 두 손가락으로 확대 가능)
  if (step === 'view') {
    // 아이폰 WKWebView는 scalesPageToFit이 없어 760px 양식을 화면 폭에 맞춘 배율을 viewport에 직접 넣음
    // (최소 배율도 같게 해서 화면보다 작게 줄어들지 않고, 두 손가락 확대는 그대로 가능)
    const fitWidth = webWidth || (isTablet ? Math.min(width, 640) : width)
    const fitScale = (fitWidth / 760).toFixed(4)
    const viewHtml =
      Platform.OS === 'ios'
        ? contractHtml.replace(
            /<meta name="viewport"[^>]*>/,
            `<meta name="viewport" content="width=760, initial-scale=${fitScale}, minimum-scale=${fitScale}">`
          )
        : contractHtml
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <View style={[styles.frame, isTablet && styles.frameTablet]}>
          {/* 새 계약서로 다시 서명한 이전 서명본이면 제목 아래에 '이전 계약' 표시 */}
          {titleBar(openedRow?.replaced_yn === 'Y' ? '근로계약서 · 이전 계약' : '근로계약서')}
          <WebView
            originWhitelist={['*']}
            source={{ html: viewHtml }}
            style={styles.webView}
            onLayout={(event) => {
              const next = Math.round(event.nativeEvent.layout.width)
              if (next !== webWidth) setWebWidth(next)
            }}
            scalesPageToFit
            setBuiltInZoomControls
            setDisplayZoomControls={false}
          />
          {/* 하단 버튼 (서명 전: 동의하고 서명하기, 서명 완료: 서명본 PDF 저장) */}
          {openedRow && (
            <View style={styles.bottomBar}>
              {openedRow.status === '서명완료' ? (
                <Pressable
                  onPress={() => void handleSavePdf(openedRow)}
                  disabled={isSavingPdf}
                  style={({ pressed }) => [styles.primaryButton, (pressed || isSavingPdf) && styles.cardPressed]}
                >
                  {isSavingPdf ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>서명본 PDF 저장</Text>
                  )}
                </Pressable>
              ) : (
                <Pressable
                  onPress={handleStartSign}
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.cardPressed]}
                >
                  <Text style={styles.primaryButtonText}>동의하고 서명하기</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </SafeAreaView>
    )
  }

  // 동의·서명 화면 (동의 항목 체크 → 손가락 서명 → 서명 완료)
  if (step === 'sign') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
        <View style={[styles.frame, isTablet && styles.frameTablet]}>
          {titleBar('동의 및 서명')}
          <View style={styles.signContent}>
            {/* 동의 항목 체크 영역 */}
            {AGREE_ITEMS.map((label, index) => (
              <Pressable
                key={label}
                onPress={() => setAgreeChecks((prev) => prev.map((checked, i) => (i === index ? !checked : checked)))}
                style={styles.agreeRow}
              >
                <MaterialCommunityIcons
                  name={agreeChecks[index] ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={24}
                  color={agreeChecks[index] ? '#1593c4' : '#a8b4c0'}
                />
                <Text style={styles.agreeText}>{label}</Text>
              </Pressable>
            ))}

            {/* 손가락 서명칸 */}
            <View style={styles.signPadBox}>
              <WebView
                ref={signPadRef}
                originWhitelist={['*']}
                source={{ html: SIGN_PAD_HTML }}
                scrollEnabled={false}
                onMessage={(event) => void handleSignMessage(event.nativeEvent.data)}
                style={styles.webView}
              />
            </View>

            {/* 서명 다시 쓰기·서명 완료 버튼 */}
            <View style={styles.signButtons}>
              <Pressable
                onPress={() => signPadRef.current?.injectJavaScript('window.clearSign(); true;')}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.cardPressed]}
              >
                <Text style={styles.secondaryButtonText}>다시 쓰기</Text>
              </Pressable>
              <Pressable
                onPress={handleSubmitSign}
                disabled={isSigning}
                style={({ pressed }) => [
                  styles.primaryButton,
                  styles.flexButton,
                  (pressed || isSigning) && styles.cardPressed,
                ]}
              >
                {isSigning ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.primaryButtonText}>서명 완료</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <View style={[styles.frame, isTablet && styles.frameTablet]}>
        {titleBar('내 계약서')}

        <ScrollView contentContainerStyle={styles.listContent} refreshControl={pullRefresh.refreshControl}>
          {pullRefresh.notice}
          {/* 계약서가 없을 때 안내 */}
          {contracts.length === 0 && (
            <View style={styles.emptyBox}>
              <MaterialCommunityIcons name="file-document-outline" size={40} color="#a8b4c0" />
              <Text style={styles.emptyText}>등록된 근로계약서가 없습니다.</Text>
            </View>
          )}

          {/* 내 계약서 카드 목록 (최근 작성 순) */}
          {contracts.map((row) => {
            const badge =
              STATUS_BADGE[row.replaced_yn === 'Y' ? '이전계약' : row.status] ?? STATUS_BADGE['미확인']
            return (
              <Pressable
                key={String(row.contract_id)}
                onPress={() => void handleOpenContract(row)}
                style={({ pressed }) => [
                  styles.card,
                  row.status === '미확인' && styles.cardNew,
                  pressed && styles.cardPressed,
                ]}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle}>근로계약서 ({row.contract_kind})</Text>
                  <Badge label={badge.label} bg={badge.bg} fg={badge.fg} />
                </View>
                <Text style={styles.cardText}>
                  계약기간 {dotDate(row.contract_start_dt)} ~ {dotDate(row.contract_end_dt)}
                </Text>
                <Text style={styles.cardSub}>
                  {/* 서명 완료 건은 서명한 날짜, 서명 전 건은 ERP 등록 날짜 */}
                  {row.account_name ?? ''} ·{' '}
                  {row.status === '서명완료' && row.sign_dt
                    ? `${dotDate(row.sign_dt.slice(0, 10))} 서명`
                    : `${dotDate(row.reg_dt)} 등록`}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>

        {/* 계약서 여는 중 전체 화면 로딩 */}
        {isOpening && (
          <View style={styles.openingOverlay}>
            <ActivityIndicator size="large" color="#1593c4" />
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

// 전자계약 화면 스타일 (지점 업로드 화면 제목 바·카드 스타일과 동일 계열)
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  frame: {
    flex: 1,
    backgroundColor: '#f3f6f8',
  },
  frameTablet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 640,
  },
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: '#7a8998',
    fontSize: 15,
    fontFamily: font.regular,
  },
  titleBar: {
    height: 70,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
  },
  titleSide: {
    flex: 1,
    alignItems: 'flex-start',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f4f7',
  },
  titleText: {
    flex: 1.4,
    alignItems: 'center',
  },
  title: {
    color: '#172431',
    fontSize: 20,
    fontFamily: font.bold,
  },
  subtitle: {
    color: '#7a8998',
    fontSize: 14,
    fontFamily: font.regular,
  },
  listContent: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 10,
  },
  card: {
    padding: 16,
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e3e8ec',
    backgroundColor: '#ffffff',
  },
  cardNew: {
    borderColor: '#1593c4',
    borderLeftWidth: 4,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    color: '#172431',
    fontSize: 17,
    fontFamily: font.bold,
  },
  cardText: {
    color: '#273542',
    fontSize: 15,
    fontFamily: font.regular,
  },
  cardSub: {
    color: '#7a8998',
    fontSize: 13,
    fontFamily: font.regular,
  },
  emptyBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  emptyText: {
    color: '#7a8998',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    fontFamily: font.regular,
  },
  webView: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  verifyBox: {
    paddingHorizontal: 22,
    paddingTop: 30,
    gap: 16,
  },
  verifyText: {
    color: '#273542',
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    fontFamily: font.regular,
  },
  verifyInput: {
    height: 54,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d5dde4',
    backgroundColor: '#ffffff',
    textAlign: 'center',
    fontSize: 22,
    color: '#172431',
    fontFamily: font.bold,
  },
  verifyButton: {
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1593c4',
  },
  verifyButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontFamily: font.bold,
  },
  bottomBar: {
    padding: 14,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e3e8ec',
  },
  primaryButton: {
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1593c4',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontFamily: font.bold,
  },
  secondaryButton: {
    height: 52,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f4f7',
  },
  secondaryButtonText: {
    color: '#273542',
    fontSize: 16,
    fontFamily: font.bold,
  },
  flexButton: {
    flex: 1,
  },
  signContent: {
    flex: 1,
    padding: 18,
    gap: 12,
  },
  agreeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  agreeText: {
    flex: 1,
    color: '#273542',
    fontSize: 15,
    lineHeight: 21,
    fontFamily: font.regular,
  },
  signPadBox: {
    height: 240,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d5dde4',
    overflow: 'hidden',
    backgroundColor: '#ffffff',
  },
  signButtons: {
    flexDirection: 'row',
    gap: 10,
  },
  openingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
})
