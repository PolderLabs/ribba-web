// De echte bronnen achter `resolveSignupOffer` — op één plek.
//
// WAAROM APART. De resolver zelf mag geen Stripe-client bouwen: dan is hij niet
// te testen zonder een halve keten op te tuigen. Maar als elke route zijn eigen
// dependencies samenstelt, kunnen `/api/signup/offer` en `/api/signup/start`
// uit elkaar lopen — en dan toont het scherm iets anders dan Checkout krijgt.
// Precies wat we uitsluiten.
//
// Dus: één factory, door beide routes gebruikt.

import type Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import type { CouponFeiten, OfferDeps, PromoResolutie } from '@/lib/signup-offer';

/**
 * Haalt de coupon-id uit een promotiecode.
 *
 * Stripe heeft dit veld verplaatst: oudere API-versies zetten `coupon` direct
 * op de promotiecode, nieuwere zetten hem onder `promotion.coupon`. Beide
 * vormen komen hier voor, en in beide vormen kan de waarde een id-string of een
 * uitgeklapt object zijn. Vasthouden aan één vorm zou betekenen dat een
 * API-versiebump de hele inschrijving stilzet — met een lege fout, want
 * `undefined` is geen exception.
 */
function couponIdUit(pc: unknown): string | null {
  const obj = pc as { coupon?: unknown; promotion?: { coupon?: unknown } } | null;
  const kandidaat = obj?.promotion?.coupon ?? obj?.coupon;
  if (typeof kandidaat === 'string' && kandidaat.trim() !== '') return kandidaat;
  const uitgeklapt = kandidaat as { id?: unknown } | null;
  if (typeof uitgeklapt?.id === 'string' && uitgeklapt.id.trim() !== '') return uitgeklapt.id;
  return null;
}

function couponFeiten(coupon: Stripe.Coupon): CouponFeiten {
  return {
    percentOff: typeof coupon.percent_off === 'number' ? coupon.percent_off : null,
    amountOffCenten: typeof coupon.amount_off === 'number' ? coupon.amount_off : null,
    duur: coupon.duration,
    duurMaanden: typeof coupon.duration_in_months === 'number' ? coupon.duration_in_months : null,
    valuta: typeof coupon.currency === 'string' ? coupon.currency.toUpperCase() : null,
  };
}

/**
 * Zoekt een promotiecode op bij Stripe.
 *
 * Stripe is hier de volledige waarheid: bestaat de code, is hij actief, is hij
 * niet verlopen, is het maximum niet bereikt. Ribba houdt daar geen eigen
 * administratie meer naast — zie besluit 10 van het mandaat-ontwerp.
 *
 * Fail-closed: gaat de aanroep mis, dan is de code voor nu niet geldig. Een
 * storing mag nooit per ongeluk een gratis half jaar uitdelen, en mag ook nooit
 * de inschrijving blokkeren — die gaat door met het standaardaanbod.
 *
 * Het onderscheid dat we WEL maken: een code die niet bestaat is "gewoon
 * ongeldig" (de bezoeker typte iets verkeerd), maar een code die bestaat met
 * een onbruikbare coupon is ONZE configuratiefout. Die tweede mag niet stil
 * doorgaan, want dan krijgt iemand met een geldige code minder dan beloofd.
 */
async function zoekPromotiecodeBijStripe(
  stripe: Stripe,
  code: string,
): Promise<PromoResolutie> {
  let lijst: Stripe.ApiList<Stripe.PromotionCode>;
  try {
    lijst = await stripe.promotionCodes.list({ code, active: true, limit: 1 });
  } catch (e) {
    console.error('promotionCodes.list mislukt:', e);
    return { geldig: false };
  }

  const pc = lijst.data[0];
  if (!pc) return { geldig: false };

  const couponId = couponIdUit(pc);
  if (!couponId) {
    return { geldig: false, configuratiefout: `promotiecode ${pc.id}: geen coupon` };
  }

  let coupon: Stripe.Coupon;
  try {
    coupon = await stripe.coupons.retrieve(couponId);
  } catch (e) {
    console.error('coupons.retrieve mislukt:', e);
    return { geldig: false, configuratiefout: `coupon ${couponId}: niet leesbaar` };
  }

  // `valid` wordt false zodra de coupon is verlopen of uitgeput. Een
  // promotiecode kan dan nog steeds `active` zijn — dan is de code op zich
  // goed, maar levert hij niets op.
  if (coupon.valid === false) {
    return { geldig: false, configuratiefout: `coupon ${couponId}: niet meer geldig` };
  }

  // Een coupon zonder percentage én zonder bedrag kort niets. Dat is geen
  // geldig aanbod maar een lege belofte.
  const kort = typeof coupon.percent_off === 'number' || typeof coupon.amount_off === 'number';
  if (!kort) {
    return { geldig: false, configuratiefout: `coupon ${couponId}: kort niets` };
  }

  // `repeating` zonder aantal maanden is onbepaald. Stripe hoort dat niet toe
  // te laten, maar wij weten dan niet wat we moeten tonen.
  if (coupon.duration === 'repeating' && typeof coupon.duration_in_months !== 'number') {
    return { geldig: false, configuratiefout: `coupon ${couponId}: repeating zonder duur` };
  }

  return {
    geldig: true,
    code: pc.code,
    promotionCodeId: pc.id,
    coupon: couponFeiten(coupon),
  };
}

/**
 * De dependencies waarmee beide signup-routes het aanbod resolven.
 *
 * `stripe` is de volledige client, niet alleen het stukje dat de resolver
 * nodig heeft: `start` maakt er daarna ook de Checkout Session mee. Zo wordt er
 * per verzoek één client gebouwd, en gebruiken resolutie en Checkout
 * gegarandeerd dezelfde configuratie en API-versie.
 */
export function maakOfferDeps(): OfferDeps & { stripe: Stripe } {
  const stripe = getStripe();
  return {
    stripe,
    valideerPromo: (code: string) => zoekPromotiecodeBijStripe(stripe, code),
  };
}
