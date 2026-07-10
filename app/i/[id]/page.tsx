import type { Metadata } from 'next';
import MarketplaceAppFallback from '@/components/MarketplaceAppFallback';

export const metadata: Metadata = {
  title: 'Open in de Ribba app',
  robots: { index: false, follow: false },
};

export default function InquiryDeepLinkFallback() {
  return <MarketplaceAppFallback />;
}
