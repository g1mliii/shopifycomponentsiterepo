import type { Metadata } from "next";
import { headers } from "next/headers";
import { Fraunces, Nunito } from "next/font/google";
import "./globals.css";

import {
  BUSINESS_NAME,
  DEFAULT_KEYWORDS,
  DEFAULT_LOCALE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_SHORT_NAME,
  getAbsoluteUrl,
  getSiteUrl,
  getTwitterHandle,
} from "@/lib/seo/site";

const twitterHandle = getTwitterHandle();
const bodyFont = Nunito({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});
const displayFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["600", "700", "800"],
  display: "swap",
});

const siteVerification: Metadata["verification"] | undefined = (() => {
  const google = process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();
  const yandex = process.env.NEXT_PUBLIC_YANDEX_SITE_VERIFICATION?.trim();
  const yahoo = process.env.NEXT_PUBLIC_YAHOO_SITE_VERIFICATION?.trim();
  const bing = process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION?.trim();

  if (!google && !yandex && !yahoo && !bing) {
    return undefined;
  }

  return {
    ...(google ? { google } : {}),
    ...(yandex ? { yandex } : {}),
    ...(yahoo ? { yahoo } : {}),
    ...(bing
      ? {
          other: {
            "msvalidate.01": bing,
          },
        }
      : {}),
  };
})();

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  applicationName: SITE_NAME,
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_SHORT_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: DEFAULT_KEYWORDS,
  authors: [
    {
      name: BUSINESS_NAME,
      url: getAbsoluteUrl("/"),
    },
  ],
  creator: BUSINESS_NAME,
  publisher: BUSINESS_NAME,
  referrer: "origin-when-cross-origin",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: SITE_SHORT_NAME,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: DEFAULT_LOCALE,
    url: getAbsoluteUrl("/"),
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    images: [
      {
        url: getAbsoluteUrl("/opengraph-image"),
        width: 1200,
        height: 630,
        alt: SITE_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [getAbsoluteUrl("/twitter-image")],
    ...(twitterHandle
      ? {
          creator: twitterHandle,
          site: twitterHandle,
        }
      : {}),
  },
  verification: siteVerification,
  manifest: "/manifest.webmanifest",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get("x-nonce")?.trim() || undefined;

  return (
    <html lang="en">
      <head>
        {nonce ? <meta name="pressplay-nonce" content={nonce} /> : null}
      </head>
      <body
        data-pressplay-nonce={nonce}
        className={`${bodyFont.variable} ${displayFont.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
