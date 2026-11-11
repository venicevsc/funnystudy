import type { Metadata } from "next";
import { preconnect } from "react-dom";
import "./globals.css";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Humor Study",
  description: "Humor Study participant portal",
  formatDetection: {
    address: false,
    date: false,
    email: false,
    telephone: false,
    url: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Open the connection to the caption photo CDNs while the page is still
  // loading, so the first photo doesn't also pay for DNS and TLS setup.
  preconnect("https://images.almostcrackd.ai");
  preconnect("https://images.crackd.ai");

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
