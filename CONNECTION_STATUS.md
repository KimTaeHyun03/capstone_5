# 연결 현황 요약 (2026-10-14)

## GitHub
- 저장소: `KimTaeHyun03/capstone_5` (private)
- 로컬 `project` 폴더와 연결, `main`에 `firstcommit` 1개 푸시 (빈 `README.md`)
- 미커밋 변경: `.gitignore` (`.vercel`, `.env.local` 추가)

## Vercel
- 계정: `kimtaehyun03`, CLI 64.0.2
- 프로젝트: `capstone-5` (GitHub 저장소 연결, `main` 푸시 시 자동 배포)
- 배포 주소: https://capstone-5-beryl.vercel.app (빈 사이트라 404)
- 환경변수 (Production / Preview / Development)
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- 로컬 개발 서버: http://localhost:3000 (`vercel dev`)

## Supabase
- 조직: `capstone_5` (Free)
- 사용 중: `capstone_5`, 서울(`ap-northeast-2`), ref `zwxmnwczfhlmhmxkvmsy`
  - URL: https://zwxmnwczfhlmhmxkvmsy.supabase.co
- 삭제 예정: `capstone_5`, Sydney(`ap-southeast-2`), ref `hoywzxavugvctasaqyoy`
- Vercel에는 공개용(publishable) 키만 연결. 시크릿 키와 DB 비밀번호는 연결하지 않음

## 남은 할 일
1. 웹 파일을 `project`에 추가하고 푸시
2. Sydney 프로젝트 삭제 (Settings → General → Delete project)
    -완료-
3. 노출된 이전 DB 비밀번호 변경
    -안할거야-
4. 환경변수 반영을 위한 재배포 (푸시 시 자동)