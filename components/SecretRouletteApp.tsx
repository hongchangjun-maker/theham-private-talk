"use client";
/* Avatar images are pre-sized 480px WebP files; direct img tags avoid runtime transform cost. */
/* eslint-disable @next/next/no-img-element */

import {
  ArrowLeft, Bot, Check, ChevronRight, CircleUserRound, Flag, Heart,
  LockKeyhole, LogOut, MessageCircleHeart, Send, ShieldCheck, Sparkles,
  UserRoundSearch, UsersRound, X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type User = { id: string; display_name: string; role: "member" | "admin" | "super_admin"; status: string };
type Profile = { user_id: string; nickname: string; avatar_id: string };
type Persona = { nickname: string; gender: string; region: string; ageBand: string; job: string; avatarId: string };
type Match = { id: string; roomId: string; kind: "operator" | "ai"; status: string; createdAt: string; persona: Persona; requester?: { nickname: string; avatarId: string } };
type Message = { id: string; roomId: string; senderId: string; author: string; text: string; createdAt: string };
type Screen = "loading" | "welcome" | "signup" | "login" | "home" | "match" | "roulette" | "chat" | "admin-login" | "admin";

const avatars = [
  { id: "f1", src: "/avatars/f1.webp", label: "우아한 스타일", gender: "여성" },
  { id: "f2", src: "/avatars/f2.webp", label: "단정한 스타일", gender: "여성" },
  { id: "f3", src: "/avatars/f3.webp", label: "활기찬 스타일", gender: "여성" },
  { id: "f4", src: "/avatars/f4.webp", label: "세련된 스타일", gender: "여성" },
  { id: "f5", src: "/avatars/f5.webp", label: "시크한 스타일", gender: "여성" },
  { id: "m1", src: "/avatars/m1.webp", label: "근육질 스타일", gender: "남성" },
  { id: "m2", src: "/avatars/m2.webp", label: "부드러운 스타일", gender: "남성" },
  { id: "m3", src: "/avatars/m3.webp", label: "강인한 스타일", gender: "남성" },
  { id: "m4", src: "/avatars/m4.webp", label: "지적인 스타일", gender: "남성" },
  { id: "m5", src: "/avatars/m5.webp", label: "캐주얼 스타일", gender: "남성" },
] as const;

const regions = ["상관없음", "서울", "경기", "인천", "부산", "대구", "대전", "광주", "울산", "강원", "충청", "전라", "경상", "제주"];
const ageBands = ["상관없음", "20대", "30대", "40대", "50대 이상"];
const jobs = ["상관없음", "회사원", "자영업", "프리랜서", "전문직", "공무원", "학생", "기타"];

function avatarSrc(id?: string) {
  return avatars.find((item) => item.id === id)?.src ?? "/avatars/f2.webp";
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}

function Avatar({ id, size = "md", alt = "아바타" }: { id?: string; size?: "sm" | "md" | "lg" | "xl"; alt?: string }) {
  return <img className={`sr-avatar sr-avatar-${size}`} src={avatarSrc(id)} alt={alt} />;
}

function TopBar({ title, onBack, right }: { title: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <header className="sr-topbar">
      {onBack ? <button className="sr-icon-btn" onClick={onBack} aria-label="뒤로 가기"><ArrowLeft /></button> : <span className="sr-top-spacer" />}
      <strong>{title}</strong>
      <div className="sr-top-right">{right}</div>
    </header>
  );
}

export function SecretRouletteApp() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [activeMatch, setActiveMatch] = useState<Match | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadMatches = useCallback(async () => {
    const data = await api<{ matches: Match[] }>("/api/random/matches");
    setMatches(data.matches);
    return data.matches;
  }, []);

  useEffect(() => {
    api<{ authenticated: boolean; user: User | null; profile: Profile | null }>("/api/cloudflare/session")
      .then(async (data) => {
        if (!data.authenticated || !data.user) return setScreen("welcome");
        setUser(data.user);
        setProfile(data.profile);
        if (data.user.role !== "member") return setScreen("admin");
        if (!data.profile) return setScreen("welcome");
        await loadMatches().catch(() => undefined);
        setScreen("home");
      })
      .catch(() => setScreen("welcome"));
  }, [loadMatches]);

  async function logout() {
    await api("/api/cloudflare/logout", { method: "POST" }).catch(() => undefined);
    setUser(null); setProfile(null); setMatches([]); setActiveMatch(null); setScreen("welcome");
  }

  function openChat(match: Match) { setActiveMatch(match); setScreen("chat"); }

  return (
    <main className="sr-stage">
      <div className="sr-phone">
        <div className="sr-status"><span>THEHAM</span><span className="sr-status-live">● 안전 연결</span></div>
        <div className="sr-screen">
          {notice && <div className="sr-toast" role="status">{notice}<button onClick={() => setNotice("")}><X /></button></div>}
          {screen === "loading" && <Loading />}
          {screen === "welcome" && <Welcome onSignup={() => setScreen("signup")} onLogin={() => setScreen("login")} onAdmin={() => setScreen("admin-login")} />}
          {screen === "signup" && <Signup busy={busy} onBack={() => setScreen("welcome")} onSubmit={async (payload) => {
            setBusy(true); setNotice("");
            try {
              const data = await api<{ user: User; profile: Profile }>("/api/random/signup", { method: "POST", body: JSON.stringify(payload) });
              setUser(data.user); setProfile(data.profile); setMatches([]); setScreen("home");
            } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
          }} />}
          {screen === "login" && <MemberLogin busy={busy} onBack={() => setScreen("welcome")} onSubmit={async (name, phoneLast4) => {
            setBusy(true); setNotice("");
            try {
              const data = await api<{ user: User; profile: Profile }>("/api/random/login", { method: "POST", body: JSON.stringify({ name, phoneLast4 }) });
              setUser(data.user); setProfile(data.profile); await loadMatches(); setScreen("home");
            } catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
          }} />}
          {screen === "home" && profile && <Home profile={profile} matches={matches} onMatch={() => setScreen("match")} onAi={async () => {
            setBusy(true); setNotice("");
            try { const data = await api<{ match: Match }>("/api/random/ai/start", { method: "POST" }); await loadMatches(); openChat(data.match); }
            catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
          }} onOpen={openChat} onLogout={logout} busy={busy} />}
          {screen === "match" && <MatchSetup onBack={() => setScreen("home")} onStart={async (preferences) => {
            setScreen("roulette"); setNotice("");
            try {
              const [data] = await Promise.all([
                api<{ match: Match }>("/api/random/matches", { method: "POST", body: JSON.stringify(preferences) }),
                new Promise((resolve) => setTimeout(resolve, 5000)),
              ]);
              setActiveMatch(data.match); await loadMatches(); setScreen("chat");
            } catch (error) { setNotice((error as Error).message); setScreen("match"); }
          }} />}
          {screen === "roulette" && <Roulette />}
          {screen === "chat" && activeMatch && user && <Chat match={activeMatch} user={user} profile={profile} admin={false} onBack={async () => { await loadMatches().catch(() => undefined); setScreen("home"); }} onBlocked={() => { setActiveMatch(null); loadMatches().catch(() => undefined); setScreen("home"); }} setNotice={setNotice} />}
          {screen === "admin-login" && <AdminLogin busy={busy} onBack={() => setScreen("welcome")} onSubmit={async (pin) => {
            setBusy(true); setNotice("");
            try { const data = await api<{ user: User }>("/api/cloudflare/master-login", { method: "POST", body: JSON.stringify({ pin }) }); setUser(data.user); setScreen("admin"); }
            catch (error) { setNotice((error as Error).message); } finally { setBusy(false); }
          }} />}
          {screen === "admin" && user && <AdminDashboard user={user} onLogout={logout} setNotice={setNotice} />}
        </div>
        <div className="sr-home-indicator" />
      </div>
    </main>
  );
}

