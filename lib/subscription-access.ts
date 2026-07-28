/**
 * subscription-access — mag deze gebruiker het abonnement beheren?
 *
 * Fase 2a: muterende abonnementsacties zijn eigenaar-only. De server is de
 * poort (`/api/checkout`, `/api/cancel-subscription` en de edge functions
 * weigeren met 403); de UI is de spiegel.
 *
 * Deze helper bepaalt wat de UI met het antwoord van `/api/current-plan`
 * doet, en is bewust **fail-closed**: alleen een expliciet `true` geeft de
 * beheeracties vrij. Een mislukte request, een non-OK status, een
 * onparseerbare body of een ontbrekend veld leiden tot "niet tonen".
 *
 * Waarom fail-closed en niet fail-open: een knop die wél verschijnt maar
 * gegarandeerd 403 oplevert, is precies de zichtbare doodlopende weg die
 * fase 2a moet wegnemen. Niets tonen is in het slechtste geval onvolledig;
 * iets tonen dat faalt is misleidend.
 */

export function canManageSubscriptionFrom(ok: boolean, body: unknown): boolean {
  if (!ok) return false;
  if (typeof body !== 'object' || body === null) return false;
  return (body as { canManageSubscription?: unknown }).canManageSubscription === true;
}
