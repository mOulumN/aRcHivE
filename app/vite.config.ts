import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// 빌드한 화면에만 보안 규칙(CSP)을 넣는다. 개발 서버는 빠른 새로고침용 스크립트 때문에 제외.
const csp: Plugin = {
  name: 'archive-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' blob:" />`,
    ),
}

// base './' : 컴퓨터 프로그램(Electron)에서 파일로 열 수 있게 상대 경로로 빌드
export default defineConfig({
  base: './',
  plugins: [react(), csp],
  server: { watch: { ignored: ['**/release/**'] } },
})
