import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import App from './App';
import './index.css';
import { startServiceWorker } from './lib/pwa-update';

// React Query's provider lives in <QueryProvider>, rendered inside App (C4). There used to be
// a second QueryClientProvider here with a 5-minute staleTime; because the providers nested,
// every useQuery resolved against the inner client and this config never applied to anything.
//
// `CurrentUserProvider` used to wrap <App /> inside AuthProvider. It derived everything it
// held from `useAuth()` and then made its OWN `users` read and kept its OWN localStorage
// cache of the same person — a second profile source over one row, which is how renaming
// yourself could change your name in the sidebar and not on your own comments. It is merged
// into AuthProvider: one read, one cache, `useAuth().profile`.

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error("Could not find root element to mount to");
}

/*
 * Register the service worker at boot, before React mounts.
 *
 * It must not wait for the app shell: the landing and login pages are the first things anyone
 * loads, and a user whose connection drops before they finish signing in still needs the
 * precache. `vite.config.ts` sets `injectRegister: null`, so this is the only registration --
 * and `AppUpdatePrompt` merely subscribes to what it finds.
 */
startServiceWorker();

const root = ReactDOM.createRoot(rootElement);
root.render(
    <React.StrictMode>
        <HashRouter>
            <AuthProvider>
                <App />
            </AuthProvider>
        </HashRouter>
    </React.StrictMode>
);
