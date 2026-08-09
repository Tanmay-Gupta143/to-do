import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Daily Study | Honest daily practice",
  description: "A private daily study tracker for consistent practice.",
  icons: { icon: "/daily-study-icon.png?v=2", shortcut: "/daily-study-icon.png?v=2" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className="dark"><body>{children}</body></html>;
}
