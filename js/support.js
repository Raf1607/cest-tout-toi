// Soutien en fin de partie (roue du mécène, paiement Apple Pay / Google Pay, badges).
// Encaissement : Cambon AI, via Stripe. Tant que PAYMENTS_ON est à false, ou sans clé publique ni Worker,
// la fonctionnalité est coupée partout (en local comme en ligne) : la partie va directement à l'écran de fin.
export const PAYMENTS_ON = false;                         // désactivé pour le moment
export const STRIPE_PK = '';                              // pk_test_… puis pk_live_… (publique par nature)
export const PAY_WORKER = '';                             // https://whoisbro-pay.<compte>.workers.dev
export const STRIPE_JS = 'https://js.stripe.com/v3/';     // chargé seulement sur l'écran de soutien
export const SUPPORT_ENABLED = PAYMENTS_ON && !!(STRIPE_PK && PAY_WORKER);
