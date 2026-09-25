# Schéma Convex - tables, relations et rôle des fichiers

## Vue d'ensemble

Le schéma ([schema.ts](schema.ts)) définit 12 tables, regroupées en 4 familles :

**1. Authentification** (en partie gérées par `@convex-dev/auth`)

- `users` - la table native de Convex Auth, **étendue** avec nos champs métier (`role`, `status`, `mustChangePassword`...)
- `authAccounts` - lie un compte de connexion (ex : email + mot de passe hashé) à un `users._id`
- `authSessions` - les sessions actives (tokens de connexion en cours)
- `passwordResetTokens` - table maison pour le "mot de passe oublié" (pas gérée par `@convex-dev/auth`)

**2. Référentiel métier**

- `clients` - les clients pour qui on fait des devis
- `products` - le catalogue produits (prix internes, IMPA, etc.)

**3. Le cœur du workflow (une commande)**

- `orders` - la commande elle-même (statut, cotation, réduction)
- `orderItems` - les lignes de la commande (une par article du document client)
- `uploadedFiles` - les fichiers importés/générés (document client, réponse fournisseur, template généré, PDF final)
- `supplierItems` - les lignes extraites du fichier fournisseur, en attente de validation avant d'entrer au catalogue

**4. Sortie et traçabilité**

- `quotations` - les devis générés (figés, versionnés)
- `emailLogs` - historique des envois
- `activityLogs` - journal d'audit
- `settings` - paramètres globaux (cotation par défaut, infos entreprise...)

`authAccounts` et `authSessions` sont créées et gérées automatiquement par `@convex-dev/auth` - elles ne sont jamais manipulées directement dans le code métier.

## Les relations clé

```
clients ──┐
          │
          ▼
        orders ──┬──▶ orderItems ──▶ products (matché ou non)
          │       │
          │       ├──▶ uploadedFiles (documents importés/générés)
          │       ├──▶ supplierItems ──▶ products (nouveaux produits créés)
          │       ├──▶ quotations
          │       └──▶ emailLogs
          │
        users (createdBy, sur presque toutes les tables)
```

| De              | Vers                       | Champ                                   | Sens                                                                                                       |
| --------------- | -------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `orders`        | `clients`                  | `clientId`                              | une commande appartient à un client                                                                        |
| `orderItems`    | `orders`                   | `orderId`                               | une ligne appartient à une commande                                                                        |
| `orderItems`    | `products`                 | `productId` (optionnel)                 | une ligne **peut** être matchée à un produit du catalogue - `undefined` tant qu'elle est "non répertoriée" |
| `uploadedFiles` | `orders`                   | `orderId`                               | un fichier est rattaché à une commande                                                                     |
| `supplierItems` | `orders` + `uploadedFiles` | `orderId`, `uploadedFileId`             | une ligne fournisseur vient d'un fichier importé dans une commande                                         |
| `supplierItems` | `orderItems`               | `orderItemId` (optionnel)               | lien vers la ligne "non répertoriée" d'origine, pour la re-matcher automatiquement                         |
| `quotations`    | `orders`                   | `orderId`                               | un devis généré pour une commande (plusieurs versions possibles)                                           |
| `emailLogs`     | `orders` + `quotations`    | `orderId`, `quotationId`                | trace l'envoi d'un devis précis                                                                            |
| `products`      | `orders`                   | `sourceOrderId` (optionnel)             | si le produit vient d'un import fournisseur, on sait de quelle commande                                    |
| `activityLogs`  | tout                       | `entityType` + `entityId` (texte libre) | pas de vraie clé étrangère - journal générique, volontairement découplé                                    |

**Point important du cahier des charges** : `orderItems.productId` n'est pas une relation obligatoire. Tant qu'une ligne n'a pas été matchée (par IMPA ou par nom), `productId` reste vide et `matchStatus` vaut `"unmatched"`. La ligne existe quand même dans `orderItems` - c'est ce qui garantit qu'on ne perd jamais une ligne du document client, même sans correspondance.

## Rôle de chaque fichier

### Le schéma et l'auth

