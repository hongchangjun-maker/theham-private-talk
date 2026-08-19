import Link from "next/link";

export default function PrivacyPage() {
  return <main style={{maxWidth:720,margin:"0 auto",padding:"40px 22px",background:"#fff",minHeight:"100vh",lineHeight:1.75}}>
    <h1>비밀친구 개인정보 안내</h1><p>시행일: 2026년 8월 19일</p>
    <h2>수집하는 정보</h2><p>이름, 채팅 닉네임, 선택한 아바타, 전화번호 끝 4자리의 단방향 암호화 값, 채팅 내용, 신고 기록, 접속 보안 기록을 처리합니다. 전화번호 전체는 받지 않습니다.</p>
    <h2>이용 목적</h2><p>회원 확인, 비밀채팅 제공, AI 답변 제공, 신고 처리, 부정 이용 방지와 서비스 보안을 위해 사용합니다.</p>
    <h2>보관과 삭제</h2><p>운영에 필요한 기간 동안 Cloudflare 기반 저장소에 보관합니다. 계정 삭제나 개인정보 문의는 서비스 운영자에게 요청할 수 있으며 법적 보존 의무가 없는 정보는 확인 후 삭제합니다.</p>
    <h2>중요한 안내</h2><p>전화번호 끝 4자리는 강한 비밀번호가 아닙니다. 다른 서비스 비밀번호와 같게 사용하지 마세요. 채팅에 민감한 개인정보를 보내지 마세요.</p>
    <p><Link href="/">앱으로 돌아가기</Link></p>
  </main>;
}
