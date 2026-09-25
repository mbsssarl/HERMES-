# QuoteFlow - front de l'équipe branché sur Convex

UI d'origine (Bolt) conservée ; la couche de données Supabase a été remplacée par le backend Convex du dépôt (`./convex`).

## Lancer

```bash
# 1. backend (à la racine du dépôt)
npx convex dev
# 2. front
# (à la racine du dépôt)
npm install
npm run dev
```

`.env.local` doit contenir `VITE_CONVEX_URL` (même valeur que le `.env.local` de la racine).

## Jointures (où regarder)

| Fichier | Rôle |
|---|---|
| `src/lib/convex.ts` | import unique de `api` / types générés Convex |
| `src/lib/mappers.ts` | Convex → types de l'UI (`quotation` = `order`, statuts, `reference` = IMPA/code) |
| `src/lib/hooks.ts` | hooks temps réel (`useQuotations`, `useQuotation`, `useProducts`, `useCountries`, `useMe`) |
| `src/pages/Login.tsx` | connexion + changement de mot de passe forcé |
| `src/pages/NewQuotation.tsx` | client + pays → import du fichier → analyse serveur |
| `src/components/SupplierPanel.tsx` | fichier fournisseur (template, import, validation → catalogue) |
| `src/components/QuotesPanel.tsx` | PDF du devis, approbation admin, envoi email |

## Correspondances

- Statuts : `draft→À vérifier`, `processing→En traitement`, `awaiting_supplier→Attente fournisseur`, `completed→Prêt`, `sent→Envoyé`, `archived→Annulé`.
- Match : `matched_impa|matched_name|manual→Reconnu`, `ambiguous→À confirmer`, `unmatched→Inconnu`.
- Le matching, le calcul de prix (pays + cotation + remise) et les numéros `Q-YYYY-NNNN` sont faits côté serveur : `matching.ts` client et la marge fixe de 30 % ont été supprimés.
