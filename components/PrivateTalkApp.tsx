"use client";

import {
  AlertTriangle, Bell, CalendarDays, Camera, Check, ChevronLeft, CircleUserRound,
  Download, FileText, FolderOpen, Home, Image as ImageIcon, Info, Link2,
  LockKeyhole, LogOut, Menu, MessageCircle, Mic, MicOff, MonitorUp, MoreHorizontal,
  Paperclip, Phone, Plus, Search, Send, Settings, ShieldCheck, Smile,
  Users, Video, VideoOff, X,
} from "lucide-react";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

type View = "dashboard" | "chat" | "meetings" | "contacts" | "notifications" | "files" | "settings" | "admin";
type LoginMode = "login" | "invite" | "request";
type Room = { id: string; name: string; preview: string; time: string; unread: number; members: number; type: "direct" | "group" | "notice" };
type ChatMessage = { id: string; author: string; text: string; time: string; mine?: boolean };
type IntegrationState = { supabase: boolean; video: boolean; storage: boolean; webPush: boolean };

const navItems: Array<{ id: View; label: string; icon: typeof Home; badge?: number; admin?: boolean }> = [
  { id: "dashboard", label: "홈", icon: Home },
  { id: "chat", label: "채팅", icon: MessageCircle, badge: 4 },
  { id: "meetings", label: "영상회의", icon: Video },
  { id: "contacts", label: "연락처", icon: Users },
  { id: "notifications", label: "알림", icon: Bell, badge: 2 },
  { id: "files", label: "파일함", icon: FolderOpen },
  { id: "settings", label: "설정", icon: Settings },
  { id: "admin", label: "관리자 대시보드", icon: ShieldCheck, admin: true },
];

const initialRooms: Room[] = [
  { id: "design", name: "브랜드 프로젝트 TF", preview: "시안 검토는 오후 회의에서 함께 볼게요.", time: "10:42", unread: 3, members: 8, type: "group" },
  { id: "minseo", name: "김민서", preview: "자료 잘 받았습니다. 감사합니다!", time: "09:18", unread: 1, members: 2, type: "direct" },
  { id: "notice", name: "전사 공지", preview: "7월 보안 점검 일정을 확인해 주세요.", time: "어제", unread: 0, members: 26, type: "notice" },
  { id: "partner", name: "파트너 협의회", preview: "박준호님이 파일을 공유했습니다.", time: "화", unread: 0, members: 12, type: "group" },
];

const seedMessages: Record<string, ChatMessage[]> = {
  design: [
    { id: "m1", author: "김민서", text: "오전 회의에서 정리한 브랜드 가이드 초안을 공유드렸어요.", time: "오전 10:14" },
    { id: "m2", author: "나", text: "확인했습니다. 메인 컬러 대비만 조금 더 살펴볼게요.", time: "오전 10:19", mine: true },
    { id: "m3", author: "박준호", text: "모바일 화면도 같이 캡처해서 회의 자료에 넣겠습니다.", time: "오전 10:31" },
    { id: "m4", author: "김민서", text: "좋아요. 시안 검토는 오후 회의에서 함께 볼게요.", time: "오전 10:42" },
  ],
  minseo: [
    { id: "m5", author: "김민서", text: "요청하신 자료를 전달드렸습니다.", time: "오전 9:12" },
    { id: "m6", author: "나", text: "자료 잘 받았습니다. 감사합니다!", time: "오전 9:18", mine: true },
  ],
  notice: [{ id: "m7", author: "관리자", text: "7월 보안 점검은 금요일 오후 7시에 진행됩니다. 점검 중에는 약 10분간 접속이 제한될 수 있습니다.", time: "어제 오후 4:00" }],
  partner: [{ id: "m8", author: "박준호", text: "파트너 계약 검토용 파일을 공유했습니다.", time: "화요일 오후 2:18" }],
};

const people = [
  { name: "김민서", role: "브랜드 전략 · 더함스튜디오", status: "online", initial: "민" },
  { name: "박준호", role: "프로덕트 매니저 · 플랫폼팀", status: "online", initial: "준" },
  { name: "이서연", role: "UX 디자이너 · 디자인팀", status: "away", initial: "서" },
  { name: "최도윤", role: "파트너 · 외부 협력사", status: "offline", initial: "도" },
  { name: "정하린", role: "운영 매니저 · 커뮤니티팀", status: "online", initial: "하" },
  { name: "강유진", role: "보안 담당 · 인프라팀", status: "offline", initial: "유" },
];

const meetings = [
  { id: "meet-1", time: "14:00", date: "오늘", title: "브랜드 프로젝트 주간회의", desc: "브랜드 프로젝트 TF · 8명 초대", secure: true },
  { id: "meet-2", time: "16:30", date: "오늘", title: "신규 파트너 온보딩", desc: "파트너 협의회 · 5명 초대", secure: true },
  { id: "meet-3", time: "10:00", date: "내일", title: "서비스 운영 점검", desc: "운영팀 · 6명 초대", secure: false },
];

function initials(name: string) {
  return name.replace(/\s/g, "").slice(-2);
}

function Avatar({ name, size = "" }: { name: string; size?: "sm" | "lg" | "" }) {
  return <span className={`avatar ${size}`}>{initials(name)}</span>;
}

function Brand({ name }: { name: string }) {
  return (
    <div className="brand-lockup">
      <span className="brand-mark"><MessageCircle size={21} strokeWidth={2.4} /></span>
      <div><div className="brand-name">{name}</div><div style={{ fontSize: 9, color: "#a99aa1", letterSpacing: ".13em", marginTop: 2 }}>PRIVATE COMMUNICATION</div></div>
    </div>
  );
}