- [schema.ts](schema.ts) - définit les 12 tables ci-dessus, avec leurs index.
- [auth.ts](auth.ts) - configure `@convex-dev/auth` avec le provider "Password".
- [auth.config.ts](auth.config.ts) - dit à Convex quel domaine est autorisé à émettre des tokens (requis par `@convex-dev/auth`).
- [http.ts](http.ts) - expose les routes HTTP nécessaires à l'auth (callbacks, etc.).

### Un fichier par entité métier (queries + mutations)

- [users.ts](users.ts) - création de compte par l'admin, changement de mot de passe, reset, activation/désactivation, `bootstrapFirstAdmin`.
- [clients.ts](clients.ts) - CRUD clients.
- [products.ts](products.ts) - catalogue : recherche, création, modification de prix (avec log).
- [orders.ts](orders.ts) - création de commande (génère la référence `Q-2026-000X`), changement de statut, cotation/réduction (admin).
- [orderItems.ts](orderItems.ts) - lecture réactive des lignes, confirmation des correspondances ambiguës, édition quantité/remise.
- [supplierItems.ts](supplierItems.ts) - validation des lignes extraites du fichier fournisseur, puis `saveToCatalog` qui crée les produits **et** relance le matching des lignes en attente.
- [quotations.ts](quotations.ts) - queries/mutations autour des devis générés (liste, approbation admin, log d'envoi email).
- [files.ts](files.ts) - upload (URL signée Convex Storage), enregistrement des métadonnées, déclenchement de l'extraction.
- [settings.ts](settings.ts) - paramètres globaux (cotation par défaut, devise, infos entreprise).
- [activityLogs.ts](activityLogs.ts) / [admin.ts](admin.ts) - lecture du journal d'audit et stats du dashboard admin (réservés admin).

### Actions (tout ce qui touche l'extérieur : fichiers lourds, emails)

- [extraction.ts](extraction.ts) - **"use node"**. Parse les documents client/fournisseur (PDF/Excel/Word) et génère le template Excel fournisseur.
- [quotationGeneration.ts](quotationGeneration.ts) - **"use node"**. Calcule les prix finaux et génère le PDF du devis.
- [emails.ts](emails.ts) - envoie les emails via Brevo (bienvenue, reset mot de passe, devis).

Pourquoi ces 3 fichiers sont séparés des fichiers "métier" au-dessus : une **action** peut appeler des API externes et utiliser des paquets Node, une **query/mutation** ne peut pas - Convex les fait tourner dans des runtimes différents.

### `lib/` - logique réutilisable, sans accès direct à la requête HTTP

- [lib/matching.ts](lib/matching.ts) - l'algorithme de matching (IMPA exact → nom flou → ambigu → non répertorié).
- [lib/pricing.ts](lib/pricing.ts) - calcul cotation + remise + total.
- [lib/normalize.ts](lib/normalize.ts) / [lib/stringSimilarity.ts](lib/stringSimilarity.ts) - normalisation de texte et score de similarité (Jaro-Winkler) pour le matching par nom.
- [lib/permissions.ts](lib/permissions.ts) - `requireUser` / `requireAdmin`, appelés en tête de chaque fonction sensible.
- [lib/audit.ts](lib/audit.ts) - `logActivity`, appelé après chaque action sensible.
- [lib/tokens.ts](lib/tokens.ts) - génération de mots de passe temporaires et tokens de reset.
- [lib/brevo.ts](lib/brevo.ts) / [lib/base64.ts](lib/base64.ts) - appel HTTP à Brevo et encodage des pièces jointes.
- [lib/extraction/](lib/extraction) - un parseur par format (`excel.ts`, `pdf.ts`, `word.ts`) + `columnMapping.ts` qui reconnaît les colonnes quel que soit leur intitulé exact.
- [lib/pdf/quotationPdf.ts](lib/pdf/quotationPdf.ts) - mise en page du PDF de devis avec `@react-pdf/renderer`.

En résumé : les fichiers à la racine de `convex/` sont l'**API publique** (ce que le frontend appelle), et tout ce qui est dans `lib/` est de la **logique interne** partagée, jamais appelée directement depuis React.