function Loading() { return <div className="sr-center"><div className="sr-pulse-logo"><MessageCircleHeart /></div><p>안전하게 연결하고 있어요</p></div>; }

function Welcome({ onSignup, onLogin, onAdmin }: { onSignup: () => void; onLogin: () => void; onAdmin: () => void }) {
  return (
    <section className="sr-welcome">
      <div className="sr-welcome-art"><div className="sr-orbit"><Avatar id="f3" size="lg" /><Avatar id="m2" size="lg" /></div></div>
      <div className="sr-brand"><span className="sr-brand-mark"><MessageCircleHeart /></span><p>THEHAM</p><h1>비밀친구</h1><span>AI 또는 새로운 사람과<br />편안하게 이야기해 보세요.</span></div>
      <div className="sr-welcome-actions">
        <button className="sr-primary sr-big" onClick={onSignup}><Heart /> 처음이에요 · 회원가입</button>
        <button className="sr-secondary sr-big" onClick={onLogin}><CircleUserRound /> 이미 가입했어요</button>
        <p className="sr-age-note"><ShieldCheck /> 만 19세 이상 성인만 이용할 수 있어요.</p>
        <button className="sr-admin-link" onClick={onAdmin}><LockKeyhole /> 마스터 관리자</button>
      </div>
    </section>
  );
}