export function PrivateTalkApp() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [loginMode, setLoginMode] = useState<LoginMode>("login");
  const [view, setView] = useState<View>("dashboard");
  const [brandName, setBrandName] = useState("THEHAM PRIVATE TALK");
  const [activeRoom, setActiveRoom] = useState("design");
  const [mobileRoomOpen, setMobileRoomOpen] = useState(false);
  const [rooms, setRooms] = useState(initialRooms);
  const [messages, setMessages] = useState(seedMessages);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState("");
  const [meetingModal, setMeetingModal] = useState(false);
  const [meetingStage, setMeetingStage] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [settingsTab, setSettingsTab] = useState("brand");
  const [integration, setIntegration] = useState<IntegrationState>({ supabase: isSupabaseConfigured, video: false, storage: false, webPush: false });
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [scheduled, setScheduled] = useState(meetings);
  const [meetingTitle, setMeetingTitle] = useState("");
  const [createMeeting, setCreateMeeting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 420);
    fetch("/api/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { integrations?: IntegrationState }) => data.integrations && setIntegration(data.integrations))
      .catch(() => undefined);
    const beforeInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => { clearTimeout(timer); window.removeEventListener("beforeinstallprompt", beforeInstall); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => () => stopMedia(), []);

  const currentRoom = rooms.find((room) => room.id === activeRoom) ?? rooms[0];
  const currentMessages = messages[activeRoom] ?? [];
  const viewLabel = navItems.find((item) => item.id === view)?.label ?? "홈";

  function showToast(message: string) { setToast(message); }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const supabase = getSupabaseClient();
    if (!supabase) {
      showToast("Supabase 연결이 필요합니다. 아래의 제품 둘러보기를 이용해 주세요.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { showToast("로그인에 실패했습니다. 계정 상태와 입력값을 확인해 주세요."); return; }
    setSignedIn(true);
  }

  function enterDemo() {
    setDemoMode(true);
    setSignedIn(true);
    showToast("읽기·체험용 데모 모드로 입장했습니다.");
  }

  function logout() {
    getSupabaseClient()?.auth.signOut().catch(() => undefined);
    stopMedia();
    setSignedIn(false);
    setDemoMode(false);
    setView("dashboard");
  }

  function changeView(next: View) {
    setView(next);
    setMobileRoomOpen(false);
  }

  function submitMessage() {
    const text = draft.trim();
    if (!text) return;
    if (!demoMode && !integration.supabase) {
      showToast("실시간 채팅 서버가 연결되지 않아 전송하지 않았습니다.");
      return;
    }
    const next: ChatMessage = { id: crypto.randomUUID(), author: "나", text, time: new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }), mine: true };
    setMessages((prev) => ({ ...prev, [activeRoom]: [...(prev[activeRoom] ?? []), next] }));
    setRooms((prev) => prev.map((room) => room.id === activeRoom ? { ...room, preview: text, time: "방금", unread: 0 } : room));
    setDraft("");
    showToast(demoMode ? "이 기기의 데모 대화에 추가했습니다." : "메시지를 전송했습니다.");
  }

  function onDraftKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitMessage(); }
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) { showToast("이 브라우저는 카메라 장치 점검을 지원하지 않습니다."); return; }
    try {
      stopMedia();
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOn(true);
      setMicOn(stream.getAudioTracks().some((track) => track.enabled));
      showToast("카메라와 마이크가 이 기기에서 정상 동작합니다.");
    } catch {
      setCameraOn(false);
      showToast("카메라 또는 마이크 권한이 거부되었습니다. 브라우저 설정을 확인해 주세요.");
    }
  }

  function stopMedia() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  function toggleCamera() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) { startCamera(); return; }
    track.enabled = !track.enabled;
    setCameraOn(track.enabled);
  }

  function toggleMic() {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) { startCamera(); return; }
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }

  function tryJoinMeeting() {
    if (!integration.video) {
      showToast("영상회의 제공자 설정 전에는 장치 점검만 가능합니다.");
      return;
    }
    setMeetingModal(false);
    setMeetingStage(true);
  }

  async function enableNotifications() {
    if (!("Notification" in window)) { showToast("이 브라우저는 알림을 지원하지 않습니다."); return; }
    const permission = await Notification.requestPermission();
    setNotificationsEnabled(permission === "granted");
    showToast(permission === "granted" ? "이 기기에서 브라우저 알림을 허용했습니다." : "알림 권한이 허용되지 않았습니다.");
  }

  async function installApp() {
    const prompt = installPrompt as (Event & { prompt?: () => Promise<void> }) | null;
    if (!prompt?.prompt) { showToast("브라우저 메뉴에서 ‘홈 화면에 추가’를 선택해 주세요."); return; }
    await prompt.prompt();
    setInstallPrompt(null);
  }

  function saveMeeting(event: FormEvent) {
    event.preventDefault();
    if (!meetingTitle.trim()) return;
    setScheduled((prev) => [...prev, { id: crypto.randomUUID(), time: "15:00", date: "8월 2일", title: meetingTitle.trim(), desc: "새 예약회의 · 초대 전", secure: true }]);
    setMeetingTitle("");
    setCreateMeeting(false);
    showToast(demoMode ? "데모 일정에 회의를 추가했습니다." : "회의를 예약했습니다.");
  }

  if (!ready) return <div className="loading-screen"><div className="loading-mark"><div className="loading-dot" />PRIVATE TALK</div></div>;
  if (!signedIn) return <LoginScreen mode={loginMode} setMode={setLoginMode} onLogin={handleLogin} onDemo={enterDemo} configured={integration.supabase} brand={brandName} showToast={showToast} toast={toast} />;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand name={brandName} />
        <nav className="nav-list" aria-label="주요 메뉴">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.id} className={`nav-button ${view === item.id ? "active" : ""}`} onClick={() => changeView(item.id)}>
                <Icon size={19} />{item.label}{item.badge ? <span className="nav-badge">{item.badge}</span> : null}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-box" aria-label="서비스 연결 상태">
            <div className="connection-line"><span className={`status-dot ${integration.supabase ? "" : "off"}`} />채팅 서버 {integration.supabase ? "연결됨" : "설정 필요"}</div>
            <div className="connection-line"><span className={`status-dot ${integration.video ? "" : "off"}`} />영상 서버 {integration.video ? "연결됨" : "설정 필요"}</div>
          </div>
          <div className="profile-chip"><Avatar name="관리자" /><div><strong>관리자</strong><small>{demoMode ? "데모 모드" : "최고관리자"}</small></div></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="page-title"><h1>{viewLabel}</h1><span>초대받은 구성원을 위한 안전한 소통 공간</span></div>
          <div className="top-actions">
            <div className="top-status">
              <span className="status-pill"><span className={`status-dot ${integration.supabase ? "" : "off"}`} />실시간 {integration.supabase ? "연결" : "대기"}</span>
              <span className="status-pill"><LockKeyhole size={12} />비공개 공간</span>
            </div>
            <button className="icon-btn" aria-label="알림 보기" onClick={() => changeView("notifications")}><Bell size={18} /><span className="notification-dot" /></button>
            <button className="icon-btn" aria-label="로그아웃" onClick={logout}><LogOut size={18} /></button>
          </div>
        </header>

        <div className="content">
          {demoMode && <div className="demo-banner"><Info size={16} />데모 데이터로 제품을 둘러보는 중입니다. 입력 내용은 서버에 저장되지 않으며 외부 사용자에게 전송되지 않습니다.</div>}
          {view === "dashboard" && <Dashboard setView={changeView} onMeeting={() => setMeetingModal(true)} />}
          {view === "chat" && <ChatView rooms={rooms} activeRoom={activeRoom} setRoom={(id) => { setActiveRoom(id); setMobileRoomOpen(true); setRooms((prev) => prev.map((r) => r.id === id ? { ...r, unread: 0 } : r)); }} mobileOpen={mobileRoomOpen} closeMobile={() => setMobileRoomOpen(false)} room={currentRoom} messages={currentMessages} draft={draft} setDraft={setDraft} submit={submitMessage} onKey={onDraftKey} onMeeting={() => setMeetingModal(true)} showToast={showToast} />}
          {view === "meetings" && <MeetingsView meetings={scheduled} openMeeting={() => setMeetingModal(true)} openCreate={() => setCreateMeeting(true)} integration={integration.video} />}
          {view === "contacts" && <ContactsView openChat={(name) => { showToast(`${name}님과의 대화를 열었습니다.`); changeView("chat"); setActiveRoom("minseo"); setMobileRoomOpen(true); }} openMeeting={() => setMeetingModal(true)} />}
          {view === "notifications" && <NotificationsView showToast={showToast} />}
          {view === "files" && <FilesView storage={integration.storage} showToast={showToast} />}
          {view === "settings" && <SettingsView install={installApp} notificationsEnabled={notificationsEnabled} enableNotifications={enableNotifications} showToast={showToast} />}
          {view === "admin" && <AdminView tab={settingsTab} setTab={setSettingsTab} brand={brandName} saveBrand={(name) => { setBrandName(name || "THEHAM PRIVATE TALK"); showToast("브랜드 설정을 현재 세션에 적용했습니다."); }} integration={integration} demo={demoMode} showToast={showToast} />}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="모바일 메뉴">
        {navItems.slice(0, 4).concat([{ id: "settings", label: "더보기", icon: Menu }]).map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => changeView(item.id)}><Icon size={20} /><span>{item.label}</span></button>;
        })}
      </nav>

      {meetingModal && <MeetingPreview videoRef={videoRef} cameraOn={cameraOn} micOn={micOn} startCamera={startCamera} toggleCamera={toggleCamera} toggleMic={toggleMic} close={() => { stopMedia(); setMeetingModal(false); }} join={tryJoinMeeting} connected={integration.video} />}
      {createMeeting && <CreateMeeting title={meetingTitle} setTitle={setMeetingTitle} close={() => setCreateMeeting(false)} save={saveMeeting} />}
      {meetingStage && <MeetingStage videoRef={videoRef} cameraOn={cameraOn} micOn={micOn} toggleCamera={toggleCamera} toggleMic={toggleMic} close={() => { stopMedia(); setMeetingStage(false); }} showToast={showToast} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function LoginScreen({ mode, setMode, onLogin, onDemo, configured, brand, showToast, toast }: {
  mode: LoginMode; setMode: (mode: LoginMode) => void; onLogin: (event: FormEvent<HTMLFormElement>) => void; onDemo: () => void; configured: boolean; brand: string; showToast: (text: string) => void; toast: string;
}) {
  return (
    <div className="login-shell">
      <section className="login-visual">
        <Brand name={brand} />
        <div className="login-copy">
          <p className="eyebrow">Private communication suite</p>
          <h1>우리만의 안전한<br />대화 공간.</h1>
          <p>실시간 채팅과 영상회의, 파일 공유를 하나의 비공개 플랫폼에서 연결합니다. 초대받고 승인된 구성원만 함께할 수 있습니다.</p>
        </div>
        <div className="security-strip"><span><ShieldCheck size={16} />초대 기반 가입</span><span><LockKeyhole size={16} />서버 권한 검증</span><span><Video size={16} />안전한 회의 토큰</span></div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          {mode === "login" && (
            <>
              <p className="eyebrow">Welcome back</p><h2>다시 만나 반갑습니다</h2><p>승인된 계정으로 비공개 공간에 접속하세요.</p>
              <form onSubmit={onLogin}>
                <div className="field"><label htmlFor="email">이메일</label><input id="email" name="email" type="email" autoComplete="username" placeholder="name@company.com" required /></div>
                <div className="field"><label htmlFor="password">비밀번호</label><input id="password" name="password" type="password" autoComplete="current-password" placeholder="비밀번호를 입력하세요" required minLength={8} /></div>
                <button className="primary-btn full" type="submit">로그인</button>
              </form>
              <div className="login-links"><button className="text-btn" onClick={() => showToast("관리자에게 비밀번호 초기화를 요청해 주세요.")}>비밀번호 찾기</button><button className="text-btn" onClick={() => setMode("invite")}>초대코드로 가입</button></div>
              {!configured && <div className="setup-note"><strong>운영 연결 전 상태</strong><br />Supabase 주소와 공개 키를 설정하면 실제 로그인과 가입 승인이 활성화됩니다. 현재는 가짜 로그인을 허용하지 않습니다.</div>}
              <button className="secondary-btn full demo-entry" onClick={onDemo}>제품 둘러보기 · 데모 모드</button>
            </>
          )}
          {mode === "invite" && (
            <>
              <button className="text-btn" onClick={() => setMode("login")}><ChevronLeft size={16} />로그인으로</button>
              <p className="eyebrow" style={{ marginTop: 20 }}>Invitation only</p><h2>초대코드 확인</h2><p>관리자에게 받은 유효한 초대코드를 입력해 주세요.</p>
              <form onSubmit={(e) => { e.preventDefault(); if (configured) setMode("request"); else showToast("가입 서버 연결 후 초대코드를 검증할 수 있습니다."); }}>
                <div className="field"><label htmlFor="invite">초대코드</label><input id="invite" name="invite" placeholder="XXXX-XXXX-XXXX" required /></div>
                <button className="primary-btn full" type="submit">초대코드 확인</button>
              </form>
            </>
          )}
          {mode === "request" && (
            <>
              <button className="text-btn" onClick={() => setMode("invite")}><ChevronLeft size={16} />이전</button>
              <p className="eyebrow" style={{ marginTop: 20 }}>Join request</p><h2>가입 승인 요청</h2><p>관리자가 확인할 기본 정보를 입력해 주세요.</p>
              <form onSubmit={(e) => { e.preventDefault(); showToast("가입 요청을 관리자에게 전달했습니다."); setMode("login"); }}>
                <div className="field"><label>이름</label><input required /></div>
                <div className="field"><label>소속</label><input required /></div>
                <button className="primary-btn full" type="submit">승인 요청</button>
              </form>
            </>
          )}
        </div>
        {toast && <div className="toast" role="status">{toast}</div>}
      </section>
    </div>
  );
}

function Dashboard({ setView, onMeeting }: { setView: (view: View) => void; onMeeting: () => void }) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy"><p className="eyebrow">Private communication suite</p><h2>대화와 회의를<br />하나의 안전한 공간에서.</h2><p>팀과 파트너가 신뢰할 수 있는 비공개 채팅, 일정 기반 영상회의, 안전한 파일 공유를 경험하세요.</p><div className="hero-actions"><button className="primary-btn" onClick={() => setView("chat")}><MessageCircle size={17} />채팅 시작</button><button className="secondary-btn" onClick={onMeeting}><Video size={17} />영상회의</button><button className="secondary-btn" onClick={() => setView("admin")}><Link2 size={17} />초대 관리</button></div></div>
        <div className="hero-art" aria-hidden="true"><div className="hero-orb" /><div className="mock-window"><div className="mock-head"><i /><i /><i /></div><div className="mock-grid"><div className="mock-person">김민서</div><div className="mock-person">박준호</div><div className="mock-person">이서연</div><div className="mock-person">관리자</div></div></div></div>
      </section>
      <section className="stats-grid">
        {[["읽지 않은 메시지", "4", MessageCircle], ["오늘 회의", "2", Video], ["온라인 구성원", "7", Users], ["공유 파일", "18", FolderOpen]].map(([label, value, Icon]) => <div className="stat-card" key={String(label)}><div><p>{label as string}</p><strong>{value as string}</strong></div><span className="stat-icon"><Icon size={20} /></span></div>)}
      </section>
      <section className="dashboard-grid">
        <div className="panel"><div className="panel-header"><div><h2>최근 대화</h2><p>참여 중인 비공개 채팅방</p></div><button className="text-btn" onClick={() => setView("chat")}>전체 보기</button></div><div className="list">{initialRooms.slice(0, 4).map((room) => <button className="list-item" key={room.id} onClick={() => setView("chat")}><Avatar name={room.name} /><div className="list-item-body"><strong>{room.name}</strong><span>{room.preview}</span></div><div className="list-meta">{room.time}{room.unread ? <span className="unread">{room.unread}</span> : null}</div></button>)}</div></div>
        <div className="panel"><div className="panel-header"><div><h2>다가오는 회의</h2><p>오늘 예정된 일정</p></div><CalendarDays size={19} color="#D71962" /></div><div className="meeting-mini"><strong>브랜드 프로젝트 주간회의</strong><span>오늘 오후 2:00 · 8명</span><button className="soft-btn" onClick={onMeeting}>장치 점검</button></div><div className="meeting-mini"><strong>신규 파트너 온보딩</strong><span>오늘 오후 4:30 · 5명</span><div className="participant-stack"><Avatar name="김민서" size="sm" /><Avatar name="박준호" size="sm" /><Avatar name="이서연" size="sm" /></div></div></div>
      </section>
    </>
  );
}

