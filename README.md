# aRcHivE

사진에 생각을 붙여 두는 개인 아카이브 앱입니다. 사진은 서버로 보내지 않고 내 기기(또는 내가 고른 폴더)에만 저장됩니다.

## 받기

[Releases](https://github.com/mOulumN/aRcHivE/releases)에서 받을 수 있습니다.

- **Windows**: `aRcHivE-Setup-0.1.2.exe` (서명되지 않아 Windows 경고가 뜰 수 있습니다)
- **Android**: `aRcHivE-Android-0.1.2-release.apk`

웹 화면(`app/`)은 구경용입니다. 브라우저 저장소를 쓰므로 브라우저 기록을 지우면 사라질 수 있습니다. 실제로 쓰려면 위 설치 파일을 쓰세요.

## APK 서명 확인

공식 APK의 서명 인증서 SHA-256 지문입니다. 받은 APK가 아래 값과 다르면 제가 만든 파일이 아닙니다.

```
323a29eb6fcc315a507dc2f62b39e514786272058e1bbee7ceace45703050380
```

확인 방법: `apksigner verify --print-certs aRcHivE-Android-0.1.2-release.apk`

## 저장 위치

Windows와 Android 모두 처음 실행할 때 저장 폴더를 고릅니다. 같은 폴더(예: 클라우드 동기화 폴더)를 두 기기에서 고르면 같은 기록을 이어 쓸 수 있습니다. 두 기기에서 동시에 열면 마지막에 저장한 쪽이 덮어쓰므로 한 번에 하나만 여세요.

## 직접 실행

```
cd app
npm install
npm run dev
```

## 라이선스

MIT. © mOulumN
