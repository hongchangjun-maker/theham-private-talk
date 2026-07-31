# THEHAM PRIVATE TALK

초대받고 승인된 구성원만 사용하는 비공개 실시간 채팅·영상회의 SaaS입니다. 생성형 AI는 사용하지 않습니다.

## 공개 배포

- 서비스: <https://theham-private-talk.hhongcjun.workers.dev>
- GitHub: <https://github.com/hongchangjun-maker/theham-private-talk>

## 현재 제공 범위

- 반응형 로그인, 초대코드, 가입 승인 요청 UI
- 대시보드, 1:1/그룹/공지 채팅, 메시지 작성과 방 전환
- 연락처, 친구 검색, 알림, 파일함
- 예약 회의, 카메라·마이크 권한 점검, 회의 제어 화면
- 관리자 운영 현황, 회원/방/회의/브랜드/보안 관리 화면
- Supabase PostgreSQL 스키마, RLS, Storage 정책
- PWA manifest와 서비스 워커
- Cloudflare 호환 Vinext 빌드
- 외부 서비스 연결 전에는 성공을 가장하지 않는 미연결 상태

데모 모드는 제품 탐색용입니다. 데모 입력은 서버에 저장되거나 실제 상대방에게 전송되지 않습니다. 실제 회원·채팅·회의·파일 기능은 Supabase와 RealtimeKit 자격 증명을 설정한 뒤 활성화합니다.

## 로컬 실행

요구 환경: Node.js 22.13 이상

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

브라우저에서 개발 서버가 출력한 주소를 엽니다. 실제 로그인 전에는 `.env.local`에 Supabase 공개 URL과 anon key를 설정합니다.

## 데이터베이스 설치

Supabase SQL Editor 또는 CLI로 아래 순서를 지켜 적용합니다.

1. `supabase/migrations/0001_initial_schema.sql`
2. `supabase/migrations/0002_rls_policies.sql`
3. `supabase/migrations/0003_storage_policies.sql`

`supabase/seed.development.sql`은 개발 환경 전용이며 운영에서 자동 실행하지 않습니다.

## 환경변수

공개 브라우저 값:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

서버 전용 값:

- `SUPABASE_SERVICE_ROLE_KEY`
- `REALTIMEKIT_ORG_ID`
- `REALTIMEKIT_API_KEY`
- `SESSION_SECRET`
- R2와 VAPID 관련 값

서비스 역할 키와 API 토큰을 `NEXT_PUBLIC_` 변수에 넣거나 Git에 커밋하면 안 됩니다.

## 운영 연결 순서

1. Supabase 프로젝트를 만들고 SQL 3개를 적용합니다.
2. Auth 이메일 공급자를 활성화하고 공개 URL/anon key를 설정합니다.
3. 첫 관리자 사용자를 Auth Admin API로 생성하고 `profiles.role='super_admin'`, `account_status='active'`를 서버에서 설정합니다.
4. RealtimeKit 앱과 권한 프리셋을 만들고 서버 전용 API 토큰을 설정합니다.
5. 비공개 Storage 버킷과 Web Push VAPID 키를 확인합니다.
6. `npm test`, `npm run lint`, `npm audit` 결과를 검토한 뒤 배포합니다.

세부 운영 절차는 `docs/ADMIN_MANUAL.md`, 사용자 안내는 `docs/USER_MANUAL.md`, 보안·장애·백업은 `docs/OPERATIONS.md`에 있습니다.

## 배포

Sites 배포에서는 `.openai/hosting.json`을 사용합니다. GitHub/Cloudflare 직접 배포 시에도 서버 전용 비밀은 Cloudflare 대시보드의 런타임 시크릿으로 설정하고 저장소에는 올리지 않습니다.

Cloudflare Workers 직접 배포:

```powershell
npm run deploy:cloudflare:dry
npm run deploy:cloudflare
```

GitHub Actions 재배포:

1. 저장소 Actions 변수 `CLOUDFLARE_ACCOUNT_ID`를 설정합니다.
2. Workers 배포 권한이 있는 `CLOUDFLARE_API_TOKEN`을 Actions secret으로 설정합니다.
3. `Deploy to Cloudflare Workers` 워크플로를 수동 실행합니다.

이 소스는 상업적 제품 개발에 사용할 수 있지만 Supabase, Cloudflare RealtimeKit, 폰트·이미지, 기타 의존성의 각 라이선스와 요금 약관을 별도로 확인해야 합니다. 법률 문서는 예시이며 배포 전 전문가 검토가 필요합니다.
