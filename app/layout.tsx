import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import AttributionCapture from "@/components/AttributionCapture";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Google Ads (trial-registratie-conversie). Zelfde opzet als ribba.app:
// Consent Mode v2 default-denied vóór gtag.js, url_passthrough en een
// cross-domain linker over beide domeinen zodat de _gl-parameter van een
// inkomende Ads-klik niet verloren gaat. Consent blijft 'denied' tot er een
// consent-moment is (link.ribba.app heeft nu geen banner) — dankzij Consent
// Mode-modellering blijft de conversiemeting bruikbaar.
const GADS_ID = process.env.NEXT_PUBLIC_GADS_ID || "AW-18341801400";

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
      <head>
        <Script id="gtag-consent-default" strategy="beforeInteractive">
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied'});
gtag('js',new Date());
gtag('set','url_passthrough',true);
gtag('set','linker',{domains:['ribba.app','link.ribba.app','mijn.ribba.app','chat.ribba.app']});
gtag('config','${GADS_ID}');`}
        </Script>
        <Script
          id="gtag-js"
          strategy="afterInteractive"
          src={`https://www.googletagmanager.com/gtag/js?id=${GADS_ID}`}
        />
      </head>
      <body className={inter.className}>
        <AttributionCapture />
        {children}
      </body>
    </html>
  );
}
