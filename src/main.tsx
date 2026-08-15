import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './lib/auth';
import { CurrentUserProvider } from './lib/user-context';
import App from './App';
import './index.css';

// React Query's provider lives in <QueryProvider>, rendered inside App (C4). There used to be
// a second QueryClientProvider here with a 5-minute staleTime; because the providers nested,
// every useQuery resolved against the inner client and this config never applied to anything.

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
    <React.StrictMode>
        <HashRouter>
            <AuthProvider>
                <CurrentUserProvider>
                    <App />
                </CurrentUserProvider>
            </AuthProvider>
        </HashRouter>
    </React.StrictMode>
);