function Signup({ onBack, onSubmit, busy }: { onBack: () => void; onSubmit: (data: Record<string, unknown>) => void; busy: boolean }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [nickname, setNickname] = useState("");
  const [avatarId, setAvatarId] = useState(""); const [adult, setAdult] = useState(false); const [terms, setTerms] = useState(false);
  function submit(event: FormEvent) { event.preventDefault(); onSubmit({ name, phoneNumber: phone, nickname, avatarId, adultAccepted: adult, termsAccepted: terms }); }
  return <section className="sr-page"><TopBar title="3분 회원가입" onBack={onBack} /><form className="sr-scroll sr-form" onSubmit={submit}>
    <div className="sr-step-title"><span>1</span><div><strong>내 정보를 적어 주세요</strong><p>다른 사람에게는 닉네임만 보여요.</p></div></div>
    <label>이름<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} required /></label>
    <label>전화번호<input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))} inputMode="numeric" autoComplete="tel" pattern="\d{10,11}" minLength={10} maxLength={11} required /><small>전화번호 전체를 숫자로 입력해 주세요. 로그인할 때는 끝 4자리만 사용합니다.</small></label>
    <label>채팅 닉네임<input value={nickname} onChange={(e) => setNickname(e.target.value.slice(0, 10))} minLength={2} maxLength={10} required /><small>한글·영문·숫자로 2~10글자까지 입력할 수 있어요.</small></label>
    <div className="sr-step-title"><span>2</span><div><strong>내 아바타를 골라 주세요</strong><p>사진을 누르면 선택돼요.</p></div></div>
    <AvatarGrid value={avatarId} onChange={setAvatarId} />
    <div className="sr-step-title"><span>3</span><div><strong>안전 약속을 확인해 주세요</strong></div></div>
    <label className="sr-check"><input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} /><span><b>나는 만 19세 이상 성인입니다.</b></span></label>
    <label className="sr-check"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /><span><b>욕설·괴롭힘·불법 대화를 하지 않겠습니다.</b><small><a href="/terms" target="_blank">이용규칙</a>과 <a href="/privacy" target="_blank">개인정보 안내</a>에 동의합니다.</small></span></label>
    <button className="sr-primary sr-big sr-sticky-button" disabled={busy || !avatarId || !adult || !terms}>{busy ? "만드는 중…" : "회원가입 끝내기"}<ChevronRight /></button>
  </form></section>;
}

function AvatarGrid({ value, onChange, filter }: { value: string; onChange: (id: string) => void; filter?: string }) {
  const items = filter && filter !== "상관없음" ? avatars.filter((item) => item.gender === filter) : avatars;
  return <div className="sr-avatar-grid">{items.map((item) => <button type="button" key={item.id} className={value === item.id ? "selected" : ""} onClick={() => onChange(item.id)} aria-label={item.label}>
    <img src={item.src} alt={item.label} />{value === item.id && <span><Check /></span>}<small>{item.label}</small>
  </button>)}</div>;
}

