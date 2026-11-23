import type { Metadata, Viewport } from "next";
import { Anuphan } from "next/font/google";
import "./globals.css";

const anuphan = Anuphan({
  variable: "--font-anuphan",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "เช็คของขวัญ",
  description: "เช็คว่าใครส่งของขวัญแล้วหรือยัง",
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "เช็คของขวัญ", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F3F5F8",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={anuphan.variable}>
      <body>{children}</body>
    </html>
  );
}
