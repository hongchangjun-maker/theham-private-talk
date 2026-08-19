import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("source contains beginner-first signup, roulette, AI, and admin entrances", async () => {
  const [component, layout] = await Promise.all([
    readFile(new URL("../components/SecretRouletteApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(component, /비밀친구/);
  assert.match(component, /phoneNumber/);
  assert.match(component, /전화번호 전체/);
  assert.match(component, /전화번호 끝 4자리/);
  assert.match(component, /JSON\.stringify\(\{ name, phoneLast4 \}\)/);
  assert.doesNotMatch(component, /예: 홍길동|예: 6085|예: 봄바람|placeholder="숫자 4자리"/);
  assert.match(component, /마스터 관리자/);
  assert.match(component, /5초 룰렛 시작하기/);
  assert.match(component, /루미 AI와 대화/);
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
  assert.match(source, /env\.AI\.run/);
  assert.match(source, /\/api\/cloudflare\/master-login/);
  assert.match(source, /env\.MASTER_PIN/);
  assert.match(source, /env\.PHONE_HASH_PEPPER/);
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
  assert.equal(parsed.name, "THEHAM 비밀친구");
  assert.equal(parsed.display, "standalone");
  assert.match(sw, /secret-friend-shell-v6-random-chat/);
  assert.match(sw, /pathname\.startsWith\("\/api\/"\)/);
});

test("Cloudflare schema hashes access data and provides moderation tables", async () => {
  const [schema, randomChatMigration, phoneIdentityMigration] = await Promise.all([
    readFile(new URL("../migrations/0001_cloudflare_core.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0003_secret_roulette.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0004_phone_identity.sql", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /token_hash TEXT PRIMARY KEY/i);
  assert.doesNotMatch(schema, /\btoken TEXT\b/i);
  assert.match(randomChatMigration, /phone_last4_hash TEXT NOT NULL/i);
  assert.doesNotMatch(randomChatMigration, /phone_last4 TEXT/i);
  assert.match(randomChatMigration, /CREATE TABLE IF NOT EXISTS random_matches/i);
  assert.match(randomChatMigration, /CREATE TABLE IF NOT EXISTS chat_reports/i);
  assert.match(phoneIdentityMigration, /phone_number_hash TEXT/i);
  assert.match(phoneIdentityMigration, /login_key_hash TEXT/i);
});
