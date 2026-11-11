import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { OwnerProvider } from './auth/OwnerContext';

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
    <StrictMode>
        <BrowserRouter>
            <OwnerProvider>
                <App />
            </OwnerProvider>
        </BrowserRouter>
    </StrictMode>,
);
