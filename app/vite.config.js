import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 해시 라우팅 + 단일 파일 빌드: dist/index.html 하나로 바로 열린다.
// envPrefix: Vercel의 NEXT_PUBLIC_* 변수를 그대로 쓰기 위함 (데이터 연동 단계에서 사용)
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  build: { assetsInlineLimit: 100_000_000 },
});
