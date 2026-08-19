import { DurableObject } from "cloudflare:workers";
import {
  DEFAULT_DEVICE_SIZES,
  DEFAULT_IMAGE_SIZES,
  handleImageOptimization,
} from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

type AppEnv = Env & {
  BOOTSTRAP_TOKEN?: string;
  MASTER_PIN?: string;
  REALTIMEKIT_API_KEY?: string;
  REALTIMEKIT_ORG_ID?: string;
  PHONE_HASH_PEPPER?: string;
  AI?: {
    run(model: string, input: Record<string, unknown>): Promise<unknown>;
  };
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
};

type AppUser = {
  id: string;
  email: string;
  display_name: string;
  organization: string;
  role: "member" | "admin" | "super_admin";
  status: "pending" | "active" | "rejected" | "suspended";
};

type MessageRecord = {
  id: string;
  roomId: string;
  senderId: string;
  author: string;
  text: string;
  createdAt: string;
  type?: "text" | "image";
  attachmentId?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  byteSize?: number | null;
};

type ChatProfile = {
  user_id: string;
  nickname: string;
  avatar_id: string;
  gender: string;
  age_band: string;
  region: string;
  job: string;
  introduction: string;
  photo_key: string | null;
  photo_content_type: string | null;
  is_discoverable: number;
  is_test_profile: number;
};

type RandomMatch = {
  id: string;
  room_id: string;
  requester_id: string;
  operator_id: string;
  kind: "operator" | "ai";
  persona_nickname: string;
  persona_gender: string;
  persona_region: string;
  persona_age_band: string;
  persona_job: string;
  persona_avatar_id: string;
  status: "live" | "ended" | "blocked";
  created_at: string;
  target_user_id: string | null;
  mode: "managed" | "direct" | "ai";
  last_message_at: string | null;
  relationship_points?: number;
  relationship_level?: number;
  requester_nickname?: string;
  requester_gender?: string;
  requester_region?: string;
  requester_age_band?: string;
  requester_job?: string;
  requester_avatar_id?: string;
  requester_introduction?: string;
  requester_photo_key?: string | null;
  target_introduction?: string;
  target_photo_key?: string | null;
};

const SESSION_COOKIE = "pt_session";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
// Cloudflare Web Crypto currently accepts PBKDF2 iteration counts up to 100,000.
const PASSWORD_ITERATIONS = 100_000;
const MAX_JSON_BYTES = 24_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_CHAT_IMAGE_BYTES = 1024 * 1024;
const PUBLIC_WORKER_ORIGIN = "https://theham-private-talk.hhongcjun.workers.dev";
const AVATAR_IDS = new Set(["f1", "f2", "f3", "f4", "f5", "m1", "m2", "m3", "m4", "m5"]);
const PROFILE_GENDERS = ["여성", "남성", "기타", "공개 안 함"] as const;
const PROFILE_AGES = ["20대", "30대", "40대", "50대 이상"] as const;
const PROFILE_REGIONS = ["서울", "경기", "인천", "부산", "대구", "대전", "광주", "울산", "강원", "충청", "전라", "경상", "제주"] as const;
const PROFILE_JOBS = ["회사원", "자영업", "프리랜서", "전문직", "공무원", "학생", "기타"] as const;
const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
const RELATIONSHIP_LABELS = ["", "어색함", "친해짐", "스킨십", "키스", "러브"] as const;

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self' wss:",
    "font-src 'self' data:",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(self), microphone=(self), display-capture=(self), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class ChatRoom extends DurableObject<AppEnv> {
  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          sender_id TEXT NOT NULL,
          author TEXT NOT NULL,
          text TEXT NOT NULL,
          created_at TEXT NOT NULL,
          message_type TEXT NOT NULL DEFAULT 'text',
          attachment_id TEXT,
          image_width INTEGER,
          image_height INTEGER,
          byte_size INTEGER
        );
        CREATE INDEX IF NOT EXISTS messages_created_idx ON messages(created_at DESC);
      `);
      const columns = new Set(
        [...this.ctx.storage.sql.exec<{ name: string }>("PRAGMA table_info(messages)")].map((column) => column.name),
      );
      if (!columns.has("message_type")) this.ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'text'");
      if (!columns.has("attachment_id")) this.ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN attachment_id TEXT");
      if (!columns.has("image_width")) this.ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN image_width INTEGER");
      if (!columns.has("image_height")) this.ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN image_height INTEGER");
      if (!columns.has("byte_size")) this.ctx.storage.sql.exec("ALTER TABLE messages ADD COLUMN byte_size INTEGER");
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/export")) {
      const rows = [...this.ctx.storage.sql.exec<{
        id: string; room_id: string; sender_id: string; author: string; text: string; created_at: string;
        message_type: "text" | "image"; attachment_id: string | null; image_width: number | null;
        image_height: number | null; byte_size: number | null;
      }>(`SELECT id, room_id, sender_id, author, text, created_at, message_type, attachment_id,
        image_width, image_height, byte_size FROM messages ORDER BY created_at ASC`)];
      return json({
        messages: rows.map((row) => ({
          id: row.id, roomId: row.room_id, senderId: row.sender_id, author: row.author,
          text: row.text, createdAt: row.created_at, type: row.message_type,
          attachmentId: row.attachment_id, imageWidth: row.image_width, imageHeight: row.image_height,
          byteSize: row.byte_size,
        })),
      });
    }
    if (request.method === "GET" && url.pathname.endsWith("/history")) {
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 100, 1), 200);
      const rows = [...this.ctx.storage.sql.exec<{
        id: string;
        room_id: string;
        sender_id: string;
        author: string;
        text: string;
        created_at: string;
        message_type: "text" | "image";
        attachment_id: string | null;
        image_width: number | null;
        image_height: number | null;
        byte_size: number | null;
      }>(
        `SELECT id, room_id, sender_id, author, text, created_at, message_type, attachment_id,
          image_width, image_height, byte_size FROM messages ORDER BY created_at DESC LIMIT ?`,
        limit,
      )].reverse();
      return json({
        messages: rows.map((row) => ({
          id: row.id,
          roomId: row.room_id,
          senderId: row.sender_id,
          author: row.author,
          text: row.text,
          createdAt: row.created_at,
          type: row.message_type,
          attachmentId: row.attachment_id,
          imageWidth: row.image_width,
          imageHeight: row.image_height,
          byteSize: row.byte_size,
        })),
      });
    }

    if (request.method === "POST" && url.pathname.endsWith("/messages")) {
      const message = await request.json<MessageRecord>();
      this.ctx.storage.sql.exec(
        `INSERT INTO messages (
          id, room_id, sender_id, author, text, created_at, message_type, attachment_id,
          image_width, image_height, byte_size
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        message.id,
        message.roomId,
        message.senderId,
        message.author,
        message.text,
        message.createdAt,
        message.type ?? "text",
        message.attachmentId ?? null,
        message.imageWidth ?? null,
        message.imageHeight ?? null,
        message.byteSize ?? null,
      );
      this.broadcast({ type: "message", message });
      return json({ message }, 201);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/messages/")) {
      const messageId = decodeURIComponent(url.pathname.slice("/messages/".length));
      this.ctx.storage.sql.exec("DELETE FROM messages WHERE id = ?", messageId);
      this.broadcast({ type: "message-deleted", messageId });
      return json({ ok: true });
    }

    if (request.method === "DELETE" && url.pathname === "/all") {
      this.ctx.storage.sql.exec("DELETE FROM messages");
      this.broadcast({ type: "room-deleted" });
      for (const socket of this.ctx.getWebSockets()) socket.close(1000, "room deleted");
      return json({ ok: true });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        userId: request.headers.get("X-Private-Talk-User") ?? "",
        displayName: decodeURIComponent(request.headers.get("X-Private-Talk-Name") ?? ""),
      });
      server.send(JSON.stringify({ type: "ready" }));
      return new Response(null, { status: 101, webSocket: client });
    }

    return json({ error: "채팅방 요청을 찾을 수 없습니다." }, 404);
  }

  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    if (typeof message === "string" && message === "ping") {
      ws.send("pong");
    }
  }

  private broadcast(payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(data);
      } catch {
        socket.close(1011, "delivery failed");
      }
    }
  }
}

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function withSecurityHeaders(response: Response): Response {
  // A WebSocket upgrade response cannot be reconstructed with `new Response`.
  if (response.status === 101) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if (headers.get("Content-Type")?.includes("application/json")) headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const decoded = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function randomToken(bytes = 32): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64(new Uint8Array(digest));
}

async function hashPassword(
  password: string,
  salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16)),
  iterations = PASSWORD_ITERATIONS,
): Promise<{ hash: string; salt: string; iterations: number }> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return {
    hash: bytesToBase64(new Uint8Array(bits)),
    salt: bytesToBase64(salt),
    iterations,
  };
}

