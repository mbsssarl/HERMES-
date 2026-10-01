# Page de Connexion MBSS — Export Frontend

Ce dossier contient tout le code de la page de connexion du projet HERMES (M.B.S.S Sarl).
À intégrer dans un projet React + TypeScript + Tailwind CSS v4.

---

## Structure des fichiers

```
login-export/
├── README.md               ← ce fichier
├── LoginPage.tsx           ← composant principal de la page de connexion
├── index.css               ← styles globaux (Tailwind + thème sombre)
├── App.css                 ← styles CSS classiques de la page de connexion
└── assets/
    └── PLACER_ICI.md       ← instructions pour les images
```

---

## Dépendances requises

```bash
npm install react react-dom
npm install tailwindcss @tailwindcss/vite
```

---

## Intégration dans le projet

### 1. Copier les fichiers
- `LoginPage.tsx` → `src/components/LoginPage.tsx` (ou adapter le chemin)
- `index.css` → `src/index.css`
- `App.css` → `src/App.css`

### 2. Ajouter les images
Placer dans `src/assets/` :
- `BATEAU.jpg` — photo du bateau (panneau gauche)
- `logo-mbss.jpg` — logo M.B.S.S

### 3. Utiliser le composant
```tsx
// Dans App.tsx ou le routeur du projet backend
import LoginPage from './components/LoginPage'

function App() {
  const handleLogin = (email: string, password: string) => {
    // TODO: appeler l'API backend ici
    console.log('Login avec :', email, password)
  }

  return <LoginPage onLogin={handleLogin} />
}
```

---

## Ce que fait le composant

- **Connexion** : formulaire email + mot de passe avec "Rester connecté"
- **Mot de passe oublié** : flux en 3 étapes
  1. Saisie de l'email
  2. Code de vérification reçu par email
  3. Nouveau mot de passe
- **Bilingue** : FR / EN switchable
- **Responsive** : mobile, tablette, desktop

---

## Points à connecter au backend

Dans `LoginPage.tsx`, chercher les commentaires `// TODO BACKEND` :

| Ligne | Action à implémenter |
|---|---|
| `handleSubmit` — vue `login` | Appel API POST `/auth/login` avec email + password |
| `handleSubmit` — vue `email` | Appel API POST `/auth/forgot-password` avec email |
| `handleSubmit` — vue `code` | Appel API POST `/auth/verify-code` avec le code |
| `handleSubmit` — vue `password` | Appel API POST `/auth/reset-password` avec nouveau mot de passe |

---

## Couleurs du projet

| Rôle | Couleur |
|---|---|
| Vert principal (boutons) | `#36a445` |
| Bleu marine (titres) | `#22439c` |
| Bleu sidebar | `#213b8b` |
| Vert clair (accents) | `#6be477` |
