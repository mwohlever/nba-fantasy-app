import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import ThemeProvider from "@/components/theme/ThemeProvider";
import SportProvider from "@/components/providers/SportProvider";
import GroupProvider from "@/components/providers/GroupProvider";
import "./globals.css";
import AppHeartbeat from "@/components/AppHeartbeat";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  manifest: "/manifest.json",
  title: "111 Sports",
  description:
    "Fantasy sports drafts, live scoring, standings, profiles, and stats",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var savedTheme = localStorage.getItem("111-fantasy-theme");

                  if (
                    savedTheme !== "light" &&
                    savedTheme !== "dark" &&
                    savedTheme !== "system"
                  ) {
                    savedTheme = "dark";
                    localStorage.setItem("111-fantasy-theme", "dark");
                  }

                  var theme = savedTheme === "light" ? "light" : "dark";
                  var root = document.documentElement;

                  root.classList.remove("light", "dark");
                  root.classList.add(theme);
                  root.style.colorScheme = theme;
                } catch (error) {
                  document.documentElement.classList.add("dark");
                  document.documentElement.style.colorScheme = "dark";
                }
              })();
            `,
          }}
        />
      </head>

      <body className="min-h-full flex flex-col">
        <AppHeartbeat />
        <ThemeProvider>
          <GroupProvider>
            <SportProvider>
              {children}
            </SportProvider>
          </GroupProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}