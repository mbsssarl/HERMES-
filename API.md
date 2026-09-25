# API backend - guide pour l'équipe frontend

Ce document liste toutes les fonctions Convex appelables depuis un client
(queries, mutations, actions), avec leurs arguments, ce qu'elles renvoient,
qui a le droit de les appeler, et comment les utiliser depuis React.

**Contexte** : le frontend actuellement dans `src/` est une implémentation
personnelle, non définitive - un frontend "de référence" pour valider que le
backend fonctionne bout en bout. Le vrai frontend d'équipe peut être une
application séparée ; ce document décrit le contrat backend sur lequel
s'appuyer, indépendamment de `src/`.

Le backend est dans `convex/`. Le schéma des tables et l'architecture sont
documentés dans [convex/README.md](convex/README.md) - ce fichier-ci se
concentre uniquement sur "comment appeler l'API depuis un frontend".

---

## 1. Mise en place côté frontend

```bash
npm install convex @convex-dev/auth
```

```tsx
// main.tsx (ou équivalent)
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL);

<ConvexAuthProvider client={convex}>
  <App />
</ConvexAuthProvider>;
```

`VITE_CONVEX_URL` est fourni par la personne qui gère le déploiement Convex
(visible dans `.env.local` généré par `npx convex dev`, ou dans le dashboard
Convex pour un déploiement partagé/staging).

### Import des fonctions et des types

```ts
import { api } from "../convex/_generated/api"; // les fonctions appelables
import type { Doc, Id } from "../convex/_generated/dataModel"; // les types (import type obligatoire, voir note ci-dessous)
```

⚠️ **`dataModel` ne doit être importé qu'avec `import type`.** Ce module ne
contient que des types (pas de code exécutable) - un `import { Doc, Id } from ...`
classique fera planter le bundler (Vite ou autre) qui essaiera de charger un
fichier `.js` qui n'existe pas. `api`, lui, s'importe normalement (`import {
api } from ...`), c'est du code réel.

### Appeler une fonction

```tsx
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../convex/_generated/api";

// Query : lecture réactive - se met à jour automatiquement, pas de refetch manuel
const orders = useQuery(api.orders.list, { status: "draft" });

// Mutation : écriture
const createOrder = useMutation(api.orders.create);
await createOrder({ clientId, clientOrderNumber: "PO-1234" });

// Action : pour tout ce qui touche des fichiers lourds ou des API externes
const generateQuotation = useAction(api.quotationGeneration.generateQuotation);
await generateQuotation({ orderId });
```

`useQuery` renvoie `undefined` tant que la donnée n'est pas encore chargée -
toujours gérer cet état de chargement.

---

## 2. Authentification

Géré par `@convex-dev/auth` (provider "Password"), pas par des endpoints
maison. Deux hooks à connaître :

```tsx
import { useAuthActions } from "@convex-dev/auth/react";
import { Authenticated, Unauthenticated, AuthLoading } from "convex/react";

const { signIn, signOut } = useAuthActions();

// Connexion
await signIn("password", { email, password, flow: "signIn" });

// Déconnexion
await signOut();
```

- `<AuthLoading>`, `<Authenticated>`, `<Unauthenticated>` (de `convex/react`)
  permettent de conditionner l'UI sans gérer l'état de chargement à la main.
