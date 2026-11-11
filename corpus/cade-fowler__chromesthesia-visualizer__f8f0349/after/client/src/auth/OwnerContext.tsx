import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getAuthStatus } from '../components/databaseAPI';

interface OwnerState {
    /** Whether this browser is logged in as the owner; null until the server has answered */
    owner: boolean | null;
    setOwner: (owner: boolean) => void;
}

const OwnerContext = createContext<OwnerState>({ owner: false, setOwner: () => {} });

/** Asks the server once whether this browser is the owner's, and shares the answer. */
export const OwnerProvider = ({ children }: { children: ReactNode }) => {
    const [owner, setOwner] = useState<boolean | null>(null);

    useEffect(() => {
        let cancelled = false;
        getAuthStatus()
            .then((status) => !cancelled && setOwner(status.owner))
            // If the check fails, treat the visitor as logged out; reads still work
            .catch(() => !cancelled && setOwner(false));
        return () => {
            cancelled = true;
        };
    }, []);

    return <OwnerContext.Provider value={{ owner, setOwner }}>{children}</OwnerContext.Provider>;
};

export const useOwner = () => useContext(OwnerContext);
