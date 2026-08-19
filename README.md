# 전국비밀채팅

AI 또는 새로운 성인 친구와 안전하게 대화하는 Cloudflare 기반 비밀채팅 앱입니다.

## 운영 구성

- Cloudflare Workers: 인증, 권한, 관리자 API, 보안 헤더
- Cloudflare D1: 회원, 세션, 초대, 채팅방 권한, 파일 메타데이터, 감사 로그
- Cloudflare Durable Objects: 채팅방별 메시지 보관 및 WebSocket 실시간 전송
- Cloudflare R2: 권한 검사를 거치는 비공개 파일 저장
- Cloudflare RealtimeKit: 영상회의용 선택 연결(자격 증명 설정 전에는 장치 점검만 제공)
- GitHub: 공개 소스 및 배포 워크플로

Supabase는 사용하지 않습니다. 비밀번호는 PBKDF2-SHA-256으로 솔트 해시하며, 로그인 세션 원문은 D1에 저장하지 않습니다.

## 로컬 검증

```bash
npm ci
npm run cf:types
npm run cf:migrate:local
npm run lint
npx tsc --noEmit
npm test
npm run deploy:cloudflare:dry
```

## 운영 배포

```bash
npm run cf:migrate:remote
npm run deploy:cloudflare
```

최초 최고관리자는 임시 `BOOTSTRAP_TOKEN` secret을 설정한 뒤 `/api/cloudflare/bootstrap`을 한 번 호출해 만들고, 즉시 secret을 삭제합니다. 이후 관리자가 화면에서 일회용 초대코드를 만들고 가입 요청을 승인합니다.

영상회의는 `REALTIMEKIT_ORG_ID`, `REALTIMEKIT_API_KEY` 두 secret이 모두 있을 때만 활성화됩니다. 자격 증명이 없으면 원격 회의가 작동하는 것처럼 가장하지 않습니다.

## 제한과 운영 주의

- 파일은 1개당 25MB 이하입니다.
- 비밀번호 재설정 메일과 Web Push는 아직 연결되지 않았습니다.
- 실제 개인정보를 받기 전에 개인정보처리방침, 보존·삭제 기준, 신고 대응, 법률 검토를 완료해야 합니다.
