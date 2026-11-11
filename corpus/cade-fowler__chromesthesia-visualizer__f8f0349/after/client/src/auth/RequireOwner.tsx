import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useOwner } from './OwnerContext';

/**
 * Shows its page only to the owner. Anyone else goes to /login, which comes back here after,
 * keeping the query (Spotify's ?code= login redirect passes through here).
 */
const RequireOwner = ({ children }: { children: ReactNode }) => {
    const { owner } = useOwner();
    const { pathname, search } = useLocation();

    if (owner === null) return null;
    if (!owner) {
        const next = new URLSearchParams({ next: pathname + search });
        return <Navigate to={{ pathname: '/login', search: `?${next}` }} replace />;
    }
    return children;
};

export default RequireOwner;
