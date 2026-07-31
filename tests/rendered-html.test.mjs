import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("source contains the branded Korean login experience", async () => {
  const [component, layout] = await Promise.all([
    readFile(new URL("../components/PrivateTalkCloudflareAppV3.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(component, /THEHAM PRIVATE TALK/);
  assert.match(component, /우리만의 안전한/);
  assert.match(layout, /lang="ko"/);
  assert.doesNotMatch(component, /codex-preview|Starter Project|Your site is taking shape/);
});

test("Worker owns Cloudflare status, auth, chat, and storage routes", async () => {
  const source = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(source, /backend: "cloudflare"/);
  assert.match(source, /\/api\/cloudflare\/login/);
  assert.match(source, /\/api\/cloudflare\/register/);
  assert.match(source, /\/api\/cloudflare\/rooms/);
  assert.match(source, /\/api\/cloudflare\/files/);
  assert.match(source, /class ChatRoom extends DurableObject/);
  assert.match(source, /HttpOnly; Secure; SameSite=Lax/);
});

test("PWA manifest and service worker are production branded", async () => {
  const [manifest, sw] = await Promise.all([
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  const parsed = JSON.parse(manifest);
  assert.equal(parsed.name, "THEHAM PRIVATE TALK");
  assert.equal(parsed.display, "standalone");
  assert.match(sw, /private-talk-shell-v3-cloudflare/);
  assert.match(sw, /pathname\.startsWith\("\/api\/"\)/);
});

test("Cloudflare schema keeps only hashes for sessions and invitations", async () => {
  const schema = await readFile(new URL("../migrations/0001_cloudflare_core.sql", import.meta.url), "utf8");
  assert.match(schema, /token_hash TEXT PRIMARY KEY/i);
  assert.match(schema, /code_hash TEXT NOT NULL UNIQUE/i);
  assert.doesNotMatch(schema, /\btoken TEXT\b/i);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS room_members/i);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS audit_logs/i);
});
