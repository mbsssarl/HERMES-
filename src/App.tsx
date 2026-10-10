import React from 'react';
import { Authenticated, AuthLoading, Unauthenticated, useMutation } from 'convex/react';
import { ToastProvider, useToast } from './components/Toast';
import { Sidebar, type View } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { QuotationsList } from './pages/QuotationsList';
import { NewQuotation } from './pages/NewQuotation';
import { QuotationDetail } from './pages/QuotationDetail';
import { Products } from './pages/Products';
import { Login, SetPassword } from './pages/Login';
import { Admin } from './pages/Admin';
import { Settings } from './pages/Settings';
import { applyTheme } from './lib/theme';
import { setLanguage, useLanguage } from './lib/i18n';
import { api } from './lib/convex';
import { StateBox } from './components/ui';
import { useCountries, useCurrencies, useMe, useProductCategories, useProducts, useQuotation, useQuotations } from './lib/hooks';

function AppInner() {
  const me = useMe();
  useLanguage(); // redessine toute l'application quand la langue change
  const [view, setView] = React.useState<View>('dashboard');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const { countries, loading: loadingCountries } = useCountries();
  const { currencies } = useCurrencies();
  const { categories } = useProductCategories();
  // Le catalogue n'est chargé que là où il sert (catalogue, détail d'une quotation pour ses propositions).
  const { products, loading: loadingProducts } = useProducts(view === 'products' || view === 'detail');
  const { quotations, deleted: deletedQuotations, loading: loadingQuotations } = useQuotations();
  const { quotation: selectedQuotation, edits: pendingEdits, validation, loading: loadingDetail } = useQuotation(selectedId);

  // Dernière connexion : enregistrée une fois par session, quand le profil est bien chargé.
  const recordLogin = useMutation(api.users.recordLogin);
  const userId = me?.id;
  React.useEffect(() => {
    if (!userId) return;
    try {
      if (sessionStorage.getItem('login-recorded') === userId) return;
      sessionStorage.setItem('login-recorded', userId);
    } catch { /* stockage indisponible */ }
    recordLogin({}).catch(() => {});
  }, [userId, recordLogin]);

  // Le thème du compte s'applique dès que le profil est chargé (et suit l'utilisateur d'un poste à l'autre).
  const theme = me?.theme;
  React.useEffect(() => { if (theme) applyTheme(theme); }, [theme]);

  // Idem pour la langue de l'interface.
  const language = me?.language;
  React.useEffect(() => { if (language) setLanguage(language); }, [language]);

  // Filet de sécurité : si un utilisateur non-admin se retrouve sur un onglet réservé (ex. son rôle vient de
  // changer pendant que l'app était ouverte), on le ramène au tableau de bord plutôt que d'afficher un écran vide.
  React.useEffect(() => {
    if (me && me.role !== 'admin' && (view === 'products' || view === 'admin')) setView('dashboard');
  }, [me, view]);

  // Notification en direct : une quotation vient d'être mise à jour suite à un ajout au catalogue (par n'importe
  // quel utilisateur). Au chargement, les mises à jour déjà présentes ne déclenchent pas de notification : elles
  // sont signalées par le badge de la liste et la pastille du menu.
  const toast = useToast();
  const knownUpdates = React.useRef<Map<string, number> | null>(null);
  React.useEffect(() => {
    if (loadingQuotations) return;
    const known = knownUpdates.current;
    if (known) {
      const fresh = quotations.filter((q) => q.catalog_update && (known.get(q.id) ?? 0) < q.catalog_update.at);
      if (fresh.length === 1) {
        const q = fresh[0];
        const u = q.catalog_update!;
        toast(
          `${q.quotation_number} : ${u.lines} ligne(s) reconnue(s) ou chiffrée(s) suite à un ajout au catalogue${u.by ? ` par ${u.by}` : ''}.`,
          'info',
          { action: { label: 'Ouvrir', onClick: () => { setSelectedId(q.id); setView('detail'); } } },
        );
      } else if (fresh.length > 1) {
        toast(`${fresh.length} quotations ont été mises à jour suite à un ajout au catalogue.`, 'info', {
          action: { label: 'Voir', onClick: () => setView('quotations') },
        });
      }
    }
    knownUpdates.current = new Map(quotations.filter((q) => q.catalog_update).map((q) => [q.id, q.catalog_update!.at]));
  }, [quotations, loadingQuotations, toast]);

  if (me === undefined || me === null) return <StateBox loading variant="app" title="Chargement…" />;
  if (me.mustChangePassword) return <SetPassword />;

  const openQuotation = (id: string) => {
    setSelectedId(id);
    setView('detail');
  };

  const goTo = (v: View) => {
    if (v !== 'detail') setSelectedId(null);
    setView(v);
  };

  const updatedCount = quotations.filter((q) => q.catalog_update).length;
  const pendingCount = quotations.filter((q) => q.status === 'REVIEW_REQUIRED' || q.status === 'AWAITING_SUPPLIER').length;
  const loadingCatalog = loadingCountries || loadingProducts;

  return (
    <div className="app">
      <Sidebar current={view} onNavigate={goTo} pendingCount={pendingCount} updatedCount={updatedCount} me={me} />
      <main className="main">
        {view === 'dashboard' && (
          <Dashboard
            quotations={quotations}
            loading={loadingQuotations}
            onOpen={(q) => openQuotation(q.id)}
            onNew={() => setView('new')}
            onSeeAll={() => setView('quotations')}
          />
        )}
        {view === 'quotations' && (
          <QuotationsList
            quotations={quotations}
            deletedQuotations={deletedQuotations}
            loading={loadingQuotations}
            isAdmin={me.role === 'admin'}
            onOpen={(q) => openQuotation(q.id)}
            onNew={() => setView('new')}
          />
        )}
        {view === 'new' && (
          <NewQuotation countries={countries} onCreated={openQuotation} />
        )}
        {view === 'detail' && (
          <QuotationDetail
            quotation={selectedQuotation}
            products={products}
            currencies={currencies}
            loading={loadingDetail}
            isAdmin={me.role === 'admin'}
            meId={me.id}
            edits={pendingEdits}
            validation={validation}
            onBack={() => { setSelectedId(null); setView('quotations'); }}
          />
        )}
        {view === 'products' && me.role === 'admin' && (
          <Products products={products} countries={countries} categories={categories} loading={loadingCatalog} isAdmin />
        )}
        {view === 'settings' && <Settings me={me} />}
        {view === 'admin' && me.role === 'admin' && (
          <Admin quotations={quotations} countries={countries} loadingCountries={loadingCountries} currencies={currencies} categories={categories} onOpen={(q) => openQuotation(q.id)} />
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthLoading><StateBox loading variant="app" title="Chargement…" /></AuthLoading>
      <Unauthenticated><Login /></Unauthenticated>
      <Authenticated><AppInner /></Authenticated>
    </ToastProvider>
  );
}
