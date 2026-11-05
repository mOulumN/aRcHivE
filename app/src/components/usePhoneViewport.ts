import { useEffect } from 'react'

export function usePhoneViewport() {
  useEffect(() => {
    const update = () => {
      const height = window.visualViewport?.height ?? window.innerHeight
      document.documentElement.style.setProperty('--app-height', `${height}px`)
    }
    update()
    window.visualViewport?.addEventListener('resize', update)
    window.addEventListener('resize', update)
    return () => {
      window.visualViewport?.removeEventListener('resize', update)
      window.removeEventListener('resize', update)
      document.documentElement.style.removeProperty('--app-height')
    }
  }, [])
}
