import { createContext, useContext } from 'react';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type AuthContextType = {
  adminEmail: string | null;
  status: AuthStatus;
  authError: string | null;
  needsApiAccessLogin: boolean;
  refreshSession: () => Promise<void>;
  openAccessLogin: () => void;
  signOut: () => void;
};

export const AuthContext = createContext<AuthContextType>({
  adminEmail: null,
  status: 'loading',
  authError: null,
  needsApiAccessLogin: false,
  refreshSession: async () => { },
  openAccessLogin: () => { },
  signOut: () => { },
});

export const useAuth = () => useContext(AuthContext);
