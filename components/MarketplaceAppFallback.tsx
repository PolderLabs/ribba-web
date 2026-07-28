// Browser-fallback voor de marketplace universal links van de ribbaPro-app
// (chat.ribba.app/i/{inquiry_id} en /r/{recipient_id}, ribbaPro#139). Met de
// app geïnstalleerd opent iOS/Android de app en komt de gebruiker hier nooit;
// zonder app tonen we de download-CTA. De web-chat zelf leeft op
// chat.ribba.app/chat/{token} — die token-link staat als aparte knop in
// dezelfde e-mail, niet in deze URL (een kale /i- of /r-id geeft bewust geen
// chat-toegang; claimen vereist e-mail-match via de claim-RPC's).

import RibbaLogo from '@/app/components/RibbaLogo';
import { AppStoreBadge, GooglePlayBadge } from '@/app/components/StoreBadges';

export default function MarketplaceAppFallback() {
  return (
    <div className="registration-page">
      <div className="registration-card" style={{ textAlign: 'center' }}>
        <RibbaLogo />
        <h1>Open deze link met de Ribba app</h1>
        <p className="subtitle">
          Deze link hoort bij een rijles-aanvraag en opent in de Ribba app. Download de app en
          open de link daarna opnieuw — je logt in met het e-mailadres waarop je de aanvraag-mail
          ontving.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
          <AppStoreBadge />
          <GooglePlayBadge />
        </div>
        <p className="subtitle" style={{ marginTop: 24, fontSize: 13 }}>
          Liever geen app? In de e-mail over je aanvraag staat ook een chat-knop die gewoon in je
          browser werkt.
        </p>
      </div>
    </div>
  );
}
