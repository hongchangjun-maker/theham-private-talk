import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function worker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  return (await import(workerUrl.href)).default;
}

const env = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};
const ctx = { waitUntil() {}, passThroughOnException() {} };

test("server-renders branded Korean login experience", async () => {
  const app = await worker();
  const response = await app.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), env, ctx);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /THEHAM PRIVATE TALK/);
  assert.match(html, /대화와 회의를 하나의 안전한 공간에서/);
  assert.match(html, /lang="ko"/);
  assert.doesNotMatch(html, /codex-preview|Starter Project|Your site is taking shape/);
});

test("status endpoint never reports absent integrations as connected", async () => {
  const app = await worker();
  const response = await app.fetch(new Request("http://localhost/api/status"), env, ctx);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.deepEqual(data.integrations, { supabase: false, video: false, storage: false, webPush: false });
});

test("PWA manifest and service worker are production branded", async () => {
  const [manifest, sw] = await Promise.all([
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);
  const parsed = JSON.parse(manifest);
  assert.equal(parsed.name, "THEHAM PRIVATE TALK");
  assert.equal(parsed.display, "standalone");
  assert.match(sw, /private-talk-shell-v1/);
});

test("Supabase migrations enable RLS and keep token hashes only", async () => {
  const [schema, policies] = await Promise.all([
    readFile(new URL("../supabase/migrations/0001_initial_schema.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/0002_rls_policies.sql", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /invite_token_hash text not null unique/i);
  assert.doesNotMatch(schema, /invite_token text/i);
  assert.match(policies, /alter table public\.messages enable row level security/i);
  assert.match(policies, /public\.is_room_member\(room_id\)/i);
  assert.match(policies, /public\.is_admin\(\)/i);
});
