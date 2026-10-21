# client 폴더 구조 (기능별)

```
src/
├─ app/            앱 진입 컴포넌트, 라우팅, 전역 Provider
├─ features/       프로세스 대분류 1~7 (기능 하나 = 폴더 하나)
│  ├─ sales-forecast/       1 매출 예측
│  ├─ schedule/             2 근무 스케줄 편성
│  ├─ attendance-payroll/   3 출퇴근·급여 정산
│  ├─ inventory/            4 재고 관리·부족 알림
│  ├─ ordering/             5 발주·입고
│  ├─ forecast-correction/  6 발주 예측 오차 보정
│  └─ master-data/          7 기초 정보 등록
│     ├─ api/          Supabase 조회·저장 함수
│     ├─ components/   이 기능 전용 화면·컴포넌트
│     ├─ hooks/        이 기능 전용 훅
│     └─ index.ts      외부에 공개하는 것만 export
├─ shared/         여러 기능이 같이 쓰는 것 (components, hooks, lib, types, utils)
└─ assets/         이미지 등 정적 파일
```

- import는 상대 경로를 쓴다. 예: `import { supabase } from '../../shared/lib/supabase'`
- 다른 기능의 내부 파일을 직접 import하지 말고 그 기능의 `index.ts`를 통해 가져온다.
- 두 개 이상의 기능에서 쓰게 되면 `shared/`로 옮긴다.

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.
You can also try [the experimental native React Compiler support in plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#rust-react-compiler) by using `compiler: true` in the plugin options instead of using the Babel plugin.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
