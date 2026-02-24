import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Zorg dat /join/* niet conflicteert met /[slug]
  // De volgorde in de app/ directory bepaalt prioriteit
};

export default nextConfig;
