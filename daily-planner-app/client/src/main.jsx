import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';
import App from './App.jsx';
import './styles.css';

// Read from client/.env.local (ignored by Git). A Clerk *publishable* key is
// meant for the browser; the secret key (sk_...) must never be used here.
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const hasValidKey = typeof PUBLISHABLE_KEY === 'string' && /^pk_(test|live)_\S+$/.test(PUBLISHABLE_KEY);

// Visual theme only (Clerk's supported `appearance` variables) — mirrors the
// tokens in styles.css. Navy text on coral keeps primary buttons readable.
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: '#FF6B4A',
    colorPrimaryForeground: '#142B4A',
    colorForeground: '#142B4A',
    colorMutedForeground: '#4D6080',
    colorBackground: '#FFFFFF',
    colorInput: '#FFFFFF',
    colorInputForeground: '#142B4A',
    colorNeutral: '#142B4A',
    colorRing: '#142B4A',
    colorShadow: '#142B4A',
    colorModalBackdrop: 'rgb(20 43 74 / 0.5)',
    borderRadius: '10px',
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  },
};

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
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/" appearance={CLERK_APPEARANCE}>
        <App />
      </ClerkProvider>
    ) : (
      <ClerkSetupNotice />
    )}
  </StrictMode>,
);
