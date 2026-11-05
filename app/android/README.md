# aRcHivE Android

기존 웹 화면을 APK에 포함하고 Android 기본 WebView와 앱 내부 파일 저장을 연결한다. 새 npm/Android 라이브러리를 사용하지 않는다. 서버 접속 없이 동작하도록 웹 자산과 글꼴을 포함하며 인터넷 권한을 요청하지 않는다.

## 빌드

`app` 폴더에서 다음을 실행한다.

```powershell
npm run build
./android/build.ps1 -Sdk "$env:LOCALAPPDATA/Android/Sdk"
```

Java JDK와 Android SDK 플랫폼 35, 빌드 도구 35.0.0이 필요하다. Gradle은 사용하지 않는다. 산출물은 프로젝트 루트 `설치파일/aRcHivE-Android-0.1.0.apk`다. 최소 Android API 26, 대상 API 35. APK에는 개발용 서명을 적용하고 서명 및 zip 정렬을 검사한다. Play Store 배포용 릴리스 설정은 별도다.

서명 키는 `android/build/keys/debug.keystore`에 생성하며 이후 빌드에서 재사용한다. 같은 설치 앱을 업데이트할 때 이 키를 보존한다.

## 저장과 파일 선택

- `files/archive/data.json`, `photos/`, `thumbs/`에 저장한다. JSON은 원자적으로 교체하고 직전 JSON은 `data.prev.json`에 보관한다.
- 앱 삭제 시 내부 데이터도 삭제되므로 기기 이동/보관은 설정의 ZIP 백업을 사용한다.
- 사진 및 백업 가져오기는 Android 파일 선택창, 백업 내보내기는 Android 문서 저장창으로 연결한다. 저장 취소 시 마지막 백업 날짜를 변경하지 않는다.
- WebView는 패키지의 로컬 HTTPS 출처만 로드한다. JavaScript 파일 인터페이스는 앱 내부의 정해진 사진/썸네일/JSON에만 접근한다.
- 앱 숨김 시 저장 대기 내용을 반영한다. 프로세스 강제 종료 직전의 미완료 I/O까지 보장하는 것은 아니다.

## 검증 범위

Java 컴파일, APK 패키징, 서명(v2/v3), 정렬 검사 및 매니페스트/자산 구성을 확인했다. 웹 빌드를 Chromium에서 데스크톱·폰 폭으로 검증하고 Android 파일 어댑터는 격리된 모의 인터페이스로 검사했다. 실제 Android 기기/에뮬레이터에서 이 APK의 설치·실행·사진 선택·키보드·시스템 뒤로가기는 아직 검증하지 않았다.

구현 참고: [Android WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview), [파일 선택 인터페이스](https://developer.android.com/reference/android/webkit/WebChromeClient), [d8](https://developer.android.com/tools/d8), [zipalign](https://developer.android.com/tools/zipalign).
