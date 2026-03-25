import { NextRequest, NextResponse } from 'next/server';

// KVK Handelsregister Zoeken API v2
// Docs: https://developers.kvk.nl/documentation/zoeken-api
// Endpoint: https://api.kvk.nl/api/v2/zoeken
// Test: https://api.kvk.nl/test/api/v2/zoeken (free test key)

type Company = {
  name: string;
  kvk_number: string;
  address: string;
  postal_code: string;
  city: string;
};

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get('q') || '';

  if (!query || query.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  const cleaned = query.trim();
  const kvkApiKey = process.env.KVK_API_KEY;

  // Use test environment if no API key configured
  const isTest = !kvkApiKey;
  const baseUrl = isTest
    ? 'https://api.kvk.nl/test/api/v2/zoeken'
    : 'https://api.kvk.nl/api/v2/zoeken';
  const apiKey = kvkApiKey || 'l7xx1f2691f2520d487b902f4e0b57a0b197';

  // Determine search parameter: KVK number or name
  const isKvkNumber = /^\d{8}$/.test(cleaned.replace(/\s/g, ''));
  const searchParam = isKvkNumber
    ? `kvkNummer=${cleaned.replace(/\s/g, '')}`
    : `naam=${encodeURIComponent(cleaned)}`;

  try {
    const res = await fetch(
      `${baseUrl}?${searchParam}&resultatenPerPagina=5`,
      {
        headers: {
          'apikey': apiKey,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    if (!res.ok) {
      console.error('KVK API error:', res.status, await res.text().catch(() => ''));
      return NextResponse.json({ results: [] });
    }

    const data = await res.json();
    const resultaten = data?.resultaten || [];

    const results: Company[] = resultaten
      .filter((item: any) => item.naam && item.kvkNummer)
      .map((item: any) => {
        const street = [item.straatnaam, item.huisnummer, item.huisletter]
          .filter(Boolean)
          .join(' ');

        return {
          name: item.naam,
          kvk_number: item.kvkNummer,
          address: street || item.adres || '',
          postal_code: item.postcode || '',
          city: item.plaats || '',
        };
      });

    return NextResponse.json({ results });
  } catch (err) {
    console.error('KVK lookup error:', err);
    return NextResponse.json({ results: [] });
  }
}