function ChatView({ rooms, activeRoom, setRoom, mobileOpen, closeMobile, room, messages, draft, setDraft, submit, onKey, onMeeting, showToast }: {
  rooms: Room[]; activeRoom: string; setRoom: (id: string) => void; mobileOpen: boolean; closeMobile: () => void; room: Room; messages: ChatMessage[]; draft: string; setDraft: (text: string) => void; submit: () => void; onKey: (event: KeyboardEvent<HTMLTextAreaElement>) => void; onMeeting: () => void; showToast: (text: string) => void;
}) {
  return (
    <div className={`chat-layout ${mobileOpen ? "show-room" : ""}`}>
      <aside className="chat-rooms"><div className="search-box"><Search size={16} /><input aria-label="채팅방 검색" placeholder="채팅방 검색" /></div>{rooms.map((item) => <button key={item.id} className={`list-item room-button ${item.id === activeRoom ? "active" : ""}`} onClick={() => setRoom(item.id)}><Avatar name={item.name} /><div className="list-item-body"><strong>{item.name}</strong><span>{item.preview}</span></div><div className="list-meta">{item.time}{item.unread ? <span className="unread">{item.unread}</span> : null}</div></button>)}</aside>
      <section className="chat-main">
        <header className="chat-head"><div className="chat-head-title"><button className="icon-btn mobile-only" aria-label="채팅방 목록" onClick={closeMobile}><ChevronLeft size={19} /></button><Avatar name={room.name} /><div><strong>{room.name}</strong><span>● {room.members}명 · 3명 온라인</span></div></div><div className="chat-head-actions"><button className="icon-btn" aria-label="채팅 검색" onClick={() => showToast("이 대화의 메시지 검색을 준비했습니다.")}><Search size={17} /></button><button className="icon-btn" aria-label="영상회의 시작" onClick={onMeeting}><Video size={17} /></button><button className="secondary-btn" onClick={() => showToast("참여자 패널은 큰 화면에서 오른쪽에 표시됩니다.")}><Users size={16} />참여자</button></div></header>
        <div className="messages" aria-live="polite"><div className="date-divider">오늘</div>{messages.map((message) => <div className={`message-row ${message.mine ? "mine" : ""}`} key={message.id}>{!message.mine && <Avatar name={message.author} size="sm" />}<div className="message-wrap">{!message.mine && <p className="message-author">{message.author}</p>}<div className="bubble">{message.text}</div><div className="message-time">{message.time}</div></div></div>)}</div>
        <footer className="chat-compose"><button className="icon-btn" aria-label="파일 첨부" onClick={() => showToast("스토리지 연결 후 파일 선택기가 활성화됩니다.")}><Paperclip size={18} /></button><button className="icon-btn" aria-label="이모지" onClick={() => setDraft(`${draft} 🙂`)}><Smile size={18} /></button><textarea value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} aria-label="메시지 입력" placeholder="메시지를 입력하세요" /><button className="primary-btn" aria-label="메시지 전송" onClick={submit}><Send size={17} /></button></footer>
      </section>
      <aside className="chat-info"><div className="room-profile"><Avatar name={room.name} size="lg" /><h3>{room.name}</h3><p>프로젝트 진행을 위한 비공개 대화방</p></div><button className="soft-btn full" onClick={onMeeting}><Video size={16} />영상회의 시작</button><div className="panel-header" style={{ marginTop: 24 }}><h2>참여자 {room.members}</h2></div>{people.slice(0, 5).map((person) => <div className="member-line" key={person.name}><Avatar name={person.name} size="sm" /><div><strong>{person.name}</strong><span>{person.status === "online" ? "온라인" : "자리 비움"}</span></div></div>)}</aside>
    </div>
  );
}

