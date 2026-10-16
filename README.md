# Hermès - Application de quotation

Application métier : import de documents client (PDF/Excel/Word), extraction et
matching automatique avec le catalogue produits, gestion du cycle fournisseur,
génération et envoi de quotations.

Stack : React + Vite + TypeScript (CSS maison, voir `src/styles.css`), Convex (backend, base de
données, temps réel, stockage de fichiers), `@convex-dev/auth` (authentification),
Brevo (emails transactionnels).

## Mise en route

### 1. Dépendances

```bash
npm install
```

### 2. Lier le projet Convex (étape manuelle, une seule fois)

Cette étape nécessite une connexion interactive (ouverture du navigateur pour
l'authentification Convex) - à exécuter vous-même dans un terminal :

```bash
npx convex dev
```

Cette commande va :
- vous demander de vous connecter / créer un compte Convex,
- créer un nouveau projet (ou en lier un existant),
- générer `convex/_generated/` (types nécessaires à la compilation),
- écrire `.env.local` avec `VITE_CONVEX_URL` (utilisé par le frontend),
- déployer le schéma et les fonctions, puis rester actif pour les redéployer à chaque changement.

Laissez cette commande tourner dans un terminal pendant le développement.

### 3. Authentification : clés de session (obligatoire)

Convex Auth signe les sessions avec une paire de clés qui doit exister sur **chaque** déploiement
(dev, prod, ou nouveau projet après un import). Sans elles, la connexion échoue avec « Server Error » :

```bash
npm run auth:setup            # déploiement de dev
npm run auth:setup -- --prod  # déploiement de production
```

### 4. Variables d'environnement Convex (Brevo, URL de l'app)

Ces variables vivent côté Convex (pas dans `.env.local`), à définir avec :

```bash
npx convex env set BREVO_API_KEY "votre_clé_api_brevo"
npx convex env set BREVO_SENDER_EMAIL "no-reply@votredomaine.com"
npx convex env set BREVO_SENDER_NAME "Votre Entreprise"
npx convex env set APP_URL "http://localhost:5173"
```

`APP_URL` doit pointer vers l'URL publique de l'application en production
(utilisée dans les liens des emails de bienvenue / réinitialisation de mot de passe).

### 5. Premier compte administrateur / compte inaccessible

Aucune inscription publique n'existe. Base vide : créez le premier admin depuis un terminal
(identifiants affichés ; mot de passe à changer dès la première connexion) :

```bash
npx convex run users:bootstrapFirstAdmin
```

Compte existant mais connexion impossible (ex. après un import de backup) :

```bash
npx convex run debugAuth:checkAccount '{"email":"admin@hermes.dev"}'                        # diagnostic
npx convex run debugAuth:recoverLogin '{"email":"admin@hermes.dev","newPassword":"..."}'   # mot de passe à usage unique
```

### 6. Lancer le frontend

Dans un second terminal :

```bash
npm run dev
```

## Structure

- `convex/` - schéma, fonctions (queries/mutations/actions), logique métier
  (matching, pricing, extraction de fichiers, génération PDF/Excel, emails).
- `src/` - application React (MUI), organisée par feature
  (`orders`, `products`, `admin`, `auth`).

## Points volontairement simplifiés en v1

- Les PDF scannés (sans texte extractible) ne sont pas traités par OCR -
  l'utilisateur doit saisir ces lignes manuellement. Le module d'extraction
  (`convex/lib/extraction/`) est isolé pour permettre d'y brancher un moteur
  OCR plus tard sans toucher au reste du pipeline.
- Mono-devise, mono-entreprise (pas de multi-tenant).

## Travailler à plusieurs

- **Code** : dépôt Git privé. Cloner, puis `npm install`.
- **Backend Convex** : chaque développeur peut avoir sa propre instance de dev (`npx convex dev` crée
  `.env.local` avec `VITE_CONVEX_URL`, ce fichier n'est jamais commité), ou être invité dans l'équipe
  Convex du projet pour partager la même base de dev (dashboard Convex > Team settings > Members).
- **Variables d'environnement Convex** (Brevo, clés d'authentification) : elles vivent dans chaque
  déploiement Convex, pas dans Git. Voir la section « Mise en route » ci-dessus.
- **Front** : `npm run dev` (port 5173). **Types** : `convex/_generated` est commité ; relancer
  `npx convex dev` après une modification du dossier `convex/`.
- Le gabarit d'export Excel est intégré dans `convex/lib/export/templateData.ts`.
