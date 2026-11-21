// Une seule route : POST /intent { amount: 100 | 200, lang } → { clientSecret }.
// Aucune donnée personnelle : ni prénom, ni groupe, ni partie. Pas de journal applicatif.
// La limite de débit par adresse IP se règle dans Cloudflare (règle de rate limiting), pas ici.
const AMOUNTS = new Set([100, 200]);

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim());
  return allowed.includes(origin)
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' }
    : null;
}

const json = (body, status, headers) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    const headers = cors(origin, env);
    if (!headers) return new Response('Forbidden', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const { pathname } = new URL(request.url);
    if (request.method !== 'POST' || pathname !== '/intent') return json({ error: 'not_found' }, 404, headers);

    let amount;
    try { ({ amount } = await request.json()); } catch { return json({ error: 'bad_request' }, 400, headers); }
    if (!AMOUNTS.has(amount)) return json({ error: 'bad_amount' }, 400, headers);

    const form = new URLSearchParams({
      amount: String(amount),
      currency: 'eur',
      'automatic_payment_methods[enabled]': 'true',
      description: 'Soutien Who is bro',
      statement_descriptor_suffix: 'WHOISBRO',
      'metadata[source]': 'whoisbro',
    });
    const r = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    if (!r.ok) return json({ error: 'stripe' }, 502, headers);
    const intent = await r.json();
    return json({ clientSecret: intent.client_secret }, 200, headers);
  },
};
