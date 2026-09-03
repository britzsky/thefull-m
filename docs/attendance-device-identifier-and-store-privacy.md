# 출퇴근 기기 식별 방식 & 스토어 등록 시 개인정보 처리방침 체크리스트

> 2026-09 조사 기준. 스토어(구글 플레이스토어/애플 앱스토어) 정식 등록 준비할 때 이 문서를 다시 확인할 것.
> 배경: 출퇴근 앱(`app/attendance.tsx`)이 대리출근 방지를 위해 기기 식별자(`device_token`)로
> "이 기기가 관리자 승인을 받은 기기인지"를 확인하는데, 이때 어떤 API를 쓸 수 있는지/
> 스토어 정책상 문제없는지 조사한 결론.

## 1. 기기 식별 방식 결정

| 플랫폼 | 사용할 API | 비고 |
| --- | --- | --- |
| iOS | `identifierForVendor` (필요 시 `DeviceCheck`/`App Attest` 추가 고려) | 앱을 완전히 삭제하면 값이 초기화됨(정상 동작) |
| Android | `App Set ID` 또는 지금처럼 `Android ID`(`Settings.Secure.ANDROID_ID`) | 2025-04-10 정책 변경 이후 Android ID도 더 이상 "영구 식별자" 취급 아님 |
| 그 외(웹 등, fallback) | `device_{휴대폰뒷자리4자리}` 결정론적 값 | 랜덤값 사용 금지 — 재설치/캐시삭제 시 값이 바뀌면 승인된 기기가 "새 기기"로 오인식됨 |

### 왜 이렇게 결정했는가
- **"재설치해도 안 바뀌는 영구 식별자"를 만들려는 시도(iOS Keychain에 UUID 저장 등)는 하지 않기로 함.**
  - iOS: `identifierForVendor`가 앱 삭제 시 초기화되는 건 Apple이 의도한 설계. Keychain에 저장해 초기화를 우회하는 건 공식 문서화된 동작이 아니고, Apple 개발자 프로그램 라이선스 계약(DPLA) 3.3.9 / 가이드라인 5.1.1의 "기기 핑거프린팅 금지" 조항과 충돌할 리스크가 있음.
  - Android: 2025-04-10부로 Android ID도 Google이 "영구 식별자"로 취급하지 않음. Google이 공식 권장하는 대안인 App Set ID조차 "해당 개발사의 앱을 기기에서 전부 삭제하면 초기화"되는 특성은 동일함. 즉 **Android은 현재 공식적으로 승인된 방법으로는 완전 삭제 후 재설치 시 값을 유지할 방법이 없음.**
- 결론: 앱 완전 삭제 후 재설치, 공장초기화 등으로 기기 식별자가 바뀌어 재등록이 필요해지는 상황은 **막을 수 없는 정상 케이스로 받아들인다.** 대신 관리자가 재승인하기 쉽도록(예: "이 이름+거래처+휴대폰 뒷자리로 이전에 승인 이력 있음" 힌트를 관리자 화면에 표시) UX를 개선하는 쪽으로 대응한다. (미착수 — 추후 작업)

### 목적(대리출근 방지)은 정당한 사유로 인정됨
- Apple: "fraud detection과 관련된 사용 사례는 tracking으로 보지 않으며 허용된다" (ATT 동의 불필요).
- Google Play: App Set ID 설명에서 "analytics와 fraud prevention"을 정당한 비광고 목적으로 명시.
- 단, **목적이 정당해도 구현 방법은 반드시 각 플랫폼이 지정한 공식 API만 사용해야 함** — 여러 신호를 조합하는 자체 핑거프린팅이나 Keychain 우회 같은 방식은 목적과 무관하게 금지됨.

## 2. 스토어 등록(개인정보) 체크리스트 — 등록 준비할 때 다시 볼 것

이 앱이 수집하는 데이터: 이름, 휴대폰 번호 뒷자리 4자리, GPS 위치(출퇴근 시), 기기 식별자(`device_token`).

### Apple App Store Connect — 개인정보 처리방침 라벨(Privacy Nutrition Label)
- [ ] **위치(Location)** — 정확한 위치, 용도: 앱 기능(App Functionality) — 출퇴근 지오펜스 확인용
- [ ] **연락처 정보(Contact Info)** — 전화번호(뒷자리 4자리만) — 용도: 앱 기능(본인 확인)
- [ ] **식별자(Identifiers)** — 기기 ID — 용도: 앱 기능 / 부정 사용 방지(Fraud Prevention), "사용자와 연결됨(Linked to user)"으로 표시 필요
- [ ] `NSLocationWhenInUseUsageDescription` 문구 확인 (이미 `app.json`에 있음: "출퇴근 기록을 위해 현재 위치 권한이 필요합니다.")
- [ ] Apple Developer Enterprise Program(내부 배포 전용)으로 갈지, 일반 App Store 공개 배포로 갈지 결정 필요 — 사내 근태관리 앱이라 내부배포도 검토 가능하나, 별도 자격/비용 요건 있음

### Google Play Console — 데이터 안전(Data Safety) 섹션
- [ ] **위치** — 위치 정보 수집·공유 여부, 용도: 앱 기능
- [ ] **개인 정보** — 이름, 전화번호
- [ ] **기기 또는 기타 ID** — Android ID/App Set ID 사용, 용도: "부정행위 방지, 보안 및 규정 준수(Fraud prevention, security, and compliance)"로 명시
- [ ] 개인정보처리방침 URL 등록 필수 (위치 권한 요청하는 앱은 필수)
- [ ] 위치 권한 선언 양식(Permissions Declaration Form) 작성 — background 위치 아님(foreground만 사용) 확인하고 그에 맞게 작성

### 공통
- [ ] 개인정보처리방침 문서 자체를 작성해서 호스팅(웹페이지) — 위 두 스토어 모두 URL 필수
- [ ] 처리방침에 "부정 출퇴근(대리출근) 방지를 위해 기기 식별자를 수집·보관한다"는 목적을 명확히 기재
- [ ] 데이터 보관 기간, 삭제 요청 방법도 포함

## 3. 참고 자료 (2026-09 검색 기준, 추후 정책 변경될 수 있으니 등록 직전 재확인 권장)
- [App Review Guidelines - Apple Developer](https://developer.apple.com/app-store/review/guidelines/)
- [Guideline 5.1.2(i) - Legal - Privacy - Data Use and Sharing (Apple Developer Forums)](https://developer.apple.com/forums/thread/757064)
- [identifierForVendor | Apple Developer Documentation](https://developer.apple.com/documentation/uikit/uidevice/identifierforvendor)
- [Is device fingerprinting allowed for fraud detection purposes? (Apple Developer Forums)](https://developer.apple.com/forums/thread/734845)
- [Apple announces App Store policy changes to combat device fingerprinting - SiliconANGLE](https://siliconangle.com/2023/07/28/apple-announces-app-store-policy-changes-combat-device-fingerprinting/)
- [Apple Developer Enterprise Program](https://developer.apple.com/programs/enterprise/how-it-works)
- [Policy announcement: 10 April 2025 - Play Console Help](https://support.google.com/googleplay/android-developer/answer/15899442?hl=en)
- [Best practices for unique identifiers | Identity | Android Developers](https://developer.android.com/identity/user-data-ids)
- [Google Play Changes to Android Device Identifiers - IDAC](https://digitalwatchdog.org/google-play-changes-to-android-device-identifiers-a-step-in-the-right-direction/)