function MemberLogin({ onBack, onSubmit, busy }: { onBack: () => void; onSubmit: (name: string, phone: string) => void; busy: boolean }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState("");
  return <section className="sr-page"><TopBar title="다시 들어오기" onBack={onBack} /><form className="sr-auth-card" onSubmit={(e) => { e.preventDefault(); onSubmit(name, phone); }}>
    <div className="sr-round-icon"><CircleUserRound /></div><h2>가입할 때 쓴 내용을 적으세요</h2><p>이름과 전화번호 끝 4자리만 있으면 돼요.</p>
    <label>이름<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} required /></label>
    <label>전화번호 끝 4자리<input value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" autoComplete="tel" pattern="\d{4}" required /></label>
    <button className="sr-primary sr-big" disabled={busy}>{busy ? "확인 중…" : "내 채팅으로 들어가기"}</button>
  </form></section>;
}

function Home({ profile, matches, onMatch, onAi, onOpen, onLogout, busy }: { profile: Profile; matches: Match[]; onMatch: () => void; onAi: () => void; onOpen: (m: Match) => void; onLogout: () => void; busy: boolean }) {
  const live = matches.filter((match) => match.status === "live");
  return <section className="sr-page sr-home"><TopBar title="비밀친구" right={<button className="sr-icon-btn" onClick={onLogout} aria-label="나가기"><LogOut /></button>} />
    <div className="sr-scroll"><div className="sr-profile-card"><Avatar id={profile.avatar_id} size="lg" /><div><small>내 닉네임</small><h2>{profile.nickname}</h2><span><ShieldCheck /> 성인 확인 완료</span></div></div>
      <div className="sr-home-title"><p>지금 누구와</p><h1>이야기할까요?</h1></div>
      <button className="sr-choice sr-choice-human" onClick={onMatch}><span><UserRoundSearch /></span><div><b>새로운 사람 찾기</b><small>원하는 상대를 고르고 5초면 연결</small></div><ChevronRight /></button>
      <button className="sr-choice sr-choice-ai" onClick={onAi} disabled={busy}><span><Bot /></span><div><b>루미 AI와 대화</b><small>기다리지 않고 바로 이야기하기</small></div><ChevronRight /></button>
      {live.length > 0 && <div className="sr-recent"><h3>이어 할 대화</h3>{live.map((match) => <button key={match.id} onClick={() => onOpen(match)}><Avatar id={match.persona.avatarId} /><div><b>{match.persona.nickname}</b><small>{match.kind === "ai" ? "AI 친구" : "테스트 운영자 대행"} · LIVE</small></div><ChevronRight /></button>)}</div>}
      <div className="sr-safety-tip"><ShieldCheck /><p><b>안전하게 이용해 주세요</b><span>전화번호·주소·계좌번호는 보내지 마세요. 불편하면 바로 신고하거나 차단할 수 있어요.</span></p></div>
    </div></section>;
}

function MatchSetup({ onBack, onStart }: { onBack: () => void; onStart: (data: Record<string, string>) => void }) {
  const [nickname, setNickname] = useState(""); const [gender, setGender] = useState("여성"); const [region, setRegion] = useState("상관없음");
  const [ageBand, setAge] = useState("상관없음"); const [job, setJob] = useState("상관없음"); const [avatarId, setAvatar] = useState("f1");
  function chooseGender(value: string) { setGender(value); setAvatar(value === "남성" ? "m1" : "f1"); }
  return <section className="sr-page"><TopBar title="원하는 친구 고르기" onBack={onBack} /><div className="sr-scroll sr-form">
    <div className="sr-help-banner"><Sparkles /><p><b>아는 것만 고르세요.</b><span>상관없으면 그대로 두면 돼요.</span></p></div>
    <label>상대 닉네임 <small>(안 적어도 돼요)</small><input value={nickname} onChange={(e) => setNickname(e.target.value.slice(0, 12))} placeholder="예: 하린" /></label>
    <fieldset><legend>성별</legend><div className="sr-chips">{["여성", "남성", "상관없음"].map((v) => <button type="button" className={gender === v ? "active" : ""} onClick={() => chooseGender(v)} key={v}>{v}</button>)}</div></fieldset>
    <div className="sr-select-row"><label>지역<select value={region} onChange={(e) => setRegion(e.target.value)}>{regions.map((v) => <option key={v}>{v}</option>)}</select></label><label>나이대<select value={ageBand} onChange={(e) => setAge(e.target.value)}>{ageBands.map((v) => <option key={v}>{v}</option>)}</select></label></div>
    <label>직업<select value={job} onChange={(e) => setJob(e.target.value)}>{jobs.map((v) => <option key={v}>{v}</option>)}</select></label>
    <fieldset><legend>상대 아바타</legend><AvatarGrid value={avatarId} onChange={setAvatar} filter={gender} /></fieldset>
    <div className="sr-beta-note"><UsersRound /><p><b>현재는 테스트 버전입니다.</b><span>실제 일반 회원 대신 관리자가 선택된 상대 역할로 답합니다.</span></p></div>
    <button className="sr-primary sr-big" onClick={() => onStart({ nickname, gender, region, ageBand, job, avatarId })}><Sparkles /> 5초 룰렛 시작하기</button>
  </div></section>;
}

