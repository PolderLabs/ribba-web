import { NextRequest, NextResponse } from 'next/server';

// KVK lookup — zoek op bedrijfsnaam of KVK-nummer
// Uses OpenKVK (free) with fallback to official KVK API

type Company = {
  name: string;
  kvk_number: string;
  address: string;
  postal_code: string;
  city: string;
};

function parseOpenKvkResult(result: any): Company {
  const huisnr = [result.huisnummer, result.huisnummertoevoeging]
    .filter(Boolean)
    .join('');
  const address = [result.straat, huisnr].filter(Boolean).join(' ');
  return {
    name: result.bedrijfsnaam || '',
    kvk_number: result.kvk || '',
    address: address || '',
    postal_code: result.postcode || '',
    city: result.plaats || '',
  };
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q') || req.nextUrl.searchParams.get('kvk') || '';

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  const cleaned = query.trim();

  try {
    // Search OpenKVK by name or KVK number
    const encodedQuery = encodeURIComponent(cleaned);
    const openKvkRes = await fetch(
      `https://openkvk.nl/api/v1/query?q=${encodedQuery}&fields=kvk,bedrijfsnaam,straat,huisnummer,huisnummertoevoeging,postcode,plaats`,
      {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (openKvkRes.ok) {
      const data = await openKvkRes.json();

      if (data?.resultaten_aantal > 0 && data?.resultaten) {
        const results: Company[] = data.resultaten
          .slice(0, 5)
          .map(parseOpenKvkResult)
          .filter((c: Company) => c.name && c.kvk_number);

        if (results.length > 0) {
          return NextResponse.json({ results });
        }
      }
    }

    // Fallback: KVK API (if API key configured)
    const kvkApiKey = process.env.KVK_API_KEY;
    if (kvkApiKey) {
      const isKvkNumber = /^\d{8}$/.test(cleaned);
      const kvkUrl = isKvkNumber
        ? `https://api.kvk.nl/api/v1/zoeken?kvkNummer=${cleaned}`
        : `https://api.kvk.nl/api/v1/zoeken?handelsnaam=${encodedQuery}`;

      const kvkRes = await fetch(kvkUrl, {
        headers: { 'apikey': kvkApiKey, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });

      if (kvkRes.ok) {
        const kvkData = await kvkRes.json();
        const results: Company[] = (kvkData?.resultaten || [])
          .slice(0, 5)
          .map((item: any) => {
            const addr = item.adres?.binnenlandsAdres || {};
            const street = [addr.straatnaam, addr.huisnummer, addr.huisnummerToevoeging]
              .filter(Boolean)
              .join(' ');
            return {
              name: item.handelsnaam || '',
              kvk_number: item.kvkNummer || '',
              address: street || '',
              postal_code: addr.postcode || '',
              city: addr.plaats || '',
            };
          })
          .filter((c: Company) => c.name);

        if (results.length > 0) {
          return NextResponse.json({ results });
        }
      }
    }

    return NextResponse.json({ results: [] });
  } catch (err) {
    console.error('KVK lookup error:', err);
    return NextResponse.json({ results: [] });
  }
}