type ScheduledMeeting = { id: string; time: string; date: string; title: string; desc: string; secure: boolean };

function MeetingsView({ meetings, openMeeting, openCreate, integration }: { meetings: ScheduledMeeting[]; openMeeting: () => void; openCreate: () => void; integration: boolean }) {
  return (
    <>
      <div className="section-heading"><div><p className="eyebrow">Secure video meetings</p><h2>영상회의</h2><p>채팅방 구성원과 안전하게 회의를 예약하고 시작하세요.</p></div><button className="primary-btn" onClick={openCreate}><Plus size={17} />회의 예약</button></div>
      {!integration && <div className="demo-banner"><AlertTriangle size={16} />RealtimeKit 연결 전입니다. 카메라·마이크 장치 점검은 가능하지만 원격 참가자는 연결되지 않습니다.</div>}
      <div className="cards-grid" style={{ marginBottom: 20 }}>
        <div className="feature-card"><span className="stat-icon"><Video size={21} /></span><h3>즉시 회의</h3><p>현재 채팅방 구성원과 바로 시작합니다.</p><button className="soft-btn" onClick={openMeeting}>장치 점검 후 시작</button></div>
        <div className="feature-card"><span className="stat-icon"><CalendarDays size={21} /></span><h3>예약 회의</h3><p>시간, 참여자, 대기실을 미리 설정합니다.</p><button className="soft-btn" onClick={openCreate}>새 일정 만들기</button></div>
        <div className="feature-card"><span className="stat-icon"><Link2 size={21} /></span><h3>초대 회의</h3><p>만료시간이 있는 안전한 초대링크를 발급합니다.</p><button className="soft-btn" onClick={() => navigator.clipboard?.writeText("Provider setup required")}>연결 후 사용</button></div>
      </div>
      <div className="panel"><div className="panel-header"><div><h2>예정된 회의</h2><p>참여 예정인 회의 {meetings.length}개</p></div></div><div className="meeting-list">{meetings.map((meeting) => <div className="meeting-card" key={meeting.id}><div className="meeting-time"><strong>{meeting.time}</strong><span>{meeting.date}</span></div><div><span className={`badge ${meeting.secure ? "" : "warn"}`}>{meeting.secure ? "대기실 사용" : "대기실 미사용"}</span><h3>{meeting.title}</h3><p>{meeting.desc}</p></div><button className="primary-btn" onClick={openMeeting}>입장 준비</button></div>)}</div></div>
    </>
  );
}

