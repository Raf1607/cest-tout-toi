# Worker de paiement (Cloudflare)

Crée les paiements de soutien de Who is bro ? (1 € ou 2 €, encaissés par Cambon AI via Stripe).
Une seule route, `POST /intent` avec `{ amount: 100 | 200, lang }`, qui renvoie `{ clientSecret }`.
Aucune donnée personnelle ne passe par ici.

## Déploiement

```bash
cd worker
npx wrangler login                       # compte Cloudflare de Cambon AI
npx wrangler secret put STRIPE_SECRET_KEY # sk_test_… d'abord, sk_live_… au passage en réel
npx wrangler deploy
```

Puis, dans `js/support.js` : `STRIPE_PK` (clé publique `pk_test_…` / `pk_live_…`) et `PAY_WORKER`
(l'adresse affichée par `wrangler deploy`, par exemple `https://whoisbro-pay.<compte>.workers.dev`).
Tant que l'une des deux est vide, le soutien est coupé partout.

Dans le tableau de bord Cloudflare : une règle de limite de débit sur le Worker (par exemple
10 requêtes par minute et par adresse IP). Pas de journal applicatif.

## Apple Pay

Déclarer le domaine `whoisbro.lol` dans Stripe (Paramètres › Moyens de paiement › Apple Pay), puis
déposer le fichier fourni à la racine du site :
`.well-known/apple-developer-merchantid-domain-association` (le fichier `.nojekyll` permet à
GitHub Pages de servir ce dossier).
