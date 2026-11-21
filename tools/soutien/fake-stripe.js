// Faux Stripe.js pour les tests et la démo locale (jamais chargé par le site : seuls les tests et
// tools/soutien/demo.mjs le servent à la place de https://js.stripe.com/v3/).
// Comportement choisi par localStorage['fake-stripe'] : 'success' (défaut), 'fail', 'cancel',
// 'nowallet' (ni Apple Pay ni Google Pay : bouton « Payer par carte »).
(() => {
  const mode = () => { try { return localStorage.getItem('fake-stripe') || 'success'; } catch { return 'success'; } };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function element(type) {
    const handlers = {};
    let node = null;
    return {
      on(evt, fn) { handlers[evt] = fn; return this; },
      mount(target) {
        node = document.createElement('button');
        node.type = 'button';
        node.className = 'fake-wallet';
        node.style.cssText = 'width:100%;height:46px;border-radius:10px;border:0;background:#fff;color:#000;font:600 17px -apple-system,system-ui,sans-serif';
        node.textContent = type === 'payment' ? '•••• 4242 (carte de test)' : ' Pay · Soutenir (test)';
        if (type === 'expressCheckout') {
          node.onclick = async () => {
            await wait(150);
            if (mode() === 'cancel') handlers.cancel?.();
            else handlers.confirm?.({ expressPaymentType: 'apple_pay' });
          };
          setTimeout(() => handlers.ready?.({ availablePaymentMethods: mode() === 'nowallet' ? null : { applePay: true, googlePay: false } }), 50);
        } else node.disabled = true;
        target.append(node);
      },
      destroy() { node?.remove(); },
    };
  }
  window.Stripe = pk => ({
    pk,
    elements: () => ({ create: type => element(type), submit: async () => ({}) }),
    async confirmPayment() {
      await wait(400);
      return mode() === 'fail' ? { error: { type: 'card_error', message: 'Carte refusée (test)' } } : { paymentIntent: { status: 'succeeded' } };
    },
  });
})();
