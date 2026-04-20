import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Zorg dat /join/* niet conflicteert met /[slug]
  // De volgorde in de app/ directory bepaalt prioriteit

  async headers() {
    return [
      {
        // Apple Universal Links — moet als application/json geserveerd worden
        source: '/.well-known/apple-app-site-association',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
        ],
      },
      {
        // Android App Links assetlinks
        source: '/.well-known/assetlinks.json',
        headers: [
          { key: 'Content-Type', value: 'application/json' },
        ],
      },
    ];
  },
};

export default nextConfig;