function ContactsView({ openChat, openMeeting }: { openChat: (name: string) => void; openMeeting: () => void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => people.filter((person) => `${person.name} ${person.role}`.toLowerCase().includes(query.toLowerCase())), [query]);
  return (
    <>
      <div className="section-heading"><div><p className="eyebrow">Trusted contacts</p><h2>연락처</h2><p>승인된 구성원과 친구를 찾고 대화를 시작하세요.</p></div><button className="primary-btn"><Plus size={17} />친구 추가</button></div>
      <div className="search-box" style={{ maxWidth: 460, marginBottom: 18 }}><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름, 소속, 직책으로 검색" aria-label="연락처 검색" /></div>
      {filtered.length ? <div className="contact-grid">{filtered.map((person) => <div className="contact-card" key={person.name}><div className="contact-top"><Avatar name={person.name} size="lg" /><div><h3>{person.name}</h3><p>{person.role}</p></div></div><span className={`presence ${person.status}`} /><div className="contact-actions"><button className="soft-btn" onClick={() => openChat(person.name)}><MessageCircle size={15} />채팅</button><button className="soft-btn" onClick={openMeeting}><Video size={15} />통화</button></div></div>)}</div> : <div className="empty-state"><Users size={34} /><h3>검색 결과가 없습니다</h3><p>다른 이름이나 소속으로 다시 검색해 보세요.</p></div>}
    </>
  );
}