- **Il n'y a pas d'inscription libre** (`flow: "signUp"` n'est pas utilisé) -
  tous les comptes sont créés par un admin via `api.users.createUser`
  (§4.1). Ne pas exposer de formulaire d'inscription dans le vrai frontend.
- Après un `signIn` réussi, appeler `api.users.recordLogin` (mutation, sans
  argument) pour horodater la connexion - utilisé par le dashboard admin.
- Juste après connexion, vérifier `api.users.getCurrentUser().mustChangePassword`
  - si `true`, bloquer l'accès au reste de l'app et forcer un appel à
  `api.users.setNewPassword` avant de continuer (cf. §4.1).

---

## 3. Conventions générales

- **Erreurs** : une fonction qui échoue lève une `Error` avec un message en
  français, pensé pour être affiché tel quel à l'utilisateur (ex: `"Un
  utilisateur avec cet email existe déjà."`). Toujours capturer avec
  `try/catch` autour des `mutation`/`action` et afficher `err.message`.
- **Temps réel** : toutes les `query` sont réactives. Si un autre
  utilisateur (ou une action serveur, comme le re-matching automatique)
  modifie une donnée que vous lisez via `useQuery`, votre composant se
  re-rend automatiquement - pas de polling, pas de bouton "rafraîchir" à
  prévoir.
- **Rôles** : deux rôles, `"user"` et `"admin"` (champ `role` sur
  `api.users.getCurrentUser`). Les fonctions réservées à l'admin sont
  marquées ci-dessous ; les appeler avec un compte non-admin lève une
  erreur (`"Action réservée aux administrateurs."`) - le frontend doit de
  toute façon masquer ces actions dans l'UI pour un utilisateur standard.
- **Suppression** : rien n'est jamais supprimé physiquement (clients,
  commandes, produits, utilisateurs). Les mutations "supprimer" sont en
  réalité des désactivations (`deactivate`, `toggleUserStatus`, statut
  `"archived"`...).
- **Devise / pays** : le prix d'un produit dépend du **pays de cotation**
  (table `countries`), pas d'une devise globale. Chaque commande fixe son
  pays à la création (`orders.countryId`, obligatoire, non modifiable
  ensuite) - c'est ce pays qui détermine la devise du devis et quel prix de
  `productPrices` est utilisé pour chaque ligne. Un produit peut être
  identifié (matché) sans avoir de prix pour le pays de la commande : la
  ligne reste alors "prix manquant" (`orderItem.unitPriceOriginal ===
  undefined` alors que `orderItem.productId` est défini) jusqu'à ce qu'un
  admin ajoute ce prix - elle se complète alors automatiquement (temps réel).

---

## 4. Référence des fonctions

Format par entrée : `module.fonction` - **type** - **accès** - description,
arguments, retour.

