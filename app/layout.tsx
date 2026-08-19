import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "전국비밀채팅",
  description: "AI와 새로운 성인 친구를 만나는 안전한 비밀채팅",
  applicationName: "전국비밀채팅",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "전국비밀채팅",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/icon-192.svg",
  },
  openGraph: {
    title: "전국비밀채팅",
    description: "AI와 새로운 성인 친구를 만나는 안전한 비밀채팅",
    type: "website",
    images: [{ url: "/og.png", width: 1672, height: 941, alt: "전국비밀채팅" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "전국비밀채팅",
    description: "AI와 새로운 성인 친구를 만나는 안전한 비밀채팅",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#EF476F",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
