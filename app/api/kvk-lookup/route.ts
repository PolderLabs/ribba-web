import { NextRequest, NextResponse } from 'next/server';

// KVK Handelsregister API - zoek bedrijf op KVK-nummer
// Docs: https://developers.kvk.nl/documentation/searching
// Uses the free "Zoeken" endpoint (no API key needed for basic lookups)

export async function GET(req: NextRequest) {
  const kvkNumber = req.nextUrl.searchParams.get('kvk');

  if (!kvkNumber || !/^\d{8}$/.test(kvkNumber.replace(/\s/g, ''))) {
    return NextResponse.json({ error: 'Ongeldig KVK-nummer' }, { status: 400 });
  }

  const cleaned = kvkNumber.replace(/\s/g, '');

  try {
    // Try OpenKVK first (free, no API key needed)
    const openKvkRes = await fetch(
      `https://openkvk.nl/api/v1/query?q=${cleaned}&fields=kvk,bedrijfsnaam,straat,huisnummer,huisnummertoevoeging,postcode,plaats`,
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (openKvkRes.ok) {
      const data = await openKvkRes.json();

      if (data?.resultaten_aantal > 0 && data?.resultaten?.[0]) {
        const result = data.resultaten[0];
        const huisnr = [result.huisnummer, result.huisnummertoevoeging]
          .filter(Boolean)
          .join('');
        const address = [result.straat, huisnr].filter(Boolean).join(' ');

        return NextResponse.json({
          found: true,
          company: {
            name: result.bedrijfsnaam || '',
            kvk_number: result.kvk || cleaned,
            address: address || '',
            postal_code: result.postcode || '',
            city: result.plaats || '',
          },
        });
      }
    }

    // Fallback: try KVK API (requires API key, if configured)
    const kvkApiKey = process.env.KVK_API_KEY;
    if (kvkApiKey) {
      const kvkRes = await fetch(
        `https://api.kvk.nl/api/v1/zoeken?kvkNummer=${cleaned}`,
        {
          headers: {
            'apikey': kvkApiKey,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        }
      );

      if (kvkRes.ok) {
        const kvkData = await kvkRes.json();
        const item = kvkData?.resultaten?.[0];

        if (item) {
          const addr = item.adres?.binnenlandsAdres || {};
          const street = [addr.straatnaam, addr.huisnummer, addr.huisnummerToevoeging]
            .filter(Boolean)
            .join(' ');

          return NextResponse.json({
            found: true,
            company: {
              name: item.handelsnaam || '',
              kvk_number: item.kvkNummer || cleaned,
              address: street || '',
              postal_code: addr.postcode || '',
              city: addr.plaats || '',
            },
          });
        }
      }
    }

    return NextResponse.json({ found: false });
  } catch (err) {
    console.error('KVK lookup error:', err);
    return NextResponse.json({ found: false });
  }
}
