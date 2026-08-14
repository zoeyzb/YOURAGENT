import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YOURAGENT — AI Voice Agents",
  description: "Create, test, deploy, and operate AI voice agents for real businesses.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
