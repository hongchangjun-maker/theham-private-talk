import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "THEHAM PRIVATE TALK",
  description: "초대받은 구성원을 위한 비공개 채팅·영상회의 플랫폼",
  applicationName: "THEHAM PRIVATE TALK",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "PRIVATE TALK",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/icon-192.svg",
  },
  openGraph: {
    title: "THEHAM PRIVATE TALK",
    description: "대화와 회의를 하나의 안전한 공간에서",
    type: "website",
    images: [{ url: "/og.png", width: 1672, height: 941, alt: "THEHAM PRIVATE TALK" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "THEHAM PRIVATE TALK",
    description: "대화와 회의를 하나의 안전한 공간에서",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#21151B",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
