# thefull-m

더채움 갤럭시용 Expo 모바일 앱입니다.

## 출퇴근 화면에 포함한 로직

- 로그인 세션의 이름과 근무지 사용
- 휴대폰 번호 뒷자리 4자리로 동명이인 구분
- 앱을 삭제하기 전까지 유지되는 설치 기기 토큰
- 현재 기기 등록 요청과 관리자 승인 상태 확인
- 사업장 기준 좌표와 현재 GPS 좌표의 거리 계산
- 근무지 100m 이내에서만 출근·퇴근 버튼 활성화
- 출근 후 퇴근 순서 제어와 오늘 기록 재조회
- 출퇴근 저장 직전 고정밀 현재 위치 재확인

웹 화면의 거래처 자유검색, 카카오 지도, 관리자 승인 목록, 월간 달력은 직원용 모바일 출퇴근에 필수인 로직이 아니어서 포함하지 않았습니다. 기기 승인 처리는 기존 웹 관리자 화면에서 계속 진행합니다.

## 갤럭시에서 Expo Go로 실행

1. PC와 갤럭시를 같은 Wi-Fi에 연결합니다.
2. 갤럭시에 Google Play의 `Expo Go`를 설치합니다.
3. `.env.development`의 `EXPO_PUBLIC_API_BASE_URL_LOCAL`을 갤럭시에서 접근할 수 있는 PC의 내부 IP와 백엔드 포트로 설정합니다. 휴대폰에서 `localhost`는 PC가 아니라 휴대폰 자신을 가리키므로 사용할 수 없습니다.
4. 백엔드 서버를 먼저 실행한 뒤 프로젝트 폴더에서 아래 명령을 실행합니다.

```powershell
cd C:\Users\93827\.git\thefull-m
npm.cmd install
npm.cmd run start
```

5. 터미널에 표시되는 QR 코드를 갤럭시 카메라 또는 Expo Go로 스캔합니다.
6. 앱에서 위치 권한은 `앱 사용 중에만 허용`과 `정확한 위치 사용`으로 허용합니다.

Windows PowerShell에서 스크립트 실행 정책 때문에 `npm`이 막히면 위 예시처럼 `npm.cmd`와 `npx.cmd`를 사용합니다. Metro 연결만 안 될 때는 `npx.cmd expo start --tunnel`을 사용할 수 있지만, 로컬 백엔드도 갤럭시에서 접근 가능해야 API가 동작합니다.

## USB 연결 또는 Android 에뮬레이터 실행

Android Studio와 Android SDK를 설치하고 갤럭시의 개발자 옵션에서 USB 디버깅을 켠 뒤 아래 명령을 사용합니다.

```powershell
npm.cmd run android
```

이 명령은 네이티브 Android 프로젝트를 생성하고 연결된 기기 또는 실행 중인 에뮬레이터에 개발 빌드를 설치합니다.

## 배포 전 환경 확인

현재 운영 API 주소가 `http://`이면 Play 스토어용 Android 앱에서 차단되거나 통신 내용이 노출될 수 있습니다. 운영 배포 전에는 유효한 인증서가 적용된 `https://` API 주소로 변경해야 합니다.

배포 전에 아래 검사를 실행합니다.

```powershell
node .\node_modules\expo\bin\cli install --check
node .\node_modules\eslint\bin\eslint.js .
node .\node_modules\typescript\bin\tsc --noEmit
```

## 갤럭시 설치용 APK 만들기

```powershell
npm.cmd install --global eas-cli
eas login
eas build:configure
eas build --platform android --profile preview
```

빌드가 완료되면 EAS가 제공하는 링크에서 APK를 갤럭시에 설치할 수 있습니다.

## Google Play용 AAB 만들기

앱 이름, 아이콘, 개인정보처리방침, 위치정보 사용 고지, 운영 HTTPS API를 확정한 다음 아래 명령을 사용합니다.

```powershell
eas build --platform android --profile production
eas submit --platform android --profile production
```

`production` 프로필은 Play 스토어 제출용 AAB를 만들고 Android 빌드 번호를 자동 증가시킵니다. 패키지명은 `com.thefull.thefullm`이며 Play Console 앱을 만든 뒤에는 변경하지 않는 것이 안전합니다.