function Roulette() {
  const [index, setIndex] = useState(0); const [left, setLeft] = useState(5);
  useEffect(() => { const spin = setInterval(() => setIndex((v) => (v + 1) % avatars.length), 160); const timer = setInterval(() => setLeft((v) => Math.max(0, v - 1)), 1000); return () => { clearInterval(spin); clearInterval(timer); }; }, []);
  return <section className="sr-roulette"><div className="sr-roulette-glow" /><p>두근두근</p><h1>새로운 친구를<br />찾고 있어요</h1><div className="sr-wheel"><div className="sr-wheel-ring" /><Avatar id={avatars[index].id} size="xl" /><span className="sr-wheel-heart"><Heart /></span></div><div className="sr-search-dots"><i /><i /><i /></div><b>{left > 0 ? `${left}초만 기다려 주세요` : "연결 중이에요"}</b><small>화면을 닫지 마세요.</small></section>;
}

function Chat({ match, user, admin, onBack, onBlocked, setNotice }: { match: Match; user: User; profile: Profile | null; admin: boolean; onBack: () => void; onBlocked?: () => void; setNotice: (v: string) => void }) {
  const [messages, setMessages] = useState<Message[]>([]); const [text, setText] = useState(""); const [sending, setSending] = useState(false); const [menu, setMenu] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let socket: WebSocket | null = null; let cancelled = false;
    api<{ messages: Message[] }>(`/api/cloudflare/rooms/${match.roomId}/messages?limit=120`).then((data) => { if (!cancelled) setMessages(data.messages); }).catch((e) => setNotice(e.message));
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${location.host}/api/cloudflare/rooms/${match.roomId}/socket`);
    socket.onmessage = (event) => { try { const data = JSON.parse(event.data); if (data.type === "message") setMessages((current) => current.some((m) => m.id === data.message.id) ? current : [...current, data.message]); } catch { /* heartbeat */ } };
    return () => { cancelled = true; socket?.close(); };
  }, [match.roomId, setNotice]);
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages]);
  async function send(event: FormEvent) {
    event.preventDefault(); const value = text.trim(); if (!value || sending) return; setText(""); setSending(true);
    try {
      const path = admin ? `/api/random/admin/matches/${match.id}/messages` : match.kind === "ai" ? `/api/random/ai/${match.roomId}/messages` : `/api/cloudflare/rooms/${match.roomId}/messages`;
      await api(path, { method: "POST", body: JSON.stringify({ text: value }) });
    } catch (error) { setText(value); setNotice((error as Error).message); } finally { setSending(false); }
  }
  return <section className="sr-page sr-chat"><header className="sr-chat-head"><button className="sr-icon-btn" onClick={onBack}><ArrowLeft /></button><Avatar id={match.persona.avatarId} /><div><b>{match.persona.nickname}{match.kind === "ai" && <em>AI</em>}</b><span><i /> LIVE · 지금 연결됨</span></div>{!admin && <button className="sr-more" onClick={() => setMenu(!menu)}>•••</button>}</header>
    {menu && <div className="sr-chat-menu"><p>불편한 대화인가요?</p><button onClick={async () => { try { await api(`/api/random/matches/${match.id}/report`, { method: "POST", body: JSON.stringify({ reason: "불쾌하거나 부적절한 대화" }) }); setNotice("신고가 접수되었습니다."); setMenu(false); } catch (e) { setNotice((e as Error).message); } }}><Flag /> 신고하기</button><button className="danger" onClick={async () => { if (!confirm("이 대화를 차단하고 끝낼까요?")) return; try { await api(`/api/random/matches/${match.id}/block`, { method: "POST" }); onBlocked?.(); } catch (e) { setNotice((e as Error).message); } }}><X /> 차단하고 끝내기</button></div>}
    <div className="sr-chat-info">{match.kind === "ai" ? "AI가 답하는 대화입니다." : "베타 테스트: 관리자가 상대 역할로 답합니다."}</div>
    <div className="sr-messages"><div className="sr-day">오늘</div>{messages.length === 0 && <div className="sr-empty-chat"><MessageCircleHeart /><b>연결되었어요!</b><span>먼저 “안녕하세요”라고 보내 보세요.</span></div>}{messages.map((message) => {
      const mine = message.senderId === user.id; return <div className={`sr-message ${mine ? "mine" : "theirs"}`} key={message.id}>{!mine && <Avatar id={match.persona.avatarId} size="sm" />}<div>{!mine && <small>{message.author}</small>}<p>{message.text}</p><time>{new Date(message.createdAt).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })}</time></div></div>;
    })}<div ref={endRef} /></div>
    <form className="sr-composer" onSubmit={send}><input value={text} onChange={(e) => setText(e.target.value)} placeholder="메시지를 입력하세요" maxLength={2000} /><button disabled={!text.trim() || sending} aria-label="보내기"><Send /></button></form>
  </section>;
}

function AdminLogin({ onBack, onSubmit, busy }: { onBack: () => void; onSubmit: (pin: string) => void; busy: boolean }) {
  const [pin, setPin] = useState("");
  return <section className="sr-page"><TopBar title="마스터 관리자" onBack={onBack} /><form className="sr-auth-card" onSubmit={(e) => { e.preventDefault(); onSubmit(pin); }}><div className="sr-round-icon"><LockKeyhole /></div><h2>관리자 비밀번호</h2><p>관리자만 들어갈 수 있습니다.</p><label>비밀번호<input type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" placeholder="숫자 비밀번호" autoFocus required /></label><button className="sr-primary sr-big" disabled={busy}>{busy ? "확인 중…" : "관리 화면 들어가기"}</button></form></section>;
}

function AdminDashboard({ user, onLogout, setNotice }: { user: User; onLogout: () => void; setNotice: (v: string) => void }) {
  const [matches, setMatches] = useState<Match[]>([]); const [selected, setSelected] = useState<Match | null>(null); const [loading, setLoading] = useState(true);
  const load = useCallback(() => api<{ matches: Match[] }>("/api/random/admin/matches").then((d) => setMatches(d.matches)).catch((e) => setNotice(e.message)).finally(() => setLoading(false)), [setNotice]);
  useEffect(() => { load(); const timer = setInterval(load, 10000); return () => clearInterval(timer); }, [load]);
  if (selected) return <Chat match={selected} user={user} profile={null} admin onBack={() => { setSelected(null); load(); }} setNotice={setNotice} />;
  return <section className="sr-page sr-admin"><TopBar title="대화 관리" right={<button className="sr-icon-btn" onClick={onLogout}><LogOut /></button>} /><div className="sr-scroll"><div className="sr-admin-hero"><ShieldCheck /><div><b>관리자 대행 채팅</b><span>회원이 고른 상대 역할로 답장합니다.</span></div></div><div className="sr-admin-count"><b>LIVE {matches.filter((m) => m.status === "live" && m.kind === "operator").length}</b><button onClick={load}>새로고침</button></div>{loading ? <p className="sr-list-empty">불러오는 중…</p> : matches.filter((m) => m.kind === "operator").length === 0 ? <p className="sr-list-empty">아직 들어온 랜덤 대화가 없습니다.</p> : <div className="sr-admin-list">{matches.filter((m) => m.kind === "operator").map((match) => <button key={match.id} onClick={() => setSelected(match)} disabled={match.status !== "live"}><Avatar id={match.requester?.avatarId} /><div><b>{match.requester?.nickname ?? "회원"} <span>→ {match.persona.nickname} 역할</span></b><small>{match.persona.gender} · {match.persona.region} · {match.persona.ageBand} · {match.persona.job}</small><em>{match.status === "live" ? "● LIVE · 답장하기" : "종료됨"}</em></div><ChevronRight /></button>)}</div>}</div></section>;
}
