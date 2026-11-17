import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Factory Flow · 물류 관제",
  description: "MQTT 기반 공장 물류 관제 데모 (AMR, RFID 게이트, QR 스캐너)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