function NotificationsView({ showToast }: { showToast: (text: string) => void }) {
  const [items, setItems] = useState([
    { id: 1, title: "김민서님이 회원님을 언급했습니다", body: "브랜드 프로젝트 TF · 8분 전", unread: true, icon: MessageCircle },
    { id: 2, title: "회의 시작 10분 전입니다", body: "브랜드 프로젝트 주간회의 · 오후 2:00", unread: true, icon: Video },
    { id: 3, title: "새 파일이 업로드되었습니다", body: "파트너 협의회 · 어제", unread: false, icon: FileText },
    { id: 4, title: "새 기기 로그인이 확인되었습니다", body: "Chrome · Windows · 2일 전", unread: false, icon: ShieldCheck },
  ]);
  return (
    <>
      <div className="section-heading"><div><p className="eyebrow">Notifications</p><h2>알림</h2><p>메시지, 회의, 파일과 보안 활동을 확인하세요.</p></div><button className="secondary-btn" onClick={() => { setItems(items.map((item) => ({ ...item, unread: false }))); showToast("모든 알림을 읽음으로 표시했습니다."); }}><Check size={16} />모두 읽음</button></div>
      <div className="panel"><div className="list">{items.map((item) => { const Icon = item.icon; return <button className="list-item" key={item.id} onClick={() => setItems((prev) => prev.map((entry) => entry.id === item.id ? { ...entry, unread: false } : entry))}><span className="stat-icon"><Icon size={19} /></span><div className="list-item-body"><strong>{item.title}</strong><span>{item.body}</span></div>{item.unread && <span className="status-dot" />}</button>; })}</div></div>
    </>
  );
}

function FilesView({ storage, showToast }: { storage: boolean; showToast: (text: string) => void }) {
  const files = [
    { name: "브랜드_가이드_초안.pdf", type: "PDF", size: "4.8 MB", room: "브랜드 프로젝트 TF" },
    { name: "모바일_화면_검토.png", type: "PNG", size: "2.1 MB", room: "브랜드 프로젝트 TF" },
    { name: "파트너_일정표.xlsx", type: "XLSX", size: "184 KB", room: "파트너 협의회" },
  ];
  return (
    <>
      <div className="section-heading"><div><p className="eyebrow">Shared files</p><h2>파일함</h2><p>채팅방에서 공유된 파일을 안전하게 찾아보세요.</p></div><button className="primary-btn" onClick={() => showToast(storage ? "파일 선택기를 열 준비가 되었습니다." : "파일 저장소를 먼저 연결해 주세요.")}><Paperclip size={17} />파일 업로드</button></div>
      {!storage && <div className="demo-banner"><AlertTriangle size={16} />파일 저장소가 연결되지 않아 아래 목록은 데모 전용입니다. 업로드와 다운로드는 실행되지 않습니다.</div>}
      <div className="panel"><div className="list">{files.map((file) => <div className="list-item" key={file.name}><span className="stat-icon">{file.type === "PNG" ? <ImageIcon size={20} /> : <FileText size={20} />}</span><div className="list-item-body"><strong>{file.name}</strong><span>{file.room} · {file.type} · {file.size}</span></div><button className="icon-btn" aria-label={`${file.name} 다운로드`} onClick={() => showToast(storage ? "서명된 다운로드 URL을 요청했습니다." : "저장소 연결 전에는 다운로드할 수 없습니다.")}><Download size={17} /></button></div>)}</div></div>
    </>
  );
}

function SettingsView({ install, notificationsEnabled, enableNotifications, showToast }: { install: () => void; notificationsEnabled: boolean; enableNotifications: () => void; showToast: (text: string) => void }) {
  const [compact, setCompact] = useState(false);
  return (
    <>
      <div className="section-heading"><div><p className="eyebrow">Preferences</p><h2>설정</h2><p>내 프로필, 알림과 기기 환경을 관리하세요.</p></div></div>
      <div className="settings-layout"><div className="panel settings-nav">{["내 프로필", "알림", "채팅", "보안", "연결된 기기"].map((item, index) => <button className={index === 0 ? "active" : ""} key={item}>{item}</button>)}</div><div className="panel settings-form"><div className="setting-section"><h3>내 프로필</h3><p>다른 구성원에게 표시되는 기본 정보입니다.</p><div className="form-row"><div className="field"><label>표시 이름</label><input defaultValue="관리자" /></div><div className="field"><label>소속</label><input defaultValue="더함스튜디오" /></div></div><div className="field"><label>상태 메시지</label><input defaultValue="집중해서 일하는 중입니다." /></div><button className="primary-btn" onClick={() => showToast("프로필 저장은 Supabase 연결 후 서버에 반영됩니다.")}>변경사항 저장</button></div><div className="setting-section"><h3>앱 및 알림</h3><p>현재 기기의 설치와 알림 권한을 관리합니다.</p><div className="toggle-line"><div className="toggle-copy"><strong>브라우저 알림</strong><span>{notificationsEnabled ? "이 기기에서 허용됨" : "권한을 요청하지 않았습니다"}</span></div><button className={`switch ${notificationsEnabled ? "on" : ""}`} aria-label="브라우저 알림 켜기" onClick={enableNotifications} /></div><div className="toggle-line"><div className="toggle-copy"><strong>컴팩트 채팅</strong><span>한 화면에 더 많은 메시지를 표시합니다</span></div><button className={`switch ${compact ? "on" : ""}`} aria-label="컴팩트 채팅 전환" onClick={() => setCompact(!compact)} /></div><button className="secondary-btn" style={{ marginTop: 18 }} onClick={install}>이 기기에 PWA 설치</button></div></div></div>
    </>
  );
}

