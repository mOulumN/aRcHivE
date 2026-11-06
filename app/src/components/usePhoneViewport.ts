import { useEffect } from 'react'

// 폰 화면 높이는 CSS(100dvh)가 알아서 따라가게 둔다. 예전에는 visualViewport.height를 --app-height로 복사해 썼는데,
// 키보드가 열렸다 닫히는 중간 값이 남으면 화면 높이가 실제보다 낮게 고정돼 하단 탭 아래에 빈 공간이 생길 수 있었다(E-03).
// 여기서는 높이를 건드리지 않고, 안드로이드 앱(WebView)에서만 크기가 바뀔 때 휴대폰 기록(adb logcat, 태그 aRcHivE)에 남긴다.
export function usePhoneViewport() {
  useEffect(() => {
    document.documentElement.style.removeProperty('--app-height')
    if (!window.archiveAndroid) return
    const log = () => {
      const v = window.visualViewport
      console.info(`viewport inner=${window.innerHeight} visual=${v ? Math.round(v.height * 10) / 10 : '-'} root=${document.getElementById('root')?.clientHeight}`)
    }
    log()
    window.addEventListener('resize', log)
    window.visualViewport?.addEventListener('resize', log)
    return () => {
      window.removeEventListener('resize', log)
      window.visualViewport?.removeEventListener('resize', log)
    }
  }, [])
}