async function verifyPassword(password: string, expected: string, salt: string, iterations: number): Promise<boolean> {
  const actual = (await hashPassword(password, base64ToBytes(salt), iterations)).hash;
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function normalizeEmail(value: unknown): string {
  const email = String(value ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new HttpError(400, "올바른 이메일 주소를 입력해 주세요.");
  }
  return email;
}

function normalizeInvite(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").trim().replace(/[<>]/g, "").slice(0, max);
}

function assertNickname(value: unknown): string {
  const nickname = cleanText(value, 10);
  if (!/^[가-힣A-Za-z0-9_]{2,10}$/.test(nickname)) {
    throw new HttpError(400, "닉네임은 한글·영문·숫자로 2~10자 입력해 주세요.");
  }
  return nickname;
}

function assertPhoneLast4(value: unknown): string {
  const phoneLast4 = String(value ?? "").trim();
  if (!/^\d{4}$/.test(phoneLast4)) throw new HttpError(400, "전화번호 끝 4자리를 숫자로 입력해 주세요.");
  return phoneLast4;
}

function assertPhoneNumber(value: unknown): string {
  const phoneNumber = String(value ?? "").replace(/\D/g, "");
  if (!/^\d{10,11}$/.test(phoneNumber)) {
    throw new HttpError(400, "전화번호 전체를 숫자 10~11자리로 입력해 주세요.");
  }
  return phoneNumber;
}

function identityName(value: unknown): string {
  const name = cleanText(value, 40).replace(/\s+/g, " ");
  if (name.length < 2) throw new HttpError(400, "가입할 때 입력한 이름을 적어 주세요.");
  return name;
}

async function protectedIdentityHash(env: AppEnv, purpose: "phone" | "login", value: string): Promise<string> {
  if (!env.PHONE_HASH_PEPPER) throw new HttpError(503, "전화번호 보호 설정이 준비되지 않았습니다.");
  return sha256(`${env.PHONE_HASH_PEPPER}:${purpose}:${value}`);
}

function assertAvatar(value: unknown): string {
  const avatarId = String(value ?? "");
  if (!AVATAR_IDS.has(avatarId)) throw new HttpError(400, "아바타를 하나 선택해 주세요.");
  return avatarId;
}

function optionalAvatar(value: unknown): string {
  const avatarId = String(value ?? "");
  if (avatarId && !AVATAR_IDS.has(avatarId)) throw new HttpError(400, "올바른 아바타를 선택해 주세요.");
  return avatarId;
}

function profileChoice(value: unknown, label: string, allowed: readonly string[]): string {
  const selected = cleanText(value, 30);
  if (!allowed.includes(selected)) throw new HttpError(400, `${label}을(를) 선택해 주세요.`);
  return selected;
}

function isUnsafeChat(text: string): boolean {
  return /(아동|미성년|초등학생|중학생).{0,12}(성관계|야한|누드|만남)|자살\s*(방법|하는법)|마약\s*(판매|구매)/i.test(text);
}

function relationshipPointsFor(text: string): number {
  const signals = [
    /좋아|호감|마음에\s*들|보고\s*싶|그리워|설레|사랑/u,
    /멋지|예쁘|아름답|귀엽|잘생|최고|대단|매력|따뜻|친절/u,
    /재밌|즐거|행복|웃겨|기뻐|신나|고마워|감사|❤️|♥|💕|💖|😍|🥰|😊|😄|😘|💋/u,
  ];
  return signals.reduce((points, pattern) => points + (pattern.test(text) ? 1 : 0), 0);
}

function relationshipLevelFor(points: number): number {
  if (points >= 18) return 5;
  if (points >= 12) return 4;
  if (points >= 7) return 3;
  if (points >= 3) return 2;
  return 1;
}

async function updateRelationship(env: AppEnv, matchId: string, text: string): Promise<{ level: number; points: number; levelUp: boolean }> {
  const current = await env.DB.prepare(`
    SELECT relationship_points, relationship_level FROM random_matches
    WHERE id = ? AND kind = 'operator' LIMIT 1
  `).bind(matchId).first<{ relationship_points: number; relationship_level: number }>();
  if (!current) return { level: 1, points: 0, levelUp: false };
  const points = Math.max(0, current.relationship_points) + relationshipPointsFor(text);
  const calculatedLevel = relationshipLevelFor(points);
  const level = Math.min(current.relationship_level + 1, Math.max(current.relationship_level, calculatedLevel));
  await env.DB.prepare(`
    UPDATE random_matches SET relationship_points = ?, relationship_level = ? WHERE id = ?
  `).bind(points, level, matchId).run();
  return { level, points, levelUp: level > current.relationship_level };
}

function validChatImage(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === "image/webp") {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

async function chatProfile(env: AppEnv, userId: string): Promise<ChatProfile | null> {
  return (await env.DB.prepare(
    `SELECT user_id, nickname, avatar_id, gender, age_band, region, job, introduction,
      photo_key, photo_content_type, is_discoverable, is_test_profile
    FROM chat_profiles WHERE user_id = ?`,
  ).bind(userId).first<ChatProfile>()) ?? null;
}

function publicProfile(profile: ChatProfile): Record<string, unknown> {
  return {
    userId: profile.user_id,
    nickname: profile.nickname,
    gender: profile.gender,
    ageBand: profile.age_band,
    region: profile.region,
    job: profile.job,
    introduction: profile.introduction,
    avatarId: profile.avatar_id,
    photoUrl: profile.photo_key ? `/api/random/profile/photo/${profile.user_id}` : null,
  };
}

function publicMatch(row: RandomMatch, viewerId?: string): Record<string, unknown> {
  const viewerIsTarget = Boolean(viewerId && row.mode === "direct" && row.target_user_id === viewerId);
  const persona = viewerIsTarget ? {
    nickname: row.requester_nickname ?? "회원",
    gender: row.requester_gender ?? "공개 안 함",
    region: row.requester_region ?? "공개 안 함",
    ageBand: row.requester_age_band ?? "공개 안 함",
    job: row.requester_job ?? "공개 안 함",
    avatarId: row.requester_avatar_id ?? "",
    introduction: row.requester_introduction ?? "",
    photoUrl: row.requester_photo_key ? `/api/random/profile/photo/${row.requester_id}` : null,
  } : {
    userId: row.target_user_id ?? undefined,
    nickname: row.persona_nickname,
    gender: row.persona_gender,
    region: row.persona_region,
    ageBand: row.persona_age_band,
    job: row.persona_job,
    avatarId: row.persona_avatar_id,
    introduction: row.target_introduction ?? "",
    photoUrl: row.target_photo_key && row.target_user_id ? `/api/random/profile/photo/${row.target_user_id}` : null,
  };
  return {
    id: row.id,
    roomId: row.room_id,
    kind: row.kind,
    status: row.status,
    createdAt: row.created_at,
    mode: row.mode,
    lastMessageAt: row.last_message_at,
    persona,
  };
}

function assertPassword(value: unknown): string {
  const password = String(value ?? "");
  if (password.length < 10 || password.length > 128) {
    throw new HttpError(400, "비밀번호는 10자 이상 128자 이하로 입력해 주세요.");
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new HttpError(400, "비밀번호에는 영문과 숫자를 모두 포함해 주세요.");
  }
  return password;
}

async function readJsonBody<T>(request: Request): Promise<T> {
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_JSON_BYTES) throw new HttpError(413, "요청 본문이 너무 큽니다.");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new HttpError(413, "요청 본문이 너무 큽니다.");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "올바른 JSON 요청이 아닙니다.");
  }
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("Cookie") ?? "";
  for (const item of cookies.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

function sessionCookie(token: string, maxAge = SESSION_SECONDS): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function requestIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

async function ipHash(request: Request): Promise<string> {
  return sha256(requestIp(request));
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    throw new HttpError(403, "다른 사이트에서 보낸 요청은 허용되지 않습니다.");
  }
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    throw new HttpError(403, "교차 사이트 요청은 허용되지 않습니다.");
  }
}

async function currentUser(request: Request, env: AppEnv): Promise<AppUser | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const user = await env.DB.prepare(`
    SELECT u.id, u.email, u.display_name, u.organization, u.role, u.status
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND u.status = 'active'
  `).bind(tokenHash, new Date().toISOString()).first<AppUser>();
  return user ?? null;
}

async function requireUser(request: Request, env: AppEnv): Promise<AppUser> {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError(401, "로그인이 필요합니다.");
  return user;
}

function requireAdmin(user: AppUser): void {
  if (user.role !== "admin" && user.role !== "super_admin") {
    throw new HttpError(403, "관리자 권한이 필요합니다.");
  }
}

async function requireRoomMember(env: AppEnv, roomId: string, userId: string): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT 1 AS allowed FROM room_members rm JOIN rooms r ON r.id = rm.room_id WHERE rm.room_id = ? AND rm.user_id = ? AND r.archived_at IS NULL",
  ).bind(roomId, userId).first();
  if (!row) throw new HttpError(403, "이 채팅방에 참여할 권한이 없습니다.");
}

async function audit(
  env: AppEnv,
  request: Request,
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, detail_json, created_at, ip_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    actorId,
    action,
    targetType,
    targetId,
    JSON.stringify(detail),
    new Date().toISOString(),
    await ipHash(request),
  ).run();
}

async function createSession(env: AppEnv, request: Request, userId: string): Promise<string> {
  const token = randomToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_SECONDS * 1000);
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent, ip_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      await sha256(token),
      userId,
      now.toISOString(),
      expiresAt.toISOString(),
      (request.headers.get("User-Agent") ?? "").slice(0, 300),
      await ipHash(request),
    ),
    env.DB.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?")
      .bind(now.toISOString(), now.toISOString(), userId),
  ]);
  return token;
}

function roomStub(env: AppEnv, roomId: string): DurableObjectStub {
  return env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(roomId));
}