function AdminView({ tab, setTab, brand, saveBrand, integration, demo, showToast }: { tab: string; setTab: (tab: string) => void; brand: string; saveBrand: (name: string) => void; integration: IntegrationState; demo: boolean; showToast: (text: string) => void }) {
  const [name, setName] = useState(brand);
  const [inviteCopied, setInviteCopied] = useState(false);
  const tabs = [["overview", "운영 현황"], ["members", "회원 관리"], ["rooms", "채팅방 관리"], ["meetings", "회의 관리"], ["brand", "서비스 설정"], ["security", "보안 로그"]];
  return (
    <>
      <div className="section-heading"><div><p className="eyebrow">Administrator console</p><h2>관리자 대시보드</h2><p>회원, 채팅방, 회의와 서비스 정책을 운영합니다.</p></div><button className="primary-btn" onClick={() => { navigator.clipboard?.writeText("초대링크는 서버 연결 후 발급됩니다."); setInviteCopied(true); setTimeout(() => setInviteCopied(false), 1600); }}><Link2 size={16} />{inviteCopied ? "안내 복사됨" : "초대링크 만들기"}</button></div>
      {demo && <div className="demo-banner"><Info size={16} />데모 관리자 화면입니다. 위험한 운영 변경은 서버 연결 전에는 실행하지 않습니다.</div>}
      <div className="settings-layout">
        <div className="panel settings-nav">{tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</div>
        <div className="panel">
          {tab === "overview" && <><div className="panel-header"><div><h2>운영 현황</h2><p>실제 연결 상태와 데모 지표를 분리해 표시합니다.</p></div></div><div className="stats-grid" style={{ margin: 0 }}>{[["전체 회원", "6"], ["현재 접속", "3"], ["활성 채팅방", "4"], ["신고 대기", "0"]].map(([label, value]) => <div className="stat-card" key={label}><div><p>{label}</p><strong>{value}</strong></div></div>)}</div><div className="setting-section" style={{ marginTop: 24 }}><h3>서비스 연결 상태</h3><p>설정값 존재 여부를 서버에서 확인한 결과입니다.</p>{Object.entries(integration).map(([key, value]) => <div className="toggle-line" key={key}><div className="toggle-copy"><strong>{key}</strong><span>{value ? "연결 설정 확인됨" : "환경변수 설정 필요"}</span></div><span className={`badge ${value ? "" : "warn"}`}>{value ? "준비" : "미연결"}</span></div>)}</div></>}
          {tab === "members" && <><div className="panel-header"><div><h2>회원 관리</h2><p>가입 승인, 계정 상태와 역할을 관리합니다.</p></div><button className="secondary-btn" onClick={() => showToast("직접 회원 생성은 서버 관리자 권한이 필요합니다.")}><Plus size={16} />회원 생성</button></div><div className="list">{people.slice(0, 5).map((person) => <div className="list-item" key={person.name}><Avatar name={person.name} /><div className="list-item-body"><strong>{person.name}</strong><span>{person.role}</span></div><span className="badge">정상</span><button className="icon-btn" onClick={() => showToast("계정 작업은 감사 로그와 함께 서버에서 처리됩니다.")}><MoreHorizontal size={17} /></button></div>)}</div></>}
          {tab === "rooms" && <><div className="panel-header"><div><h2>채팅방 관리</h2><p>참여자, 공지, 잠금과 파일 정책을 관리합니다.</p></div></div><div className="list">{initialRooms.map((room) => <div className="list-item" key={room.id}><Avatar name={room.name} /><div className="list-item-body"><strong>{room.name}</strong><span>{room.members}명 · {room.type}</span></div><span className="badge">운영 중</span><button className="icon-btn" onClick={() => showToast("채팅방 변경은 서버 연결 후 반영됩니다.")}><MoreHorizontal size={17} /></button></div>)}</div></>}
          {tab === "meetings" && <><div className="panel-header"><div><h2>회의 관리</h2><p>진행 중 회의와 예약 이력을 확인합니다.</p></div></div>{integration.video ? <div className="list"><div className="list-item"><span className="stat-icon"><Video size={18} /></span><div className="list-item-body"><strong>현재 진행 중인 회의가 없습니다</strong><span>회의가 시작되면 참가자와 방장 정보가 표시됩니다.</span></div></div></div> : <div className="empty-state"><VideoOff size={34} /><h3>영상 제공자 미연결</h3><p>RealtimeKit 서버 자격 증명을 설정하면 회의 운영 화면이 활성화됩니다.</p></div>}</>}
          {tab === "brand" && <div className="settings-form"><div className="setting-section"><h3>브랜드 설정</h3><p>서비스 전체에 표시되는 이름과 메시지를 관리합니다.</p><div className="field"><label>서비스명</label><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></div><div className="form-row"><div className="field"><label>대표 컬러</label><input type="color" defaultValue="#21151B" /></div><div className="field"><label>포인트 컬러</label><input type="color" defaultValue="#D71962" /></div></div><div className="field"><label>메인 문구</label><textarea defaultValue="대화와 회의를 하나의 안전한 공간에서." /></div><button className="primary-btn" onClick={() => saveBrand(name)}>브랜드 적용</button></div><div className="setting-section"><h3>운영 정책</h3><p>서비스 공개 문서는 배포 전 법률 전문가 검토가 필요합니다.</p><button className="secondary-btn" onClick={() => showToast("개인정보처리방침 초안은 docs 폴더에 포함되어 있습니다.")}>정책 문서 확인</button></div></div>}
          {tab === "security" && <><div className="panel-header"><div><h2>보안 로그</h2><p>관리자 활동과 인증 경고를 확인합니다.</p></div></div><div className="list">{[["관리자 로그인", "현재 기기 · 방금"], ["서비스 설정 조회", "관리자 · 3분 전"], ["초대코드 생성 시도", "데모 모드 · 5분 전"]].map(([title, body]) => <div className="list-item" key={title}><span className="stat-icon"><ShieldCheck size={18} /></span><div className="list-item-body"><strong>{title}</strong><span>{body}</span></div></div>)}</div></>}
        </div>
      </div>
    </>
  );
}

function MeetingPreview({ videoRef, cameraOn, micOn, startCamera, toggleCamera, toggleMic, close, join, connected }: { videoRef: React.RefObject<HTMLVideoElement | null>; cameraOn: boolean; micOn: boolean; startCamera: () => void; toggleCamera: () => void; toggleMic: () => void; close: () => void; join: () => void; connected: boolean }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="회의 입장 준비"><div className="modal"><div className="modal-header"><div><p className="eyebrow">Pre-join check</p><h2>회의 입장 준비</h2></div><button className="icon-btn" aria-label="닫기" onClick={close}><X size={18} /></button></div><div className="camera-preview">{cameraOn ? <video ref={videoRef} autoPlay muted playsInline /> : <div style={{ textAlign: "center" }}><Camera size={32} /><p>카메라 미리보기를 시작하세요</p></div>}<span className="camera-status">{connected ? "회의 서버 연결됨" : "장치 점검 전용 · 서버 미연결"}</span></div><div className="form-row"><button className={`secondary-btn ${micOn ? "" : "off"}`} onClick={toggleMic}>{micOn ? <Mic size={16} /> : <MicOff size={16} />}마이크</button><button className="secondary-btn" onClick={toggleCamera}>{cameraOn ? <Camera size={16} /> : <VideoOff size={16} />}카메라</button></div>{!cameraOn && <button className="soft-btn full" style={{ marginTop: 10 }} onClick={startCamera}>카메라·마이크 권한 확인</button>}<div className="setup-note">{connected ? "회의 입장 토큰은 서버에서 짧은 만료시간으로 발급됩니다." : "외부 참가자와 연결하지 않습니다. 관리자 설정에서 RealtimeKit 자격 증명을 연결해 주세요."}</div><div className="modal-actions"><button className="secondary-btn" onClick={close}>취소</button><button className="primary-btn" onClick={join} disabled={!connected}>안전하게 입장</button></div></div></div>
  );
}

