import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles/globals.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 2_000,
    },
  },
});

const tokenMissing = !new URL(window.location.href).searchParams.get('token');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {tokenMissing ? <NoToken /> : (
      <QueryClientProvider client={qc}>
        <App />
      </QueryClientProvider>
    )}
  </React.StrictMode>
);

function NoToken() {
  return (
    <div style={{ padding: 48, fontFamily: 'system-ui', maxWidth: 640, margin: '0 auto', color: '#1F1D1B', background: '#FBF7EE', minHeight: '100vh' }}>
      <h1 style={{ letterSpacing: '-0.02em' }}>AEGIS Studio — token required</h1>
      <p>Open the URL printed by <code>aegis --studio</code> in your terminal:</p>
      <pre style={{ background: '#F0EADB', padding: 12, borderRadius: 6 }}>http://127.0.0.1:7474/?token=…</pre>
      <p style={{ color: '#5C574F' }}>
        The token is generated fresh on every boot. Visiting without it (or with a stale token) shows
        this page so the studio API stays gated against drive-by browser requests from other origins.
      </p>
    </div>
  );
}
