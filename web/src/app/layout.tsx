import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans_KR } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans_KR({ weight: ["400", "500", "600"], display: "swap", variable: "--font-sans", preload: false });
const mono = IBM_Plex_Mono({ weight: ["400"], subsets: ["latin"], display: "swap", variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Factory Flow · 물류 관제",
  description: "MQTT 기반 공장 물류 실시간 관측 대시보드 (AMR, RFID 게이트, QR 스캐너)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-theme="dark" className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
