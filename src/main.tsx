import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { ConvexReactClient } from 'convex/react';
import App from './App';
import { applyTheme, storedTheme } from './lib/theme';
import './styles.css';
import './auth.css';

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
if (!convexUrl) {
  throw new Error('VITE_CONVEX_URL manquant : créez un fichier .env.local (voir .env.local.example).');
}
const convex = new ConvexReactClient(convexUrl);

// Thème mémorisé sur ce poste, appliqué avant le premier affichage.
applyTheme(storedTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConvexAuthProvider client={convex}>
      <App />
    </ConvexAuthProvider>
  </React.StrictMode>
);
