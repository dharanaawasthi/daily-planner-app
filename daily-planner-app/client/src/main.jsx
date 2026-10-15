import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import App from './App.jsx';
import './styles.css';

// Read from client/.env.local (ignored by Git). A Clerk *publishable* key is
// meant for the browser; the secret key (sk_...) must never be used here.
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const hasValidKey = typeof PUBLISHABLE_KEY === 'string' && /^pk_(test|live)_\S+$/.test(PUBLISHABLE_KEY);

/** Shown instead of the app when the key is missing or still the placeholder. */
function ClerkSetupNotice() {
  return (
    <main className="auth-screen">
      <div className="auth-card setup-card" role="alert">
        <h1>Sign-in isn’t set up yet</h1>
        <p>
          Add your Clerk publishable key to <code>client/.env.local</code>:
        </p>
        <pre>VITE_CLERK_PUBLISHABLE_KEY=pk_test_…</pre>
        <p>
          Find it in the Clerk Dashboard under <strong>API keys</strong>, then restart <code>npm run dev</code>.
        </p>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {hasValidKey ? (
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/">
        <App />
      </ClerkProvider>
    ) : (
      <ClerkSetupNotice />
    )}
  </StrictMode>,
);
