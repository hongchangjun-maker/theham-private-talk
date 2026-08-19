import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("source contains beginner-first signup, roulette, AI, and admin entrances", async () => {
  const [component, layout] = await Promise.all([
    readFile(new URL("../components/SecretRouletteApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(component, /전국비밀채팅/);
  assert.match(component, /phoneNumber/);
  assert.match(component, /전화번호 전체/);
  assert.match(component, /전화번호 끝 4자리/);
  assert.match(component, /채팅 닉네임.*maxLength=\{10\}/);
  assert.match(component, /2~10글자/);
  assert.match(component, /JSON\.stringify\(\{ name, phoneLast4 \}\)/);
  assert.doesNotMatch(component, /예: 홍길동|예: 6085|예: 봄바람|placeholder="숫자 4자리"/);
  assert.match(component, /마스터 관리자/);
  assert.match(component, /5초 룰렛 시작하기/);
  assert.match(component, /루미 AI와 대화/);
  assert.match(component, /공개 데이트 채팅/);
  assert.match(component, /간단한 자기소개/);
  assert.match(component, /안전하고 예의 있게 대화하겠습니다/);
  assert.match(component, /전화번호·주소·계좌번호는 보내지 마세요/);
  assert.match(component, /전체 대화 저장/);
  assert.doesNotMatch(component, /테스트\s*운영자 대행|모니터링|감시/);
  assert.match(component, /신고하기/);
  assert.match(component, /차단하고 끝내기/);
  assert.match(layout, /lang="ko"/);
  assert.doesNotMatch(component, /codex-preview|Starter Project|Your site is taking shape/);
});

test("Worker owns signup, random matching, realtime chat, AI, and moderation routes", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /backend: "cloudflare"/);
  assert.match(source, /\/api\/random\/signup/);
  assert.match(source, /\/api\/random\/matches/);
  assert.match(source, /\/api\/random\/discover/);
  assert.match(source, /\/api\/random\/profile\/photo/);
  assert.match(source, /\/api\/random\/admin\/test-profiles/);
  assert.match(source, /\/api\/random\/admin\/export/);
  assert.match(source, /env\.AI\.run/);
  assert.match(source, /\/api\/cloudflare\/master-login/);
  assert.match(source, /env\.MASTER_PIN/);
  assert.match(source, /env\.PHONE_HASH_PEPPER/);
  assert.match(source, /\{2,10\}/);
  assert.match(source, /hostname\.endsWith\("\.chatgpt\.site"\)/);
  assert.match(source, /class ChatRoom extends DurableObject/);
  assert.match(source, /HttpOnly; Secure; SameSite=Lax/);
});

test("PWA manifest and service worker use the new product branding", async () => {
  const [manifest, sw] = await Promise.all([
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  const parsed = JSON.parse(manifest);
  assert.equal(parsed.name, "전국비밀채팅");
  assert.equal(parsed.short_name, "전국비밀채팅");
  assert.equal(parsed.display, "standalone");
  assert.match(sw, /national-secret-chat-shell-v8-rebrand/);
  assert.match(sw, /pathname\.startsWith\("\/api\/"\)/);
});

test("Cloudflare schema hashes access data and provides moderation tables", async () => {
  const [schema, randomChatMigration, phoneIdentityMigration, datingMigration] = await Promise.all([
    readFile(new URL("../migrations/0001_cloudflare_core.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0003_secret_roulette.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0004_phone_identity.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0005_dating_profiles_and_monitoring.sql", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /token_hash TEXT PRIMARY KEY/i);
  assert.doesNotMatch(schema, /\btoken TEXT\b/i);
  assert.match(randomChatMigration, /phone_last4_hash TEXT NOT NULL/i);
  assert.doesNotMatch(randomChatMigration, /phone_last4 TEXT/i);
  assert.match(randomChatMigration, /CREATE TABLE IF NOT EXISTS random_matches/i);
  assert.match(randomChatMigration, /CREATE TABLE IF NOT EXISTS chat_reports/i);
  assert.match(phoneIdentityMigration, /phone_number_hash TEXT/i);
  assert.match(phoneIdentityMigration, /login_key_hash TEXT/i);
  assert.match(datingMigration, /introduction TEXT/i);
  assert.match(datingMigration, /is_test_profile INTEGER/i);
  assert.match(datingMigration, /target_user_id TEXT/i);
  assert.match(datingMigration, /last_message_at TEXT/i);
});