### 4.1 `users` - comptes et authentification

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `users.getCurrentUser` | query | public | `{}` → profil de l'utilisateur connecté (`null` si déconnecté ou désactivé). Contient `role`, `status`, `mustChangePassword`, `email`. À appeler partout où l'UI dépend du rôle. |
| `users.listUsers` | query | admin | `{}` → liste de tous les comptes, pour la gestion des utilisateurs. |
| `users.createUser` | mutation | admin | `{ email: string }` → crée un compte (`role: "user"`), génère un mot de passe temporaire, envoie un email de bienvenue via Brevo. Erreur si l'email existe déjà. |
| `users.toggleUserStatus` | mutation | admin | `{ userId, status: "active" \| "disabled" }` → active/désactive un compte. Erreur si on tente de se désactiver soi-même. |
| `users.recordLogin` | mutation | user connecté | `{}` → à appeler juste après un `signIn` réussi (horodatage + log d'activité). |
| `users.setNewPassword` | mutation | user connecté | `{ newPassword: string }` (8 caractères min) → change le mot de passe et désactive `mustChangePassword`. À utiliser pour le changement forcé après un compte créé par un admin, et pour un changement de mot de passe volontaire. |
| `users.requestPasswordReset` | mutation | public | `{ email: string }` → envoie un email avec un lien de réinitialisation si le compte existe (répond toujours pareil, même si l'email n'existe pas - pas d'énumération de comptes). |
| `users.resetPasswordWithToken` | mutation | public | `{ token: string, newPassword: string }` → `token` vient du lien reçu par email (query param `?token=...`). Le lien expire après 1h et n'est utilisable qu'une fois. |

Note : `users.bootstrapFirstAdmin` existe aussi mais est un utilitaire
d'amorçage à usage unique (crée le tout premier admin), pas destiné à être
appelé depuis un frontend applicatif.

### 4.2 `clients`

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `clients.list` | query | user | `{ search?: string }` → liste des clients (non supprimés), filtrée par nom si `search` fourni. |
| `clients.get` | query | user | `{ clientId }` → un client. |
| `clients.create` | mutation | user | `{ name, contactEmail?, contactPhone?, address?, notes?, countryId? }` → crée un client, renvoie son `Id<"clients">`. `countryId` pré-remplit (sans l'imposer) le pays des commandes créées pour ce client. |
| `clients.update` | mutation | user | `{ clientId, name?, contactEmail?, contactPhone?, address?, notes?, countryId? }` → modifie les champs fournis. |

### 4.3 `products` - catalogue

L'identité du produit (nom, IMPA, unité...) et son **prix sont deux choses
séparées** : un produit n'a pas de prix intrinsèque, voir §4.3bis
(`productPrices`).

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `products.list` | query | user | `{ search?: string }` → sans `search`, les 200 derniers produits actifs ; avec `search`, recherche plein-texte sur le nom (jusqu'à 100 résultats). |
| `products.get` | query | user | `{ productId }` → un produit (sans prix - voir `productPrices.listForProduct`). |
| `products.createManual` | mutation | admin | `{ impaId?, code?, name, description?, unit, category? }` → crée l'identité du produit uniquement. Appeler ensuite `productPrices.setPrice` pour lui donner un prix dans au moins un pays. |
| `products.update` | mutation | admin | `{ productId, name?, description?, unit?, category?, code?, impaId? }` → modifie l'identité du produit. |
| `products.deactivate` | mutation | admin | `{ productId }` → désactive (n'apparaît plus dans les recherches/matching). |

### 4.3bis `productPrices` - prix par pays

Le prix d'un produit dépend toujours du pays. Changer un prix ne remplace
jamais la ligne existante : l'ancienne est clôturée (`validTo`) et une
nouvelle est créée - l'historique des prix passés est donc consultable.

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `productPrices.listForProduct` | query | user | `{ productId }` → les prix **actuellement en vigueur** du produit, un par pays où il en a un, avec `country` déjà résolu. |
| `productPrices.getCurrentForProductAndCountry` | query | user | `{ productId, countryId }` → le prix courant pour ce couple précis, ou `null` si aucun. |
| `productPrices.setPrice` | mutation | admin | `{ productId, countryId, price, currency }` → crée ou met à jour le prix pour ce pays. **Effet de bord important** : recherche automatiquement toutes les lignes de commande (`orderItems`) qui attendaient ce prix précis (matchées mais "prix manquant" pour ce pays) et les complète en temps réel. |

### 4.3ter `countries` - pays de cotation

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `countries.list` | query | user | `{ activeOnly?: boolean }` → liste des pays. À utiliser pour peupler le sélecteur de pays lors de la création d'une commande ou d'un client. |
| `countries.get` | query | user | `{ countryId }` → un pays. |
| `countries.create` | mutation | admin | `{ code, name, currency }` → crée un pays. Erreur si le code existe déjà. |
| `countries.update` | mutation | admin | `{ countryId, name?, currency?, active? }` → modifie un pays (`active: false` le retire des sélecteurs sans casser les commandes existantes qui le référencent). |

### 4.4 `orders` - commandes

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `orders.list` | query | user | `{ status?, clientId?, search?, mineOnly? }` → liste des commandes (non supprimées), avec le client et le pays déjà résolus (`order.client`, `order.country`). `search` filtre sur la référence ou le numéro client. `mineOnly: true` limite aux commandes créées par l'utilisateur connecté. |
| `orders.get` | query | user | `{ orderId }` → une commande avec son client (`order.client`) et son pays (`order.country`) résolus, ou `null`. |
| `orders.create` | mutation | user | `{ clientId, countryId, clientOrderNumber?, vessel?, eta?, supplyPlace? }` → crée une commande en statut `"draft"`, génère automatiquement `reference` (ex: `Q-2026-0001`). **`countryId` est obligatoire et figé pour toute la vie de la commande** (il détermine le pricing) - pré-remplissez-le depuis `client.countryId` si connu, mais laissez l'utilisateur le changer avant validation. Renvoie l'`Id<"orders">`. |
| `orders.updateStatus` | mutation | user | `{ orderId, status }` → `status` ∈ `"draft" \| "processing" \| "awaiting_supplier" \| "completed" \| "sent" \| "archived"`. |
| `orders.updateLogistics` | mutation | user | `{ orderId, vessel?, eta?, supplyPlace? }` → modifie ces 3 champs informatifs (non liés au pricing, donc modifiables à tout moment, contrairement au pays). `eta` au format `"YYYY-MM-DD"`. |
| `orders.setQuotationOverride` | mutation | admin | `{ orderId, percent?: number }` → cotation (%) spécifique à cette commande. `percent: undefined` revient à la cotation par défaut globale. |
| `orders.setGlobalDiscount` | mutation | admin | `{ orderId, percent?: number }` → réduction globale appliquée au moment de la génération du devis. |
| `orders.archive` | mutation | user | `{ orderId }` → passe le statut à `"archived"`. |

### 4.5 `orderItems` - lignes d'une commande

C'est la table la plus riche : chaque ligne représente un article du
document client, avec son statut de correspondance (matching) et son prix.

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `orderItems.listByOrder` | query | user | `{ orderId }` → toutes les lignes de la commande, triées par `lineNo`, avec le produit déjà résolu (`item.product`, `null` si non matché) et les candidats ambigus résolus (`item.ambiguousProducts`). **C'est la query à utiliser pour afficher les tableaux "articles répertoriés" / "non répertoriés" / "à confirmer"** - filtrez côté client sur `item.matchStatus`. |
| `orderItems.confirmAmbiguousMatch` | mutation | user | `{ orderItemId, productId }` → confirme qu'une ligne `"ambiguous"` correspond bien au produit choisi parmi `ambiguousCandidates`. Si la ligne n'avait pas de code, le libellé exact du client est mémorisé comme alias du produit - la même formulation matchera instantanément la prochaine fois. |
| `orderItems.setManualMatch` | mutation | user | `{ orderItemId, productId }` → associe manuellement n'importe quelle ligne (même `"unmatched"`) à un produit choisi librement (pas limité aux candidats proposés). Même apprentissage d'alias que ci-dessus. |
| `orderItems.clearMatch` | mutation | user | `{ orderItemId }` → annule la correspondance, repasse la ligne en `"unmatched"`. |
| `orderItems.update` | mutation | user | `{ orderItemId, quotedQuantity?, lineDiscountPercent?, reqNotes?, enqNotes? }` → modifie la quantité retenue et/ou la remise ligne (recalcule automatiquement `total`/`finalUnitPrice` si la ligne est déjà matchée) et/ou les notes. |

`matchStatus` possibles : `"matched_impa"` (correspondance exacte),
`"matched_name"` (correspondance par nom ou par alias appris, automatique),
`"manual"` (confirmée ou choisie à la main), `"ambiguous"` (à confirmer),
`"unmatched"` (non répertorié).

⚠️ Une ligne peut être matchée (`productId` défini, `matchStatus` ≠
`"unmatched"`/`"ambiguous"`) **sans avoir de prix** si aucun prix n'existe
pour le pays de la commande (`unitPriceOriginal === undefined`). Affichez ce
cas distinctement (ex: badge "Prix manquant") plutôt que comme une ligne
vide - elle se complète automatiquement dès qu'un admin ajoute le prix via
`productPrices.setPrice`.

### 4.6 `files` - import/export de documents

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `files.generateUploadUrl` | mutation | user | `{}` → renvoie une URL signée à usage unique vers laquelle uploader un fichier (voir le pattern complet en §5.1). |
| `files.listByOrder` | query | user | `{ orderId }` → tous les fichiers liés à une commande (importés et générés), avec leur `status` d'extraction. |
| `files.registerUploadedFile` | mutation | user | `{ orderId, storageId, kind: "client_request" \| "supplier_response", fileName, mimeType, size }` → à appeler juste après l'upload effectif (voir §5.1). Déclenche automatiquement l'extraction en arrière-plan. Rejette les fichiers > 15 Mo ou dont le type MIME n'est pas PDF/Excel/Word. |
| `files.getUrl` | query | user | `{ storageId }` → URL de téléchargement d'un fichier stocké (utilisé pour les liens "télécharger" sur les templates générés et les PDF de devis). |

### 4.7 `extraction` - génération du template fournisseur

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `extraction.generateSupplierTemplate` | action | user | `{ orderId }` → génère un fichier Excel prérempli avec les lignes `"unmatched"` de la commande, l'enregistre comme fichier de type `"generated_supplier_template"`. Renvoie l'`Id<"uploadedFiles">` - récupérer l'URL de téléchargement via `files.getUrl`. |

(L'extraction des documents importés, elle, se déclenche **automatiquement**
après `files.registerUploadedFile` - rien à appeler explicitement pour ça,
il suffit d'observer `files.listByOrder` pour voir le statut passer à
`"extracted"` ou `"error"`.)

### 4.8 `supplierItems` - validation du fichier fournisseur

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `supplierItems.listByOrder` | query | user | `{ orderId }` → les lignes extraites du dernier fichier fournisseur importé, avec leur `status`. |
| `supplierItems.update` | mutation | user | `{ supplierItemId, rawCode?, rawName?, rawDescription?, rawUnit?, rawPrice? }` → corrige/complète une ligne avant enregistrement. |
| `supplierItems.reject` | mutation | user | `{ supplierItemId }` → écarte une ligne (ne sera pas ajoutée au catalogue). |
| `supplierItems.saveToCatalog` | mutation | user | `{ supplierItemIds: Id<"supplierItems">[] }` → pour chaque ligne `"pending_validation"` sélectionnée (erreur si `rawUnit`/`rawPrice` manquant) : crée le produit s'il n'existe pas encore, puis enregistre son prix pour le pays de la commande - **puis relance automatiquement le matching et le pricing** de toutes les lignes de la commande. C'est cette mutation qui fait apparaître en temps réel les articles nouvellement reconnus (ou nouvellement priçés) dans `orderItems.listByOrder`. |

`supplierItems.status` possibles : `"pending_validation"`, `"validated"`,
`"rejected"`, `"duplicate"`. Un produit avec ce code peut déjà exister sans
que ce soit un vrai doublon : `"duplicate"` ne s'applique que si ce produit
**a déjà un prix pour le pays de la commande en cours** - sinon la ligne
reste `"pending_validation"` (elle sert alors juste à ajouter le prix
manquant à un produit existant, sans recréer le produit).

### 4.9 `quotations` - devis

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `quotations.listByOrder` | query | user | `{ orderId }` → toutes les versions de devis générées pour la commande, plus récentes en premier. |
| `quotations.approve` | mutation | admin | `{ quotationId }` → marque un devis comme approuvé par un admin avant envoi (`approvedByAdmin`, `approvedBy`, `approvedAt`). |
| `quotations.listEmailLogs` | query | user | `{ orderId }` → historique des envois d'emails pour cette commande. |
| `quotationGeneration.generateQuotation` | action | user | `{ orderId }` → calcule les prix finaux (cotation + remise ligne + remise globale), génère le PDF (avec navire/ETA/port si renseignés), l'enregistre dans Convex Storage, crée une nouvelle version dans `quotations`, et passe la commande en statut `"completed"` si elle n'est pas déjà `"sent"`/`"archived"`. La devise du PDF est celle du pays de la commande. Seules les lignes répertoriées **avec un prix** sont incluses (les "prix manquant" sont exclues) ; erreur si aucune ligne éligible. Renvoie l'`Id<"quotations">`. |

### 4.10 `emails`

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `emails.sendQuotationEmail` | action | user | `{ orderId, quotationId, to, subject, message }` → envoie le PDF du devis en pièce jointe via Brevo, journalise l'envoi (`emailLogs`), et passe la commande en statut `"sent"` si l'envoi réussit. Lève une erreur si l'envoi échoue (mais l'échec est quand même journalisé). |

### 4.11 `settings` - paramètres globaux

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `settings.get` | query | user | `{ key: string }` → valeur du paramètre (`null` si non défini). Clés connues : `"defaultQuotationPercent"` (number), `"companyInfo"` (`{ name?, address?, email? }`). Il n'y a pas de devise globale - voir `countries`. |
| `settings.list` | query | user | `{}` → tous les paramètres. |
| `settings.update` | mutation | admin | `{ key: string, value: any }` → crée ou met à jour un paramètre. |

### 4.12 `activityLogs` / `admin` - administration

| Fonction | Type | Accès | Description |
|---|---|---|---|
| `activityLogs.list` | query | admin | `{ entityType?, userId?, limit? }` (défaut `limit: 200`) → journal d'audit, plus récent en premier. |
| `admin.getDashboardStats` | query | admin | `{}` → `{ users: { total, active, disabled }, orders: { total, byStatus }, totalRevenue, recentActivity }`. `totalRevenue` = somme du dernier devis généré pour chaque commande au statut `"sent"`. |

---

## 5. Recettes pour les flux principaux

### 5.1 Importer un document (client ou fournisseur)

```tsx
const generateUploadUrl = useMutation(api.files.generateUploadUrl);
const registerUploadedFile = useMutation(api.files.registerUploadedFile);

async function uploadFile(orderId: Id<"orders">, file: File, kind: "client_request" | "supplier_response") {
  const uploadUrl = await generateUploadUrl();
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  const { storageId } = await res.json();

  await registerUploadedFile({
    orderId,
    storageId,
    kind,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
  });
  // L'extraction démarre automatiquement côté serveur. Pour suivre la
  // progression, observez `files.listByOrder` (réactif) : status passe
  // "uploaded" → "extracting" → "extracted" | "error".
}
```

### 5.2 Traiter une commande de bout en bout

1. `orders.create` avec un `countryId` choisi (pré-rempli depuis `client.countryId` si disponible) → récupérer `orderId`. Ce choix est définitif pour la commande.
2. Upload du document client (§5.1, `kind: "client_request"`).
3. Observer `orderItems.listByOrder({ orderId })` : les lignes apparaissent
   automatiquement, déjà triées en `matched_*` / `ambiguous` / `unmatched`.
4. Pour chaque ligne `"ambiguous"` : afficher `item.ambiguousProducts` et
   appeler `orderItems.confirmAmbiguousMatch` sur le choix de l'utilisateur.
5. Pour les lignes `"unmatched"` restantes : `extraction.generateSupplierTemplate`
   → télécharger via `files.getUrl` sur le fichier renvoyé.
6. Upload de la réponse fournisseur (§5.1, `kind: "supplier_response"`).
7. Observer `supplierItems.listByOrder({ orderId })`, corriger si besoin
   (`supplierItems.update`), puis `supplierItems.saveToCatalog` avec les
   ids sélectionnés → les lignes `orderItems` correspondantes se
   mettent à jour **automatiquement** (temps réel, pas de refetch à faire).
8. Une fois satisfait du contenu : `quotationGeneration.generateQuotation({ orderId })`.
9. `emails.sendQuotationEmail` pour l'envoyer au client.

Aucune étape n'est strictement bloquante côté backend (on peut générer un
devis avec des lignes encore non répertoriées, tant qu'il y a au moins une
ligne répertoriée) - c'est au frontend de guider l'utilisateur dans cet
ordre si c'est le comportement voulu.

### 5.3 Créer un utilisateur (admin)

```tsx
const createUser = useMutation(api.users.createUser);
await createUser({ email: "nouveau@exemple.com" });
// Un mot de passe temporaire est généré et envoyé par email (Brevo).
// L'utilisateur devra le changer à la première connexion
// (mustChangePassword: true) - voir §2.
```

---

## 6. Ce qui n'est volontairement pas exposé

Les fonctions suffixées `Internal` (ex: `orderItems.saveExtractedItemsInternal`,
`quotations.getQuotationBuildDataInternal`) ne sont **pas** dans `api.*` -
elles sont appelées uniquement entre fonctions serveur (`internal.*`), pas
accessibles depuis un client. Si un besoin frontend semble nécessiter l'une
d'entre elles, c'est probablement le signe qu'il manque une fonction
publique dédiée à créer côté backend plutôt que de contourner celle-ci.