async function api(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return null;

  if (request.method !== "GET" && request.method !== "HEAD") assertSameOrigin(request);

  if (url.pathname === "/api/status" && request.method === "GET") {
    let database = false;
    try {
      database = Boolean(await env.DB.prepare("SELECT 1 AS ok").first());
    } catch {
      database = false;
    }
    return json({
      service: "전국비밀채팅",
      ok: database,
      backend: "cloudflare",
      integrations: {
        cloudflare: database,
        auth: database,
        chat: database && Boolean(env.CHAT_ROOMS),
        storage: Boolean(env.FILES),
        ai: Boolean(env.AI),
        phoneProtection: Boolean(env.PHONE_HASH_PEPPER),
        video: Boolean(env.REALTIMEKIT_API_KEY && env.REALTIMEKIT_ORG_ID),
        webPush: false,
      },
      generatedAt: new Date().toISOString(),
    }, database ? 200 : 503);
  }

  if (url.pathname === "/api/cloudflare/bootstrap" && request.method === "POST") {
    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!env.BOOTSTRAP_TOKEN || !token || token !== env.BOOTSTRAP_TOKEN) {
      throw new HttpError(404, "요청을 찾을 수 없습니다.");
    }
    const existing = await env.DB.prepare("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1").first();
    if (existing) throw new HttpError(409, "최고 관리자가 이미 생성되어 있습니다.");
    const body = await readJsonBody<{ email?: unknown; password?: unknown; displayName?: unknown }>(request);
    const email = normalizeEmail(body.email);
    const password = assertPassword(body.password);
    const displayName = String(body.displayName ?? "최고 관리자").trim().slice(0, 60) || "최고 관리자";
    const passwordData = await hashPassword(password);
    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    const roomId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, display_name, organization, role, status, password_hash, password_salt, password_iterations, created_at, updated_at, approved_at)
        VALUES (?, ?, ?, ?, 'super_admin', 'active', ?, ?, ?, ?, ?, ?)
      `).bind(userId, email, displayName, "전국비밀채팅", passwordData.hash, passwordData.salt, passwordData.iterations, now, now, now),
      env.DB.prepare(`
        INSERT INTO rooms (id, name, description, room_type, owner_id, created_at)
        VALUES (?, '운영 공지', '승인된 구성원을 위한 기본 비공개 대화방', 'notice', ?, ?)
      `).bind(roomId, userId, now),
      env.DB.prepare("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
        .bind(roomId, userId, now),
    ]);
    await audit(env, request, userId, "bootstrap.completed", "user", userId);
    return json({ ok: true, userId, roomId }, 201);
  }

  if (url.pathname === "/api/cloudflare/session" && request.method === "GET") {
    const user = await currentUser(request, env);
    const profile = user ? await chatProfile(env, user.id) : null;
    return json({ authenticated: Boolean(user), user, profile });
  }

  if (url.pathname === "/api/random/signup" && request.method === "POST") {
    const body = await readJsonBody<{
      name?: unknown; phoneNumber?: unknown; nickname?: unknown; avatarId?: unknown;
      gender?: unknown; ageBand?: unknown; region?: unknown; job?: unknown; introduction?: unknown;
      adultAccepted?: unknown; termsAccepted?: unknown; safetyAccepted?: unknown; monitoringAccepted?: unknown;
    }>(request);
    const name = identityName(body.name);
    const phoneNumber = assertPhoneNumber(body.phoneNumber);
    const phoneLast4 = phoneNumber.slice(-4);
    const nickname = assertNickname(body.nickname);
    const avatarId = optionalAvatar(body.avatarId);
    const gender = profileChoice(body.gender, "성별", PROFILE_GENDERS);
    const ageBand = profileChoice(body.ageBand, "나이", PROFILE_AGES);
    const region = profileChoice(body.region, "지역", PROFILE_REGIONS);
    const job = profileChoice(body.job, "직업", PROFILE_JOBS);
    const introduction = cleanText(body.introduction, 240);
    if (introduction.length < 2) throw new HttpError(400, "간단한 자기소개를 2글자 이상 입력해 주세요.");
    if (body.adultAccepted !== true || body.termsAccepted !== true || (body.safetyAccepted !== true && body.monitoringAccepted !== true)) {
      throw new HttpError(400, "성인 확인, 이용규칙과 안전한 매너 채팅 약속이 필요합니다.");
    }
    const phoneNumberHash = await protectedIdentityHash(env, "phone", phoneNumber);
    const loginKeyHash = await protectedIdentityHash(env, "login", `${name.toLowerCase()}:${phoneLast4}`);
    const existing = await env.DB.prepare(`
      SELECT user_id, nickname, phone_number_hash, login_key_hash FROM chat_profiles
      WHERE nickname = ? COLLATE NOCASE OR phone_number_hash = ? OR login_key_hash = ? LIMIT 1
    `).bind(nickname, phoneNumberHash, loginKeyHash).first<{
      user_id: string; nickname: string; phone_number_hash: string | null; login_key_hash: string | null;
    }>();
    if (existing?.nickname.toLowerCase() === nickname.toLowerCase()) throw new HttpError(409, "이미 사용 중인 닉네임입니다.");
    if (existing) throw new HttpError(409, "이미 가입된 전화번호 또는 같은 로그인 정보가 있습니다.");
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const passwordData = await hashPassword(phoneLast4);
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (
          id, email, display_name, organization, role, status, password_hash, password_salt,
          password_iterations, created_at, updated_at, approved_at
        ) VALUES (?, ?, ?, '', 'member', 'active', ?, ?, ?, ?, ?, ?)
      `).bind(userId, `member-${userId}@secret.local`, name, passwordData.hash, passwordData.salt,
        passwordData.iterations, now, now, now),
      env.DB.prepare(`
        INSERT INTO chat_profiles (
          user_id, nickname, phone_last4_hash, phone_last4_salt, phone_last4_iterations,
          avatar_id, adult_confirmed_at, terms_accepted_at, created_at, updated_at,
          phone_number_hash, login_key_hash, gender, age_band, region, job, introduction,
          is_discoverable, is_test_profile
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
      `).bind(userId, nickname, passwordData.hash, passwordData.salt, passwordData.iterations,
        avatarId, now, now, now, now, phoneNumberHash, loginKeyHash,
        gender, ageBand, region, job, introduction),
    ]);
    const token = await createSession(env, request, userId);
    await audit(env, request, userId, "random.signup", "user", userId, { avatarId });
    return json({
      user: { id: userId, display_name: name, role: "member", status: "active" },
      profile: await chatProfile(env, userId),
    }, 201, { "Set-Cookie": sessionCookie(token) });
  }

  if (url.pathname === "/api/random/login" && request.method === "POST") {
    const body = await readJsonBody<{ name?: unknown; phoneLast4?: unknown }>(request);
    const name = identityName(body.name);
    const phoneLast4 = assertPhoneLast4(body.phoneLast4);
    const keyHash = await sha256(`${requestIp(request)}:random:${name.toLowerCase()}`);
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const attempts = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM auth_attempts WHERE key_hash = ? AND attempted_at > ? AND success = 0",
    ).bind(keyHash, windowStart).first<{ count: number }>();
    if ((attempts?.count ?? 0) >= 5) throw new HttpError(429, "입력 횟수를 초과했습니다. 15분 후 다시 시도해 주세요.");
    const loginKeyHash = await protectedIdentityHash(env, "login", `${name.toLowerCase()}:${phoneLast4}`);
    let row = await env.DB.prepare(`
      SELECT u.id, u.email, u.display_name, u.organization, u.role, u.status,
        p.nickname, p.avatar_id, p.phone_last4_hash, p.phone_last4_salt, p.phone_last4_iterations
      FROM chat_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.login_key_hash = ?
    `).bind(loginKeyHash).first<AppUser & ChatProfile & {
      phone_last4_hash: string; phone_last4_salt: string; phone_last4_iterations: number;
    }>();
    if (!row) {
      const legacy = await env.DB.prepare(`
        SELECT u.id, u.email, u.display_name, u.organization, u.role, u.status,
          p.nickname, p.avatar_id, p.phone_last4_hash, p.phone_last4_salt, p.phone_last4_iterations
        FROM chat_profiles p JOIN users u ON u.id = p.user_id
        WHERE u.display_name = ? AND u.status = 'active' AND p.login_key_hash IS NULL
      `).bind(name).all<AppUser & ChatProfile & {
        phone_last4_hash: string; phone_last4_salt: string; phone_last4_iterations: number;
      }>();
      const validLegacy = [];
      for (const candidate of legacy.results) {
        if (await verifyPassword(phoneLast4, candidate.phone_last4_hash, candidate.phone_last4_salt, candidate.phone_last4_iterations)) {
          validLegacy.push(candidate);
        }
      }
      if (validLegacy.length === 1) {
        row = validLegacy[0];
        await env.DB.prepare("UPDATE chat_profiles SET login_key_hash = ?, updated_at = ? WHERE user_id = ?")
          .bind(loginKeyHash, new Date().toISOString(), row.id).run();
      }
    }
    const valid = Boolean(row) && row!.status === "active" && await verifyPassword(
      phoneLast4, row!.phone_last4_hash, row!.phone_last4_salt, row!.phone_last4_iterations,
    );
    await env.DB.prepare("INSERT INTO auth_attempts (key_hash, attempted_at, success) VALUES (?, ?, ?)")
      .bind(keyHash, new Date().toISOString(), valid ? 1 : 0).run();
    if (!valid) throw new HttpError(401, "이름 또는 전화번호 끝 4자리가 맞지 않습니다.");
    const token = await createSession(env, request, row!.id);
    return json({
      user: { id: row!.id, display_name: row!.display_name, role: row!.role, status: row!.status },
      profile: await chatProfile(env, row!.id),
    }, 200, { "Set-Cookie": sessionCookie(token) });
  }

  if (url.pathname === "/api/cloudflare/master-login" && request.method === "POST") {
    const body = await readJsonBody<{ pin?: unknown }>(request);
    const pin = String(body.pin ?? "");
    if (pin.length < 8 || pin.length > 64) throw new HttpError(400, "관리자 비밀번호는 8~64자로 입력해 주세요.");
    const keyHash = await sha256(`${requestIp(request)}:master`);
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const attempts = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM auth_attempts WHERE key_hash = ? AND attempted_at > ? AND success = 0",
    ).bind(keyHash, windowStart).first<{ count: number }>();
    if ((attempts?.count ?? 0) >= 5) {
      throw new HttpError(429, "관리자 비밀번호 입력 횟수를 초과했습니다. 15분 후 다시 시도해 주세요.");
    }
    const valid = Boolean(env.MASTER_PIN) && await sha256(pin) === await sha256(env.MASTER_PIN!);
    await env.DB.prepare("INSERT INTO auth_attempts (key_hash, attempted_at, success) VALUES (?, ?, ?)")
      .bind(keyHash, new Date().toISOString(), valid ? 1 : 0).run();
    if (!valid) throw new HttpError(401, "마스터 관리자 비밀번호가 올바르지 않습니다.");
    const user = await env.DB.prepare(`
      SELECT id, email, display_name, organization, role, status
      FROM users WHERE role = 'super_admin' AND status = 'active' LIMIT 1
    `).first<AppUser>();
    if (!user) throw new HttpError(503, "마스터 관리자 계정이 준비되지 않았습니다.");
    const token = await createSession(env, request, user.id);
    ctx.waitUntil(audit(env, request, user.id, "auth.master_login", "session", null));
    return json({ user }, 200, { "Set-Cookie": sessionCookie(token) });
  }

  if (url.pathname === "/api/cloudflare/join" && request.method === "POST") {
    const body = await readJsonBody<{ code?: unknown }>(request);
    const code = normalizeInvite(body.code);
    const now = new Date().toISOString();
    const invitation = await env.DB.prepare(`
      SELECT i.id, i.room_id, r.name AS room_name
      FROM invitations i
      JOIN rooms r ON r.id = i.room_id
      WHERE i.code_hash = ? AND i.revoked_at IS NULL AND i.expires_at > ?
        AND i.use_count < i.max_uses AND r.archived_at IS NULL
    `).bind(await sha256(code), now).first<{ id: string; room_id: string; room_name: string }>();
    if (!invitation) throw new HttpError(404, "유효하지 않거나 만료된 초대번호입니다.");

    const consumed = await env.DB.prepare(`
      UPDATE invitations SET use_count = use_count + 1
      WHERE id = ? AND use_count < max_uses AND revoked_at IS NULL AND expires_at > ?
    `).bind(invitation.id, now).run();
    if ((consumed.meta.changes ?? 0) !== 1) {
      throw new HttpError(409, "이미 사용된 초대번호입니다.");
    }

    const userId = crypto.randomUUID();
    const guestNumber = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10_000).padStart(4, "0");
    const displayName = `참여자 ${guestNumber}`;
    const randomCredential = await hashPassword(randomToken(24));
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (
          id, email, display_name, organization, role, status,
          password_hash, password_salt, password_iterations,
          created_at, updated_at, approved_at
        ) VALUES (?, ?, ?, '', 'member', 'active', ?, ?, ?, ?, ?, ?)
      `).bind(
        userId,
        `guest-${userId}@invite.local`,
        displayName,
        randomCredential.hash,
        randomCredential.salt,
        randomCredential.iterations,
        now,
        now,
        now,
      ),
      env.DB.prepare(`
        INSERT INTO room_members (room_id, user_id, role, joined_at)
        VALUES (?, ?, 'member', ?)
      `).bind(invitation.room_id, userId, now),
    ]);
    const token = await createSession(env, request, userId);
    const user: AppUser = {
      id: userId,
      email: "",
      display_name: displayName,
      organization: "",
      role: "member",
      status: "active",
    };
    await audit(env, request, userId, "invitation.joined", "room", invitation.room_id, {
      invitationId: invitation.id,
    });
    return json({
      user,
      room: { id: invitation.room_id, name: invitation.room_name },
    }, 201, { "Set-Cookie": sessionCookie(token) });
  }

  if (url.pathname === "/api/cloudflare/login" && request.method === "POST") {
    const body = await readJsonBody<{ email?: unknown; password?: unknown }>(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password ?? "");
    const keyHash = await sha256(`${requestIp(request)}:${email}`);
    const windowStart = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const attempts = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM auth_attempts WHERE key_hash = ? AND attempted_at > ? AND success = 0",
    ).bind(keyHash, windowStart).first<{ count: number }>();
    if ((attempts?.count ?? 0) >= 5) {
      throw new HttpError(429, "로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요.");
    }
    const user = await env.DB.prepare(`
      SELECT id, email, display_name, organization, role, status, password_hash, password_salt, password_iterations
      FROM users WHERE email = ?
    `).bind(email).first<AppUser & {
      password_hash: string;
      password_salt: string;
      password_iterations: number;
    }>();
    const valid = Boolean(user) && await verifyPassword(
      password,
      user!.password_hash,
      user!.password_salt,
      user!.password_iterations,
    );
    await env.DB.prepare("INSERT INTO auth_attempts (key_hash, attempted_at, success) VALUES (?, ?, ?)")
      .bind(keyHash, new Date().toISOString(), valid ? 1 : 0).run();
    if (!valid) throw new HttpError(401, "이메일 또는 비밀번호가 올바르지 않습니다.");
    if (user!.status !== "active") {
      const messages = {
        pending: "가입 승인 대기 중입니다.",
        rejected: "가입 요청이 승인되지 않았습니다.",
        suspended: "정지된 계정입니다. 관리자에게 문의해 주세요.",
        active: "",
      };
      throw new HttpError(403, messages[user!.status]);
    }
    const token = await createSession(env, request, user!.id);
    ctx.waitUntil(audit(env, request, user!.id, "auth.login", "session", null));
    const publicUser: AppUser = {
      id: user!.id,
      email: user!.email,
      display_name: user!.display_name,
      organization: user!.organization,
      role: user!.role,
      status: user!.status,
    };
    return json({ user: publicUser }, 200, { "Set-Cookie": sessionCookie(token) });
  }

  if (url.pathname === "/api/cloudflare/logout" && request.method === "POST") {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token) {
      await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
    }
    return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  }

  if (url.pathname === "/api/cloudflare/invitations/verify" && request.method === "POST") {
    const body = await readJsonBody<{ code?: unknown }>(request);
    const code = normalizeInvite(body.code);
    const invitation = await env.DB.prepare(`
      SELECT id, label, expires_at, max_uses, use_count
      FROM invitations
      WHERE code_hash = ? AND revoked_at IS NULL AND expires_at > ? AND use_count < max_uses
    `).bind(await sha256(code), new Date().toISOString()).first();
    if (!invitation) throw new HttpError(404, "유효하지 않거나 만료된 초대코드입니다.");
    return json({ valid: true, invitation });
  }

  if (url.pathname === "/api/cloudflare/register" && request.method === "POST") {
    const body = await readJsonBody<{
      code?: unknown;
      email?: unknown;
      password?: unknown;
      displayName?: unknown;
      organization?: unknown;
    }>(request);
    const code = normalizeInvite(body.code);
    const email = normalizeEmail(body.email);
    const password = assertPassword(body.password);
    const displayName = String(body.displayName ?? "").trim().slice(0, 60);
    const organization = String(body.organization ?? "").trim().slice(0, 100);
    if (displayName.length < 2) throw new HttpError(400, "이름은 2자 이상 입력해 주세요.");
    const invitation = await env.DB.prepare(`
      SELECT id FROM invitations
      WHERE code_hash = ? AND revoked_at IS NULL AND expires_at > ? AND use_count < max_uses
    `).bind(await sha256(code), new Date().toISOString()).first<{ id: string }>();
    if (!invitation) throw new HttpError(404, "유효하지 않거나 만료된 초대코드입니다.");
    const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (existing) throw new HttpError(409, "이미 가입 요청 또는 계정이 존재하는 이메일입니다.");
    const passwordData = await hashPassword(password);
    const now = new Date().toISOString();
    const userId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (id, email, display_name, organization, password_hash, password_salt, password_iterations, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(userId, email, displayName, organization, passwordData.hash, passwordData.salt, passwordData.iterations, now, now),
      env.DB.prepare("UPDATE invitations SET use_count = use_count + 1 WHERE id = ? AND use_count < max_uses")
        .bind(invitation.id),
    ]);
    await audit(env, request, userId, "registration.requested", "user", userId);
    return json({ ok: true, status: "pending" }, 201);
  }

  const user = await requireUser(request, env);

  if (url.pathname === "/api/random/profile" && request.method === "GET") {
    const profile = await chatProfile(env, user.id);
    if (!profile && user.role === "member") throw new HttpError(404, "채팅 프로필이 없습니다.");
    return json({ user, profile });
  }

  if (url.pathname === "/api/random/profile/photo" && request.method === "POST") {
    const contentType = (request.headers.get("Content-Type") ?? "").split(";")[0].toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      throw new HttpError(400, "얼굴 사진은 JPG, PNG, WebP 파일만 사용할 수 있습니다.");
    }
    if (!request.body) throw new HttpError(400, "업로드할 사진을 선택해 주세요.");
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_PROFILE_PHOTO_BYTES) {
      throw new HttpError(413, "얼굴 사진은 5MB 이하만 업로드할 수 있습니다.");
    }
    const profile = await chatProfile(env, user.id);
    if (!profile) throw new HttpError(404, "채팅 프로필이 없습니다.");
    const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const storageKey = `profile-photos/${user.id}/${crypto.randomUUID()}.${extension}`;
    await env.FILES.put(storageKey, bytes, { httpMetadata: { contentType }, customMetadata: { ownerId: user.id } });
    await env.DB.prepare(`
      UPDATE chat_profiles SET photo_key = ?, photo_content_type = ?, updated_at = ? WHERE user_id = ?
    `).bind(storageKey, contentType, new Date().toISOString(), user.id).run();
    if (profile.photo_key) ctx.waitUntil(env.FILES.delete(profile.photo_key));
    await audit(env, request, user.id, "profile.photo_uploaded", "user", user.id);
    return json({ photoUrl: `/api/random/profile/photo/${user.id}` }, 201);
  }

  const profilePhotoMatch = url.pathname.match(/^\/api\/random\/profile\/photo\/([^/]+)$/);
  if (profilePhotoMatch && request.method === "GET") {
    const profile = await env.DB.prepare(`
      SELECT photo_key, photo_content_type FROM chat_profiles WHERE user_id = ?
    `).bind(profilePhotoMatch[1]).first<{ photo_key: string | null; photo_content_type: string | null }>();
    if (!profile?.photo_key) throw new HttpError(404, "등록된 얼굴 사진이 없습니다.");
    const object = await env.FILES.get(profile.photo_key);
    if (!object) throw new HttpError(404, "등록된 얼굴 사진이 없습니다.");
    return new Response(object.body, {
      headers: {
        "Content-Type": profile.photo_content_type ?? "image/jpeg",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  if (url.pathname === "/api/random/discover" && request.method === "GET") {
    const result = await env.DB.prepare(`
      SELECT p.user_id, p.nickname, p.avatar_id, p.gender, p.age_band, p.region, p.job,
        p.introduction, p.photo_key, p.photo_content_type, p.is_discoverable, p.is_test_profile,
        CASE WHEN p.is_test_profile = 1 OR EXISTS (
          SELECT 1 FROM sessions s WHERE s.user_id = p.user_id AND s.expires_at > ?
        ) THEN 1 ELSE 0 END AS is_online
      FROM chat_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.user_id != ? AND p.is_discoverable = 1 AND u.status = 'active'
      ORDER BY is_online DESC, p.updated_at DESC LIMIT 100
    `).bind(new Date().toISOString(), user.id).all<ChatProfile & { is_online: number }>();
    return json({ profiles: result.results.map((profile) => ({ ...publicProfile(profile), online: Boolean(profile.is_online) })) });
  }

  const directMatch = url.pathname.match(/^\/api\/random\/direct\/([^/]+)$/);
  if (directMatch && request.method === "POST") {
    const requester = await chatProfile(env, user.id);
    if (!requester) throw new HttpError(403, "먼저 채팅 회원가입을 해 주세요.");
    const target = await chatProfile(env, directMatch[1]);
    if (!target || !target.is_discoverable || target.user_id === user.id) throw new HttpError(404, "선택한 상대를 찾을 수 없습니다.");
    const mode = target.is_test_profile ? "managed" : "direct";
    const existing = await env.DB.prepare(`
      SELECT m.id, m.room_id, m.requester_id, m.operator_id, m.kind, m.persona_nickname,
        m.persona_gender, m.persona_region, m.persona_age_band, m.persona_job, m.persona_avatar_id,
        m.status, m.created_at, m.target_user_id, m.mode, m.last_message_at,
        rp.nickname AS requester_nickname, rp.gender AS requester_gender, rp.region AS requester_region,
        rp.age_band AS requester_age_band, rp.job AS requester_job, rp.avatar_id AS requester_avatar_id,
        rp.introduction AS requester_introduction, rp.photo_key AS requester_photo_key,
        tp.introduction AS target_introduction, tp.photo_key AS target_photo_key
      FROM random_matches m
      LEFT JOIN chat_profiles rp ON rp.user_id = m.requester_id
      LEFT JOIN chat_profiles tp ON tp.user_id = m.target_user_id
      WHERE m.status = 'live' AND ((m.requester_id = ? AND m.target_user_id = ?)
        OR (? = 'direct' AND m.requester_id = ? AND m.target_user_id = ?))
      ORDER BY m.created_at DESC LIMIT 1
    `).bind(user.id, target.user_id, mode, target.user_id, user.id).first<RandomMatch>();
    if (existing) return json({ match: publicMatch(existing, user.id), resumed: true });
    const blocked = await env.DB.prepare(`
      SELECT 1 AS blocked FROM random_matches
      WHERE status = 'blocked' AND ((requester_id = ? AND target_user_id = ?)
        OR (? = 'direct' AND requester_id = ? AND target_user_id = ?))
      LIMIT 1
    `).bind(user.id, target.user_id, mode, target.user_id, user.id).first();
    if (blocked) throw new HttpError(403, "차단한 상대와는 새 대화를 시작할 수 없습니다.");
    const operator = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'super_admin' AND status = 'active' LIMIT 1",
    ).first<{ id: string }>();
    if (!operator) throw new HttpError(503, "채팅 연결을 준비하는 중입니다.");
    const id = crypto.randomUUID();
    const roomId = crypto.randomUUID();
    const now = new Date().toISOString();
    const ownerId = mode === "managed" ? operator.id : user.id;
    const statements = [
      env.DB.prepare(`
        INSERT INTO rooms (id, name, description, room_type, owner_id, file_enabled, video_enabled, created_at)
        VALUES (?, ?, '공개 데이트에서 시작된 비밀대화', 'direct', ?, 0, 0, ?)
      `).bind(roomId, `${requester.nickname} · ${target.nickname}`, ownerId, now),
      env.DB.prepare("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
        .bind(roomId, user.id, now),
      env.DB.prepare("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)")
        .bind(roomId, mode === "managed" ? operator.id : target.user_id, mode === "managed" ? "owner" : "member", now),
      env.DB.prepare(`
        INSERT INTO random_matches (
          id, room_id, requester_id, operator_id, kind, desired_nickname, desired_gender,
          desired_region, desired_age_band, desired_job, persona_nickname, persona_gender,
          persona_region, persona_age_band, persona_job, persona_avatar_id, status, created_at,
          target_user_id, mode, last_message_at
        ) VALUES (?, ?, ?, ?, 'operator', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?, ?)
      `).bind(id, roomId, user.id, operator.id, target.nickname, target.gender, target.region, target.age_band,
        target.job, target.nickname, target.gender, target.region, target.age_band, target.job, target.avatar_id,
        now, target.user_id, mode, now),
    ];
    await env.DB.batch(statements);
    await audit(env, request, user.id, "dating.chat_started", "match", id, {
      mode, roomId, targetUserId: target.user_id, targetNickname: target.nickname,
    });
    const row: RandomMatch = {
      id, room_id: roomId, requester_id: user.id, operator_id: operator.id, kind: "operator",
      persona_nickname: target.nickname, persona_gender: target.gender, persona_region: target.region,
      persona_age_band: target.age_band, persona_job: target.job, persona_avatar_id: target.avatar_id,
      status: "live", created_at: now, target_user_id: target.user_id, mode, last_message_at: now,
      target_introduction: target.introduction, target_photo_key: target.photo_key,
    };
    return json({ match: publicMatch(row, user.id), resumed: false }, 201);
  }

  if (url.pathname === "/api/random/matches" && request.method === "GET") {
    const result = await env.DB.prepare(`
      SELECT m.id, m.room_id, m.requester_id, m.operator_id, m.kind, m.persona_nickname, m.persona_gender,
        m.persona_region, m.persona_age_band, m.persona_job, m.persona_avatar_id, m.status, m.created_at,
        m.target_user_id, m.mode, m.last_message_at,
        rp.nickname AS requester_nickname, rp.gender AS requester_gender, rp.region AS requester_region,
        rp.age_band AS requester_age_band, rp.job AS requester_job, rp.avatar_id AS requester_avatar_id,
        rp.introduction AS requester_introduction, rp.photo_key AS requester_photo_key,
        tp.introduction AS target_introduction, tp.photo_key AS target_photo_key
      FROM random_matches m
      LEFT JOIN chat_profiles rp ON rp.user_id = m.requester_id
      LEFT JOIN chat_profiles tp ON tp.user_id = m.target_user_id
      WHERE m.requester_id = ? OR (m.mode = 'direct' AND m.target_user_id = ?)
      ORDER BY COALESCE(m.last_message_at, m.created_at) DESC LIMIT 60
    `).bind(user.id, user.id).all<RandomMatch>();
    return json({ matches: result.results.map((row) => publicMatch(row, user.id)) });
  }

  if (url.pathname === "/api/random/matches" && request.method === "POST") {
    const profile = await chatProfile(env, user.id);
    if (!profile) throw new HttpError(403, "먼저 채팅 회원가입을 해 주세요.");
    const body = await readJsonBody<{
      nickname?: unknown; gender?: unknown; region?: unknown; ageBand?: unknown;
      job?: unknown; avatarId?: unknown;
    }>(request);
    const operator = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'super_admin' AND status = 'active' LIMIT 1",
    ).first<{ id: string }>();
    if (!operator) throw new HttpError(503, "채팅 연결을 준비하는 중입니다.");
    const gender = cleanText(body.gender, 12) || "상관없음";
    const region = cleanText(body.region, 20) || "상관없음";
    const ageBand = cleanText(body.ageBand, 12) || "상관없음";
    const job = cleanText(body.job, 30) || "상관없음";
    const avatarId = assertAvatar(body.avatarId);
    const requestedNickname = cleanText(body.nickname, 12);
    const candidate = await env.DB.prepare(`
      SELECT p.user_id, p.nickname, p.avatar_id, p.gender, p.age_band, p.region, p.job,
        p.introduction, p.photo_key, p.photo_content_type, p.is_discoverable, p.is_test_profile
      FROM chat_profiles p JOIN users u ON u.id = p.user_id
      WHERE p.user_id != ? AND p.is_discoverable = 1 AND u.status = 'active'
        AND (? = '' OR p.nickname = ? COLLATE NOCASE)
        AND (? = '상관없음' OR p.gender = ?)
        AND (? = '상관없음' OR p.region = ?)
        AND (? = '상관없음' OR p.age_band = ?)
        AND (? = '상관없음' OR p.job = ?)
      ORDER BY RANDOM() LIMIT 1
    `).bind(user.id, requestedNickname, requestedNickname, gender, gender, region, region,
      ageBand, ageBand, job, job).first<ChatProfile>();
    const fallbackNames = gender === "남성" ? ["도윤", "준호", "민재", "시우", "현우"] : ["하린", "서아", "지유", "다은", "유나"];
    const personaNickname = candidate?.nickname ?? (requestedNickname || fallbackNames[Math.floor(Math.random() * fallbackNames.length)]);
    const personaGender = candidate?.gender ?? (gender === "상관없음" ? (avatarId.startsWith("m") ? "남성" : "여성") : gender);
    const personaRegion = candidate?.region ?? (region === "상관없음" ? ["서울", "경기", "부산", "대전"][Math.floor(Math.random() * 4)] : region);
    const personaAge = candidate?.age_band ?? (ageBand === "상관없음" ? ["20대", "30대", "40대"][Math.floor(Math.random() * 3)] : ageBand);
    const personaJob = candidate?.job ?? (job === "상관없음" ? ["회사원", "자영업", "프리랜서", "전문직"][Math.floor(Math.random() * 4)] : job);
    const personaAvatar = candidate?.avatar_id ?? avatarId;
    const mode = candidate && !candidate.is_test_profile ? "direct" : "managed";
    const id = crypto.randomUUID();
    const roomId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO rooms (id, name, description, room_type, owner_id, file_enabled, video_enabled, created_at)
        VALUES (?, ?, '랜덤 비밀대화', 'direct', ?, 0, 0, ?)
      `).bind(roomId, `${profile.nickname} · ${personaNickname}`, mode === "direct" ? user.id : operator.id, now),
      env.DB.prepare("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
        .bind(roomId, user.id, now),
      env.DB.prepare("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
        .bind(roomId, mode === "direct" ? candidate!.user_id : operator.id, now),
      env.DB.prepare(`
        INSERT INTO random_matches (
          id, room_id, requester_id, operator_id, kind, desired_nickname, desired_gender,
          desired_region, desired_age_band, desired_job, persona_nickname, persona_gender,
          persona_region, persona_age_band, persona_job, persona_avatar_id, status, created_at,
          target_user_id, mode, last_message_at
        ) VALUES (?, ?, ?, ?, 'operator', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?, ?)
      `).bind(id, roomId, user.id, operator.id, requestedNickname, gender, region, ageBand, job,
        personaNickname, personaGender, personaRegion, personaAge, personaJob, personaAvatar, now,
        candidate?.user_id ?? null, mode, now),
    ]);
    await audit(env, request, user.id, "random.match_created", "match", id, { roomId });
    const match = await env.DB.prepare(`
      SELECT id, room_id, requester_id, operator_id, kind, persona_nickname, persona_gender,
        persona_region, persona_age_band, persona_job, persona_avatar_id, status, created_at,
        target_user_id, mode, last_message_at
      FROM random_matches WHERE id = ?
    `).bind(id).first<RandomMatch>();
    if (candidate && match) {
      match.target_introduction = candidate.introduction;
      match.target_photo_key = candidate.photo_key;
    }
    return json({ match: publicMatch(match!, user.id) }, 201);
  }

  if (url.pathname === "/api/random/ai/start" && request.method === "POST") {
    const profile = await chatProfile(env, user.id);
    if (!profile) throw new HttpError(403, "먼저 채팅 회원가입을 해 주세요.");
    if (!env.AI) throw new HttpError(503, "AI 대화가 아직 연결되지 않았습니다.");
    const active = await env.DB.prepare(`
      SELECT id, room_id, requester_id, operator_id, kind, persona_nickname, persona_gender,
        persona_region, persona_age_band, persona_job, persona_avatar_id, status, created_at
      FROM random_matches WHERE requester_id = ? AND kind = 'ai' AND status = 'live'
      ORDER BY created_at DESC LIMIT 1
    `).bind(user.id).first<RandomMatch>();
    if (active) return json({ match: publicMatch(active) });
    const operator = await env.DB.prepare(
      "SELECT id FROM users WHERE role = 'super_admin' AND status = 'active' LIMIT 1",
    ).first<{ id: string }>();
    if (!operator) throw new HttpError(503, "운영 계정이 준비되지 않았습니다.");
    const id = crypto.randomUUID();
    const roomId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO rooms (id, name, description, room_type, owner_id, file_enabled, video_enabled, created_at)
        VALUES (?, '루미 AI', 'AI와 나누는 비밀대화', 'direct', ?, 0, 0, ?)
      `).bind(roomId, operator.id, now),
      env.DB.prepare("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
        .bind(roomId, user.id, now),
      env.DB.prepare(`
        INSERT INTO random_matches (
          id, room_id, requester_id, operator_id, kind, persona_nickname, persona_gender,
          persona_region, persona_age_band, persona_job, persona_avatar_id, status, created_at
        ) VALUES (?, ?, ?, ?, 'ai', '루미 AI', 'AI', '온라인', '성인', '대화 도우미', 'f2', 'live', ?)
      `).bind(id, roomId, user.id, operator.id, now),
    ]);
    const match = await env.DB.prepare(`
      SELECT id, room_id, requester_id, operator_id, kind, persona_nickname, persona_gender,
        persona_region, persona_age_band, persona_job, persona_avatar_id, status, created_at
      FROM random_matches WHERE id = ?
    `).bind(id).first<RandomMatch>();
    return json({ match: publicMatch(match!) }, 201);
  }

  const aiMessageMatch = url.pathname.match(/^\/api\/random\/ai\/([^/]+)\/messages$/);
  if (aiMessageMatch && request.method === "POST") {
    if (!env.AI) throw new HttpError(503, "AI 대화가 아직 연결되지 않았습니다.");
    const roomId = aiMessageMatch[1];
    const match = await env.DB.prepare(
      "SELECT id FROM random_matches WHERE room_id = ? AND requester_id = ? AND kind = 'ai' AND status = 'live'",
    ).bind(roomId, user.id).first();
    if (!match) throw new HttpError(403, "이 AI 대화방을 사용할 수 없습니다.");
    const body = await readJsonBody<{ text?: unknown }>(request);
    const text = cleanText(body.text, 2000);
    if (!text) throw new HttpError(400, "메시지를 입력해 주세요.");
    if (isUnsafeChat(text)) throw new HttpError(400, "안전 규칙에 어긋나는 내용은 보낼 수 없습니다.");
    const profile = await chatProfile(env, user.id);
    const userMessage: MessageRecord = {
      id: crypto.randomUUID(), roomId, senderId: user.id, author: profile?.nickname ?? user.display_name,
      text, createdAt: new Date().toISOString(),
    };
    await roomStub(env, roomId).fetch(new Request(`${url.origin}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(userMessage),
    }));
    await env.DB.prepare("UPDATE random_matches SET last_message_at = ? WHERE room_id = ?")
      .bind(userMessage.createdAt, roomId).run();
    const historyResponse = await roomStub(env, roomId).fetch(new Request(`${url.origin}/history?limit=16`));
    const history = await historyResponse.json<{ messages: MessageRecord[] }>();
    const messages = [
      { role: "system", content: "너는 성인 사용자와 대화하는 친절한 한국어 AI 친구 루미다. 짧고 자연스럽게 답한다. 자신을 실제 인간이라고 속이지 않는다. 성적 착취, 미성년자 관련 성적 내용, 불법 행위, 자해 조장은 거절하고 안전한 도움을 안내한다." },
      ...history.messages.map((item) => ({ role: item.senderId === user.id ? "user" : "assistant", content: item.text })),
    ];
    const result = await env.AI.run(AI_MODEL, { messages, max_tokens: 260, temperature: 0.75 }) as { response?: string };
    const answer = cleanText(result?.response, 2000) || "잠시 답을 만들지 못했어요. 한 번만 다시 말해 주세요.";
    const aiMessage: MessageRecord = {
      id: crypto.randomUUID(), roomId, senderId: "ai-lumi", author: "루미 AI", text: answer,
      createdAt: new Date().toISOString(),
    };
    await roomStub(env, roomId).fetch(new Request(`${url.origin}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(aiMessage),
    }));
    await env.DB.prepare("UPDATE random_matches SET last_message_at = ? WHERE room_id = ?")
      .bind(aiMessage.createdAt, roomId).run();
    return json({ userMessage, aiMessage }, 201);
  }

  const reportMatch = url.pathname.match(/^\/api\/random\/matches\/([^/]+)\/report$/);

  const relationshipMatch = url.pathname.match(/^\/api\/random\/matches\/([^/]+)\/relationship$/);
  if (relationshipMatch && request.method === "GET") {
    const match = await env.DB.prepare(`
      SELECT id, room_id, requester_id, target_user_id, operator_id, mode, kind,
        relationship_points, relationship_level
      FROM random_matches WHERE id = ? LIMIT 1
    `).bind(relationshipMatch[1]).first<{
      id: string; room_id: string; requester_id: string; target_user_id: string | null;
      operator_id: string; mode: string; kind: string; relationship_points: number; relationship_level: number;
    }>();
    if (!match) throw new HttpError(404, "대화를 찾을 수 없습니다.");
    const isParticipant = match.requester_id === user.id || (match.mode === "direct" && match.target_user_id === user.id);
    const isOperator = user.role !== "member" && match.operator_id === user.id;
    if (!isParticipant && !isOperator) throw new HttpError(403, "이 관계레벨을 볼 수 없습니다.");
    const rating = user.role === "member" ? await env.DB.prepare(`
      SELECT score FROM chat_ratings WHERE match_id = ? AND rater_id = ? LIMIT 1
    `).bind(match.id, user.id).first<{ score: number }>() : null;
    const level = Math.min(5, Math.max(1, Number(match.relationship_level) || 1));
    return json({
      level,
      points: Math.max(0, Number(match.relationship_points) || 0),
      label: RELATIONSHIP_LABELS[level],
      rating: rating?.score ?? null,
    });
  }

  const ratingMatch = url.pathname.match(/^\/api\/random\/matches\/([^/]+)\/rating$/);
  if (ratingMatch && request.method === "POST") {
    if (user.role !== "member") throw new HttpError(403, "회원만 매너점수를 줄 수 있습니다.");
    const match = await env.DB.prepare(`
      SELECT id, room_id, requester_id, target_user_id, mode, kind
      FROM random_matches WHERE id = ? LIMIT 1
    `).bind(ratingMatch[1]).first<{
      id: string; room_id: string; requester_id: string; target_user_id: string | null;
      mode: string; kind: string;
    }>();
    if (!match || match.kind !== "operator") throw new HttpError(404, "점수를 줄 대화를 찾을 수 없습니다.");
    const isRequester = match.requester_id === user.id;
    const isDirectTarget = match.mode === "direct" && match.target_user_id === user.id;
    if (!isRequester && !isDirectTarget) throw new HttpError(403, "이 상대에게 점수를 줄 수 없습니다.");
    const body = await readJsonBody<{ score?: unknown }>(request);
    const score = Number(body.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) throw new HttpError(400, "별점은 1점부터 5점까지 선택해 주세요.");
    const historyResponse = await roomStub(env, match.room_id).fetch(new Request(`${url.origin}/history?limit=1`));
    const history = await historyResponse.json<{ messages?: MessageRecord[] }>();
    if (!history.messages?.length) throw new HttpError(409, "먼저 실제 대화를 나눈 뒤 매너점수를 주세요.");
    const ratedUserId = isRequester ? match.target_user_id : match.requester_id;
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO chat_ratings (match_id, rater_id, rated_user_id, score, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(match_id, rater_id) DO UPDATE SET
        rated_user_id = excluded.rated_user_id, score = excluded.score, updated_at = excluded.updated_at
    `).bind(match.id, user.id, ratedUserId, score, now, now).run();
    await audit(env, request, user.id, "chat.rating_saved", "match", match.id, { score, ratedUserId });
    return json({ score });
  }

  if (reportMatch && request.method === "POST") {
    const row = await env.DB.prepare(`
      SELECT id FROM random_matches WHERE id = ?
        AND (requester_id = ? OR (mode = 'direct' AND target_user_id = ?))
    `).bind(reportMatch[1], user.id, user.id).first();
    if (!row) throw new HttpError(404, "대화를 찾을 수 없습니다.");
    const body = await readJsonBody<{ reason?: unknown; detail?: unknown }>(request);
    const reason = cleanText(body.reason, 60);
    if (!reason) throw new HttpError(400, "신고 이유를 선택해 주세요.");
    const id = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO chat_reports (id, reporter_id, match_id, reason, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, user.id, reportMatch[1], reason, cleanText(body.detail, 500), new Date().toISOString()).run();
    await audit(env, request, user.id, "chat.reported", "match", reportMatch[1], { reason });
    return json({ ok: true, reportId: id }, 201);
  }

  const blockMatch = url.pathname.match(/^\/api\/random\/matches\/([^/]+)\/block$/);
  if (blockMatch && request.method === "POST") {
    const changed = await env.DB.prepare(`
      UPDATE random_matches SET status = 'blocked', ended_at = ?
      WHERE id = ? AND (requester_id = ? OR (mode = 'direct' AND target_user_id = ?)) AND status = 'live'
    `).bind(new Date().toISOString(), blockMatch[1], user.id, user.id).run();
    if (!changed.meta.changes) throw new HttpError(404, "진행 중인 대화를 찾을 수 없습니다.");
    await audit(env, request, user.id, "chat.blocked", "match", blockMatch[1]);
    return json({ ok: true });
  }

  if (url.pathname === "/api/random/admin/matches" && request.method === "GET") {
    requireAdmin(user);
    const result = await env.DB.prepare(`
      SELECT m.id, m.room_id, m.requester_id, m.operator_id, m.kind, m.persona_nickname,
        m.persona_gender, m.persona_region, m.persona_age_band, m.persona_job,
        m.persona_avatar_id, m.status, m.created_at, m.target_user_id, m.mode, m.last_message_at,
        rp.nickname AS requester_nickname, rp.gender AS requester_gender, rp.region AS requester_region,
        rp.age_band AS requester_age_band, rp.job AS requester_job, rp.avatar_id AS requester_avatar_id,
        rp.introduction AS requester_introduction, rp.photo_key AS requester_photo_key,
        tp.introduction AS target_introduction, tp.photo_key AS target_photo_key
      FROM random_matches m
      LEFT JOIN chat_profiles rp ON rp.user_id = m.requester_id
      LEFT JOIN chat_profiles tp ON tp.user_id = m.target_user_id
      ORDER BY CASE m.status WHEN 'live' THEN 0 ELSE 1 END,
        COALESCE(m.last_message_at, m.created_at) DESC LIMIT 250
    `).all<RandomMatch>();
    return json({ matches: result.results.map((row) => ({
      ...publicMatch(row), requester: {
        nickname: row.requester_nickname, gender: row.requester_gender, region: row.requester_region,
        ageBand: row.requester_age_band, job: row.requester_job, avatarId: row.requester_avatar_id,
        introduction: row.requester_introduction,
        photoUrl: row.requester_photo_key ? `/api/random/profile/photo/${row.requester_id}` : null,
      },
    })) });
  }

  if (url.pathname === "/api/random/admin/test-profiles" && request.method === "GET") {
    requireAdmin(user);
    const result = await env.DB.prepare(`
      SELECT p.user_id, p.nickname, p.avatar_id, p.gender, p.age_band, p.region, p.job,
        p.introduction, p.photo_key, p.photo_content_type, p.is_discoverable, p.is_test_profile,
        CASE WHEN EXISTS (
          SELECT 1 FROM random_matches m WHERE m.target_user_id = p.user_id
            AND m.mode = 'managed' AND m.status = 'live'
        ) THEN 1 ELSE 0 END AS is_live
      FROM chat_profiles p WHERE p.is_test_profile = 1
      ORDER BY is_live DESC, p.created_at DESC LIMIT 100
    `).all<ChatProfile & { is_live: number }>();
    return json({ profiles: result.results.map((profile) => ({ ...publicProfile(profile), live: Boolean(profile.is_live) })) });
  }

  if (url.pathname === "/api/random/admin/test-profiles" && request.method === "POST") {
    requireAdmin(user);
    const body = await readJsonBody<{
      nickname?: unknown; gender?: unknown; ageBand?: unknown; region?: unknown; job?: unknown;
      introduction?: unknown; avatarId?: unknown;
    }>(request);
    const nickname = assertNickname(body.nickname);
    const gender = profileChoice(body.gender, "성별", PROFILE_GENDERS);
    const ageBand = profileChoice(body.ageBand, "나이", PROFILE_AGES);
    const region = profileChoice(body.region, "지역", PROFILE_REGIONS);
    const job = profileChoice(body.job, "직업", PROFILE_JOBS);
    const introduction = cleanText(body.introduction, 240);
    if (introduction.length < 2) throw new HttpError(400, "자기소개를 2글자 이상 입력해 주세요.");
    const avatarId = optionalAvatar(body.avatarId);
    const duplicate = await env.DB.prepare("SELECT user_id FROM chat_profiles WHERE nickname = ? COLLATE NOCASE")
      .bind(nickname).first();
    if (duplicate) throw new HttpError(409, "이미 사용 중인 닉네임입니다.");
    const userId = crypto.randomUUID();
    const now = new Date().toISOString();
    const credential = await hashPassword(randomToken(32));
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (
          id, email, display_name, organization, role, status, password_hash, password_salt,
          password_iterations, created_at, updated_at, approved_at, approved_by
        ) VALUES (?, ?, ?, 'MASTER_TEST_PROFILE', 'member', 'active', ?, ?, ?, ?, ?, ?, ?)
      `).bind(userId, `managed-${userId}@secret.local`, nickname, credential.hash, credential.salt,
        credential.iterations, now, now, now, user.id),
      env.DB.prepare(`
        INSERT INTO chat_profiles (
          user_id, nickname, phone_last4_hash, phone_last4_salt, phone_last4_iterations,
          avatar_id, adult_confirmed_at, terms_accepted_at, created_at, updated_at,
          gender, age_band, region, job, introduction, is_discoverable, is_test_profile, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
      `).bind(userId, nickname, credential.hash, credential.salt, credential.iterations, avatarId,
        now, now, now, now, gender, ageBand, region, job, introduction, user.id),
    ]);
    await audit(env, request, user.id, "test_profile.created", "user", userId);
    return json({ profile: publicProfile((await chatProfile(env, userId))!) }, 201);
  }

  const adminEndMatch = url.pathname.match(/^\/api\/random\/admin\/matches\/([^/]+)\/end$/);
  if (adminEndMatch && request.method === "POST") {
    requireAdmin(user);
    const matchId = adminEndMatch[1];
    const match = await env.DB.prepare(`
      SELECT id, room_id, status FROM random_matches
      WHERE id = ? AND operator_id = ? AND kind = 'operator' AND mode = 'managed'
    `).bind(matchId, user.id).first<{ id: string; room_id: string; status: string }>();
    if (!match) throw new HttpError(404, "관리 중인 대화방을 찾을 수 없습니다.");
    if (match.status !== "live") throw new HttpError(409, "이미 종료된 대화입니다.");
    const endedAt = new Date().toISOString();
    await env.DB.prepare("UPDATE random_matches SET status = 'ended', ended_at = ? WHERE id = ? AND status = 'live'")
      .bind(endedAt, match.id).run();
    await audit(env, request, user.id, "managed_chat.ended", "match", match.id, { roomId: match.room_id });
    return json({ ok: true, endedAt });
  }

  const adminDeleteMatch = url.pathname.match(/^\/api\/random\/admin\/matches\/([^/]+)$/);
  if (adminDeleteMatch && request.method === "DELETE") {
    requireAdmin(user);
    const matchId = adminDeleteMatch[1];
    const match = await env.DB.prepare(`
      SELECT id, room_id FROM random_matches
      WHERE id = ? AND operator_id = ? AND kind = 'operator' AND mode = 'managed'
    `).bind(matchId, user.id).first<{ id: string; room_id: string }>();
    if (!match) throw new HttpError(404, "삭제할 관리 대화방을 찾을 수 없습니다.");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM chat_reports WHERE match_id = ?").bind(match.id),
      env.DB.prepare("DELETE FROM random_matches WHERE id = ?").bind(match.id),
      env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(match.room_id),
    ]);
    await roomStub(env, match.room_id).fetch(new Request(`${url.origin}/all`, { method: "DELETE" }));
    await audit(env, request, user.id, "managed_chat.deleted", "match", match.id, { roomId: match.room_id });
    return json({ ok: true });
  }

  if (url.pathname === "/api/random/admin/export" && request.method === "GET") {
    requireAdmin(user);
    const requestedMatchId = url.searchParams.get("matchId");
    const matches = requestedMatchId ? await env.DB.prepare(`
      SELECT id, room_id, requester_id, target_user_id, mode, status, persona_nickname, created_at,
        last_message_at FROM random_matches WHERE id = ? LIMIT 1
    `).bind(requestedMatchId).all<{
      id: string; room_id: string; requester_id: string; target_user_id: string | null; mode: string;
      status: string; persona_nickname: string; created_at: string; last_message_at: string | null;
    }>() : await env.DB.prepare(`
      SELECT id, room_id, requester_id, target_user_id, mode, status, persona_nickname, created_at,
        last_message_at FROM random_matches ORDER BY created_at ASC LIMIT 500
    `).all<{
      id: string; room_id: string; requester_id: string; target_user_id: string | null; mode: string;
      status: string; persona_nickname: string; created_at: string; last_message_at: string | null;
    }>();
    const conversations = [];
    for (const match of matches.results) {
      const history = await roomStub(env, match.room_id).fetch(new Request(`${url.origin}/export`));
      const data = await history.json<{ messages: MessageRecord[] }>();
      conversations.push({
        matchId: match.id, roomId: match.room_id, requesterId: match.requester_id,
        targetUserId: match.target_user_id, mode: match.mode, status: match.status,
        partnerNickname: match.persona_nickname, createdAt: match.created_at,
        lastMessageAt: match.last_message_at, messages: data.messages,
      });
    }
    await audit(env, request, user.id, "chat.exported", "conversation", null, { conversationCount: conversations.length });
    const fileName = `jeonguk-secret-chat-export-${new Date().toISOString().slice(0, 10)}.json`;
    return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), conversations }, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const adminReplyMatch = url.pathname.match(/^\/api\/random\/admin\/matches\/([^/]+)\/messages$/);
  if (adminReplyMatch && request.method === "POST") {
    requireAdmin(user);
    const match = await env.DB.prepare(`
      SELECT id, room_id, requester_id, operator_id, kind, persona_nickname, persona_gender,
        persona_region, persona_age_band, persona_job, persona_avatar_id, status, created_at
      FROM random_matches WHERE id = ? AND operator_id = ? AND kind = 'operator'
        AND mode = 'managed' AND status = 'live'
    `).bind(adminReplyMatch[1], user.id).first<RandomMatch>();
    if (!match) throw new HttpError(404, "답변할 대화를 찾을 수 없습니다.");
    const body = await readJsonBody<{ text?: unknown }>(request);
    const text = cleanText(body.text, 4000);
    if (!text) throw new HttpError(400, "메시지를 입력해 주세요.");
    const message: MessageRecord = {
      id: crypto.randomUUID(), roomId: match.room_id, senderId: user.id,
      author: match.persona_nickname, text, createdAt: new Date().toISOString(),
    };
    await roomStub(env, match.room_id).fetch(new Request(`${url.origin}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message),
    }));
    await env.DB.prepare("UPDATE random_matches SET last_message_at = ? WHERE id = ?")
      .bind(message.createdAt, match.id).run();
    await updateRelationship(env, match.id, text);
    return json({ message }, 201);
  }

  if (url.pathname === "/api/cloudflare/rooms" && request.method === "GET") {
    const result = await env.DB.prepare(`
      SELECT r.id, r.name, r.description, r.room_type AS type,
        (SELECT COUNT(*) FROM room_members x WHERE x.room_id = r.id) AS members
      FROM rooms r
      JOIN room_members rm ON rm.room_id = r.id
      WHERE rm.user_id = ? AND r.archived_at IS NULL
      ORDER BY r.created_at ASC
    `).bind(user.id).all();
    return json({ rooms: result.results });
  }

  const historyMatch = url.pathname.match(/^\/api\/cloudflare\/rooms\/([^/]+)\/messages$/);
  if (historyMatch && request.method === "GET") {
    const roomId = historyMatch[1];
    if (user.role === "member") await requireRoomMember(env, roomId, user.id);
    return roomStub(env, roomId).fetch(new Request(`${url.origin}/history?limit=${url.searchParams.get("limit") ?? "100"}`));
  }

  if (historyMatch && request.method === "POST") {
    const roomId = historyMatch[1];
    await requireRoomMember(env, roomId, user.id);
    const body = await readJsonBody<{ text?: unknown }>(request);
    const text = String(body.text ?? "").trim();
    if (!text || text.length > 4_000) throw new HttpError(400, "메시지는 1자 이상 4,000자 이하로 입력해 주세요.");
    const randomMatch = await env.DB.prepare("SELECT id, status, kind FROM random_matches WHERE room_id = ? LIMIT 1")
      .bind(roomId).first<{ id: string; status: string; kind: string }>();
    if (randomMatch && randomMatch.status !== "live") throw new HttpError(409, "종료된 대화방에는 메시지를 보낼 수 없습니다.");
    if (isUnsafeChat(text)) throw new HttpError(400, "안전 규칙에 어긋나는 내용은 보낼 수 없습니다.");
    const profile = await chatProfile(env, user.id);
    const message: MessageRecord = {
      id: crypto.randomUUID(),
      roomId,
      senderId: user.id,
      author: profile?.nickname ?? user.display_name,
      text,
      createdAt: new Date().toISOString(),
    };
    const response = await roomStub(env, roomId).fetch(new Request(`${url.origin}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    }));
    await env.DB.prepare("UPDATE random_matches SET last_message_at = ? WHERE room_id = ?")
      .bind(message.createdAt, roomId).run();
    if (randomMatch?.kind === "operator") await updateRelationship(env, randomMatch.id, text);
    return response;
  }

  const socketMatch = url.pathname.match(/^\/api\/cloudflare\/rooms\/([^/]+)\/socket$/);
  if (socketMatch && request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
    const roomId = socketMatch[1];
    if (user.role === "member") await requireRoomMember(env, roomId, user.id);
    const headers = new Headers(request.headers);
    headers.set("X-Private-Talk-User", user.id);
    headers.set("X-Private-Talk-Name", encodeURIComponent(user.display_name));
    return roomStub(env, roomId).fetch(new Request(request, { headers }));
  }

  const chatImageMatch = url.pathname.match(/^\/api\/cloudflare\/rooms\/([^/]+)\/images$/);
  if (chatImageMatch && request.method === "POST") {
    const roomId = chatImageMatch[1];
    await requireRoomMember(env, roomId, user.id);
    const match = await env.DB.prepare(`
      SELECT id, status, mode, operator_id, persona_nickname
      FROM random_matches WHERE room_id = ? LIMIT 1
    `).bind(roomId).first<{
      id: string; status: string; mode: string; operator_id: string; persona_nickname: string;
    }>();
    if (match && match.status !== "live") throw new HttpError(409, "종료된 대화방에는 사진을 보낼 수 없습니다.");
    if (user.role !== "member" && (!match || match.mode !== "managed" || match.operator_id !== user.id)) {
      throw new HttpError(403, "이 대화에는 사진을 보낼 수 없습니다.");
    }
    const contentType = (request.headers.get("Content-Type") ?? "").split(";")[0].toLowerCase();
    if (contentType !== "image/jpeg" && contentType !== "image/webp") {
      throw new HttpError(415, "JPG 또는 WebP 사진만 올릴 수 있습니다.");
    }
    const declaredLength = Number(request.headers.get("Content-Length") ?? 0);
    if (declaredLength > MAX_CHAT_IMAGE_BYTES) {
      throw new HttpError(413, "사진을 더 작게 줄인 뒤 다시 올려 주세요.");
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_CHAT_IMAGE_BYTES) {
      throw new HttpError(413, "사진을 더 작게 줄인 뒤 다시 올려 주세요.");
    }
    if (!validChatImage(bytes, contentType)) throw new HttpError(415, "올바른 사진 파일이 아닙니다.");
    const imageWidth = Math.floor(Number(request.headers.get("X-Image-Width") ?? 0));
    const imageHeight = Math.floor(Number(request.headers.get("X-Image-Height") ?? 0));
    if (imageWidth < 1 || imageWidth > 4096 || imageHeight < 1 || imageHeight > 4096) {
      throw new HttpError(400, "사진 크기를 확인하지 못했습니다.");
    }
    const fileId = crypto.randomUUID();
    const now = new Date().toISOString();
    const extension = contentType === "image/webp" ? "webp" : "jpg";
    const fileName = `chat-photo-${now.replace(/[:.]/g, "-")}.${extension}`;
    const storageKey = `chat-images/${roomId}/${fileId}.${extension}`;
    const profile = user.role === "member" ? await chatProfile(env, user.id) : null;
    const author = user.role === "member" ? profile?.nickname ?? user.display_name : match!.persona_nickname;
    const message: MessageRecord = {
      id: crypto.randomUUID(), roomId, senderId: user.id, author, text: "사진",
      createdAt: now, type: "image", attachmentId: fileId, imageWidth, imageHeight,
      byteSize: bytes.byteLength,
    };
    try {
      await env.FILES.put(storageKey, bytes, {
        httpMetadata: { contentType },
        customMetadata: { roomId, uploaderId: user.id, messageId: message.id },
      });
      await env.DB.prepare(`
        INSERT INTO files (id, room_id, uploader_id, storage_key, file_name, content_type, byte_size, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(fileId, roomId, user.id, storageKey, fileName, contentType, bytes.byteLength, now).run();
      await roomStub(env, roomId).fetch(new Request(`${url.origin}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(message),
      }));
    } catch (error) {
      await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(fileId).run().catch(() => undefined);
      await env.FILES.delete(storageKey).catch(() => undefined);
      throw error;
    }
    await env.DB.prepare("UPDATE random_matches SET last_message_at = ? WHERE room_id = ?")
      .bind(now, roomId).run();
    ctx.waitUntil(audit(env, request, user.id, "chat.image_uploaded", "file", fileId, {
      roomId, messageId: message.id, byteSize: bytes.byteLength, imageWidth, imageHeight,
    }));
    return json({ message }, 201);
  }

  if (url.pathname === "/api/cloudflare/files" && request.method === "GET") {
    const roomId = url.searchParams.get("roomId") ?? "";
    await requireRoomMember(env, roomId, user.id);
    const result = await env.DB.prepare(`
      SELECT f.id, f.file_name AS fileName, f.content_type AS contentType, f.byte_size AS byteSize,
        f.created_at AS createdAt, u.display_name AS uploader
      FROM files f JOIN users u ON u.id = f.uploader_id
      WHERE f.room_id = ? AND f.deleted_at IS NULL
      ORDER BY f.created_at DESC LIMIT 100
    `).bind(roomId).all();
    return json({ files: result.results });
  }

  if (url.pathname === "/api/cloudflare/files" && request.method === "POST") {
    const roomId = url.searchParams.get("roomId") ?? "";
    await requireRoomMember(env, roomId, user.id);
    const length = Number(request.headers.get("Content-Length") ?? 0);
    if (!request.body || length <= 0 || length > MAX_FILE_BYTES) {
      throw new HttpError(413, "파일은 25MB 이하만 업로드할 수 있습니다.");
    }
    const originalName = decodeURIComponent(request.headers.get("X-File-Name") ?? "file")
      .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")
      .slice(0, 180);
    const contentType = (request.headers.get("Content-Type") ?? "application/octet-stream").slice(0, 120);
    const fileId = crypto.randomUUID();
    const storageKey = `${roomId}/${fileId}`;
    await env.FILES.put(storageKey, request.body, {
      httpMetadata: { contentType },
      customMetadata: { roomId, uploaderId: user.id, originalName },
    });
    await env.DB.prepare(`
      INSERT INTO files (id, room_id, uploader_id, storage_key, file_name, content_type, byte_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(fileId, roomId, user.id, storageKey, originalName, contentType, length, new Date().toISOString()).run();
    ctx.waitUntil(audit(env, request, user.id, "file.uploaded", "file", fileId, { roomId, byteSize: length }));
    return json({ file: { id: fileId, fileName: originalName, contentType, byteSize: length } }, 201);
  }

  const fileMatch = url.pathname.match(/^\/api\/cloudflare\/files\/([^/]+)$/);
  if (fileMatch && request.method === "GET") {
    const metadata = await env.DB.prepare(`
      SELECT f.room_id, f.storage_key, f.file_name, f.content_type, f.byte_size
      FROM files f WHERE f.id = ? AND f.deleted_at IS NULL
    `).bind(fileMatch[1]).first<{
      room_id: string;
      storage_key: string;
      file_name: string;
      content_type: string;
      byte_size: number;
    }>();
    if (!metadata) throw new HttpError(404, "파일을 찾을 수 없습니다.");
    if (user.role === "member") await requireRoomMember(env, metadata.room_id, user.id);
    else requireAdmin(user);
    const object = await env.FILES.get(metadata.storage_key);
    if (!object) throw new HttpError(404, "저장된 파일을 찾을 수 없습니다.");
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", metadata.content_type);
    headers.set("Content-Length", String(metadata.byte_size));
    const inline = url.searchParams.get("view") === "inline" && metadata.content_type.startsWith("image/");
    headers.set("Content-Disposition", inline
      ? "inline"
      : `attachment; filename*=UTF-8''${encodeURIComponent(metadata.file_name)}`);
    headers.set("Cache-Control", "private, no-store");
    return new Response(object.body, { headers });
  }

  if (url.pathname === "/api/cloudflare/admin/users" && request.method === "GET") {
    requireAdmin(user);
    const result = await env.DB.prepare(`
      SELECT id, email, display_name, organization, role, status, created_at, approved_at, last_login_at
      FROM users ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 250
    `).all();
    return json({ users: result.results });
  }

  const userStatusMatch = url.pathname.match(/^\/api\/cloudflare\/admin\/users\/([^/]+)\/status$/);
  if (userStatusMatch && request.method === "PATCH") {
    requireAdmin(user);
    const body = await readJsonBody<{ status?: unknown }>(request);
    const status = String(body.status ?? "");
    if (!["active", "rejected", "suspended"].includes(status)) {
      throw new HttpError(400, "허용되지 않은 계정 상태입니다.");
    }
    const target = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?")
      .bind(userStatusMatch[1]).first<{ id: string; role: string }>();
    if (!target) throw new HttpError(404, "회원을 찾을 수 없습니다.");
    if (target.role === "super_admin" && user.id !== target.id) {
      throw new HttpError(403, "최고 관리자 상태는 다른 관리자가 변경할 수 없습니다.");
    }
    const now = new Date().toISOString();
    await env.DB.prepare(`
      UPDATE users SET status = ?, updated_at = ?, approved_at = CASE WHEN ? = 'active' THEN ? ELSE approved_at END,
        approved_by = CASE WHEN ? = 'active' THEN ? ELSE approved_by END WHERE id = ?
    `).bind(status, now, status, now, status, user.id, target.id).run();
    if (status === "active") {
      const defaultRoom = await env.DB.prepare("SELECT id FROM rooms WHERE archived_at IS NULL ORDER BY created_at ASC LIMIT 1")
        .first<{ id: string }>();
      if (defaultRoom) {
        await env.DB.prepare(`
          INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)
          ON CONFLICT(room_id, user_id) DO NOTHING
        `).bind(defaultRoom.id, target.id, now).run();
      }
    } else {
      await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id).run();
    }
    await audit(env, request, user.id, `user.${status}`, "user", target.id);
    return json({ ok: true, status });
  }

  if (url.pathname === "/api/cloudflare/admin/invitations" && request.method === "POST") {
    requireAdmin(user);
    const body = await readJsonBody<{ label?: unknown; roomId?: unknown; maxUses?: unknown; expiresInDays?: unknown }>(request);
    const roomId = String(body.roomId ?? "");
    const room = await env.DB.prepare(
      "SELECT id, name FROM rooms WHERE id = ? AND archived_at IS NULL",
    ).bind(roomId).first<{ id: string; name: string }>();
    if (!room) throw new HttpError(404, "초대할 채팅방을 찾을 수 없습니다.");
    const maxUses = Math.min(Math.max(Number(body.maxUses) || 1, 1), 100);
    const days = Math.min(Math.max(Number(body.expiresInDays) || 7, 1), 90);
    const raw = randomToken(12).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    const code = raw.match(/.{1,4}/g)?.join("-") ?? raw;
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(`
      INSERT INTO invitations (id, code_hash, label, room_id, max_uses, expires_at, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      await sha256(normalizeInvite(code)),
      String(body.label ?? "").trim().slice(0, 80),
      roomId,
      maxUses,
      expiresAt,
      user.id,
      new Date().toISOString(),
    ).run();
    await audit(env, request, user.id, "invitation.created", "invitation", id, { roomId, maxUses, expiresAt });
    return json({ invitation: { id, code, roomId, roomName: room.name, maxUses, expiresAt } }, 201);
  }

  if (url.pathname === "/api/cloudflare/admin/rooms" && request.method === "POST") {
    requireAdmin(user);
    const body = await readJsonBody<{ name?: unknown; description?: unknown }>(request);
    const name = String(body.name ?? "").trim().slice(0, 80);
    if (name.length < 2) throw new HttpError(400, "채팅방 이름은 2자 이상 입력해 주세요.");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO rooms (id, name, description, owner_id, created_at) VALUES (?, ?, ?, ?, ?)
      `).bind(id, name, String(body.description ?? "").trim().slice(0, 300), user.id, now),
      env.DB.prepare("INSERT INTO room_members (room_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
        .bind(id, user.id, now),
    ]);
    await audit(env, request, user.id, "room.created", "room", id);
    return json({ room: { id, name, description: body.description ?? "", type: "group", members: 1 } }, 201);
  }

  const adminMessageMatch = url.pathname.match(/^\/api\/cloudflare\/admin\/rooms\/([^/]+)\/messages\/([^/]+)$/);
  if (adminMessageMatch && request.method === "DELETE") {
    requireAdmin(user);
    const [, roomId, messageId] = adminMessageMatch;
    await roomStub(env, roomId).fetch(new Request(`${url.origin}/messages/${encodeURIComponent(messageId)}`, {
      method: "DELETE",
    }));
    await audit(env, request, user.id, "message.deleted", "message", messageId, { roomId });
    return json({ ok: true });
  }

  return json({ error: "API 요청을 찾을 수 없습니다." }, 404);
}

const worker = {
  async fetch(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      const incomingUrl = new URL(request.url);
      if (incomingUrl.hostname.endsWith(".chatgpt.site") && incomingUrl.pathname.startsWith("/api/")) {
        const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, PUBLIC_WORKER_ORIGIN);
        const headers = new Headers(request.headers);
        headers.set("Origin", PUBLIC_WORKER_ORIGIN);
        const proxyRequest = new Request(targetUrl, {
          method: request.method,
          headers,
          body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
          redirect: "manual",
        });
        return withSecurityHeaders(await fetch(proxyRequest));
      }

      const apiResponse = await api(request, env, ctx);
      if (apiResponse) return withSecurityHeaders(apiResponse);

      const url = incomingUrl;
      if (url.pathname === "/_vinext/image") {
        const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
        const response = await handleImageOptimization(request, {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body)
              .transform(width > 0 ? { width } : {})
              .output({ format, quality });
            return result.response();
          },
        }, allowedWidths);
        return withSecurityHeaders(response);
      }

      return withSecurityHeaders(await handler.fetch(request, env, ctx));
    } catch (error) {
      if (error instanceof HttpError) {
        return withSecurityHeaders(json({ error: error.message }, error.status));
      }
      console.error("Unhandled request error", error);
      return withSecurityHeaders(json({ error: "서버 요청을 처리하지 못했습니다." }, 500));
    }
  },
};

export default worker;
