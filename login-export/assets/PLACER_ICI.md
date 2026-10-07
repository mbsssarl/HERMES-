# Images requises

Placer dans ce dossier (ou dans `src/assets/` selon la structure du projet) :

| Fichier | Description | Usage |
|---|---|---|
| `BATEAU.jpg` | Photo du bateau / port | Fond du panneau gauche |
| `logo-mbss.jpg` | Logo M.B.S.S Sarl | En-tête du panneau gauche |

Ensuite, décommenter les imports dans `LoginPage.tsx` :

```tsx
import boatImage from '../assets/BATEAU.jpg'
import logoImage from '../assets/logo-mbss.jpg'
```

Et supprimer les lignes :
```tsx
const boatImage = ''
const logoImage = ''
```
