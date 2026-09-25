import React from 'react';
import { Authenticated, AuthLoading, Unauthenticated } from 'convex/react';
import { ToastProvider } from './components/Toast';
import { Sidebar, type View } from './components/Sidebar';
import { Dashboard } from './pages/Dashboard';
import { QuotationsList } from './pages/QuotationsList';
import { NewQuotation } from './pages/NewQuotation';
import { QuotationDetail } from './pages/QuotationDetail';
import { Products } from './pages/Products';
import { Countries } from './pages/Countries';
import { Login, SetPassword } from './pages/Login';
import { StateBox } from './components/ui';
import { useCountries, useMe, useProducts, useQuotation, useQuotations } from './lib/hooks';

function AppInner() {
  const me = useMe();
  const [view, setView] = React.useState<View>('dashboard');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const { countries, loading: loadingCountries } = useCountries();
  const { products, loading: loadingProducts } = useProducts();
  const { quotations, deleted: deletedQuotations, loading: loadingQuotations } = useQuotations();
  const { quotation: selectedQuotation, loading: loadingDetail } = useQuotation(selectedId);

  if (me === undefined || me === null) return <StateBox loading title="Chargement…" />;
  if (me.mustChangePassword) return <SetPassword />;

  const openQuotation = (id: string) => {
    setSelectedId(id);
    setView('detail');
  };

  const goTo = (v: View) => {
    if (v !== 'detail') setSelectedId(null);
    setView(v);
  };

  const pendingCount = quotations.filter((q) => q.status === 'REVIEW_REQUIRED' || q.status === 'AWAITING_SUPPLIER').length;
  const loadingCatalog = loadingCountries || loadingProducts;

  return (
    <div className="app">
      <Sidebar current={view} onNavigate={goTo} pendingCount={pendingCount} me={me} />
      <main className="main">
        {view === 'dashboard' && (
          <Dashboard
            quotations={quotations}
            loading={loadingQuotations}
            onOpen={(q) => openQuotation(q.id)}
            onNew={() => setView('new')}
          />
        )}
        {view === 'quotations' && (
          <QuotationsList
            quotations={quotations}
            deletedQuotations={deletedQuotations}
            loading={loadingQuotations}
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
            loading={loadingDetail}
            isAdmin={me.role === 'admin'}
            onBack={() => { setSelectedId(null); setView('quotations'); }}
          />
        )}
        {view === 'products' && (
          <Products products={products} countries={countries} loading={loadingCatalog} isAdmin={me.role === 'admin'} />
        )}
        {view === 'countries' && (
          <Countries countries={countries} loading={loadingCountries} isAdmin={me.role === 'admin'} />
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthLoading><StateBox loading title="Chargement…" /></AuthLoading>
      <Unauthenticated><Login /></Unauthenticated>
      <Authenticated><AppInner /></Authenticated>
    </ToastProvider>
  );
}
