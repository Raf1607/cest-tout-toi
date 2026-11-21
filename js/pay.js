// Paiement de soutien (1 € ou 2 €) : bouton Apple Pay / Google Pay natif de Stripe (Express Checkout),
// et à défaut un paiement par carte dans une feuille. Stripe.js n'est chargé qu'ici, sur l'écran de
// soutien : aucune requête vers Stripe depuis l'accueil, le salon ou pendant les manches.
// Le Worker (worker/) crée le paiement ; on ne lui envoie que le montant et la langue, rien d'autre.
import { STRIPE_PK, PAY_WORKER, STRIPE_JS } from './support.js';

let stripePromise = null;
function loadStripe() {
  stripePromise ??= new Promise((resolve, reject) => {
    if (window.Stripe) return resolve(window.Stripe(STRIPE_PK));
    const s = document.createElement('script');
    s.src = STRIPE_JS;
    s.onload = () => (window.Stripe ? resolve(window.Stripe(STRIPE_PK)) : reject(new Error('stripe')));
    s.onerror = () => { stripePromise = null; reject(new Error('stripe')); };
    document.head.append(s);
  });
  return stripePromise;
}

async function clientSecret(amount, lang) {
  const r = await fetch(`${PAY_WORKER}/intent`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount, lang }),
  });
  if (!r.ok) throw new Error('intent');
  const { clientSecret: secret } = await r.json();
  if (!secret) throw new Error('intent');
  return secret;
}

const APPEARANCE = { theme: 'night', variables: { colorPrimary: '#ffcf3f', colorBackground: '#221e2c', borderRadius: '12px' } };

// slot : où mettre le bouton. on : { start, success, cancel, error, unavailable }.
// Renvoie une fonction qui retire le bouton.
export async function mountPay(slot, { amount, lang, labels, on }) {
  let stripe;
  try { stripe = await loadStripe(); } catch { on.unavailable(); return () => {}; }
  const options = { mode: 'payment', amount, currency: 'eur', locale: lang, appearance: APPEARANCE };
  const elements = stripe.elements(options);
  const confirm = async (els, done) => {
    on.start();
    try {
      const { error: submitError } = await els.submit();
      if (submitError) throw submitError;
      const secret = await clientSecret(amount, lang);
      const { error } = await stripe.confirmPayment({ elements: els, clientSecret: secret, confirmParams: { return_url: location.href }, redirect: 'if_required' });
      if (error) throw error;
      done?.();
      on.success();
    } catch (err) {
      on.error(err);
    }
  };

  const express = elements.create('expressCheckout', {
    paymentMethods: { applePay: 'always', googlePay: 'always', link: 'never', paypal: 'never', amazonPay: 'never' },
    buttonTheme: { applePay: 'white', googlePay: 'white' },
    buttonType: { applePay: 'support', googlePay: 'pay' },
    buttonHeight: 46,
  });
  const box = document.createElement('div');
  slot.append(box);
  express.on('confirm', () => confirm(elements));
  express.on('cancel', () => on.cancel());
  express.on('ready', ({ availablePaymentMethods }) => {
    if (availablePaymentMethods && Object.values(availablePaymentMethods).some(Boolean)) return;
    // Ni Apple Pay ni Google Pay : un bouton « Payer par carte » qui ouvre une feuille.
    box.remove();
    const button = document.createElement('button');
    button.className = 'primary big pay-card';
    button.textContent = labels.card;
    button.onclick = () => openCardSheet(stripe, options, labels, confirm, on);
    slot.append(button);
  });
  express.mount(box);
  return () => { try { express.destroy(); } catch { /* déjà parti */ } slot.replaceChildren(); };
}

function openCardSheet(stripe, options, labels, confirm, on) {
  const elements = stripe.elements(options);
  const sheet = document.createElement('div');
  sheet.className = 'pay-sheet';
  sheet.innerHTML = `<div class="pay-sheet-box"><div data-card></div><button class="primary big" data-go>${labels.cardPay}</button><button class="link" data-close>${labels.close}</button></div>`;
  document.body.append(sheet);
  const card = elements.create('payment', { layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never' } });
  card.mount(sheet.querySelector('[data-card]'));
  const close = () => { try { card.destroy(); } catch { /* déjà parti */ } sheet.remove(); };
  sheet.querySelector('[data-close]').onclick = () => { close(); on.cancel(); };
  sheet.querySelector('[data-go]').onclick = e => { e.target.disabled = true; confirm(elements, close).finally(() => { e.target.disabled = false; }); };
}
