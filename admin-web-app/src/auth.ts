import { createContext, useContext } from 'react';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type AuthContextType = {
  adminEmail: string | null;
  status: AuthStatus;
  refreshSession: () => Promise<void>;
  signOut: () => void;
};

export const AuthContext = createContext<AuthContextType>({
  adminEmail: null,
  status: 'loading',
  refreshSession: async () => { },
  signOut: () => { },
});

export const useAuth = () => useContext(AuthContext);
