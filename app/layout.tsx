import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://link.ribba.app"),
  title: "Ribba",
  description: "Ribba – slimme rijschool software",
  icons: {
    icon: "/og-image.png",
    shortcut: "/og-image.png",
    apple: "/og-image.png",
  },
  openGraph: {
    title: "Ribba – slimme rijschool software",
    description:
      "Plan lessen, beheer leerlingen en facturatie — alles in één app voor je rijschool.",
    url: "https://link.ribba.app",
    siteName: "Ribba",
    images: [
      {
        url: "/og-image.png",
        width: 512,
        height: 512,
        alt: "Ribba – slimme rijschool software",
      },
    ],
    locale: "nl_NL",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Ribba – slimme rijschool software",
    description:
      "Plan lessen, beheer leerlingen en facturatie — alles in één app voor je rijschool.",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="nl">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