function CreateMeeting({ title, setTitle, close, save }: { title: string; setTitle: (title: string) => void; close: () => void; save: (event: FormEvent) => void }) {
  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="회의 예약"><form className="modal" onSubmit={save}><div className="modal-header"><div><p className="eyebrow">Schedule meeting</p><h2>회의 예약</h2></div><button type="button" className="icon-btn" onClick={close}><X size={18} /></button></div><div className="field"><label>회의 제목</label><input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="회의 제목을 입력하세요" /></div><div className="form-row"><div className="field"><label>날짜</label><input type="date" required /></div><div className="field"><label>시작 시간</label><input type="time" required /></div></div><div className="field"><label>연결 채팅방</label><select><option>브랜드 프로젝트 TF</option><option>파트너 협의회</option><option>연결하지 않음</option></select></div><div className="toggle-line"><div className="toggle-copy"><strong>대기실 사용</strong><span>방장 승인 후 입장</span></div><button type="button" className="switch on" aria-label="대기실 사용" /></div><div className="modal-actions"><button type="button" className="secondary-btn" onClick={close}>취소</button><button className="primary-btn" type="submit">회의 예약</button></div></form></div>;
}

function MeetingStage({ videoRef, cameraOn, micOn, toggleCamera, toggleMic, close, showToast }: { videoRef: React.RefObject<HTMLVideoElement | null>; cameraOn: boolean; micOn: boolean; toggleCamera: () => void; toggleMic: () => void; close: () => void; showToast: (text: string) => void }) {
  return <div className="meeting-stage"><header className="stage-head"><div><strong>브랜드 프로젝트 주간회의</strong><div style={{ fontSize: 11, color: "#b9abb2", marginTop: 4 }}>보안 연결 · 00:01</div></div><span className="badge">참가자 1명</span></header><div className="stage-grid"><div className="video-tile">{cameraOn ? <video ref={videoRef} autoPlay muted playsInline /> : <CircleUserRound size={70} color="#8f7b85" />}<span className="video-name">관리자 (나)</span></div><div className="video-tile"><Users size={55} color="#765e6a" /><span className="video-name">다른 참가자를 기다리는 중</span></div></div><footer className="stage-controls"><button className={`control-btn ${micOn ? "" : "off"}`} aria-label="마이크 전환" onClick={toggleMic}>{micOn ? <Mic size={20} /> : <MicOff size={20} />}</button><button className={`control-btn ${cameraOn ? "" : "off"}`} aria-label="카메라 전환" onClick={toggleCamera}>{cameraOn ? <Camera size={20} /> : <VideoOff size={20} />}</button><button className="control-btn" aria-label="화면 공유" onClick={() => showToast("브라우저의 화면 공유 대상을 선택해 주세요.")}><MonitorUp size={20} /></button><button className="control-btn" aria-label="채팅"><MessageCircle size={20} /></button><button className="control-btn end" onClick={close}><Phone size={18} />회의 종료</button></footer></div>;
}
