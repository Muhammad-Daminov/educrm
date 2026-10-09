'use client';

import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type JSX, type ReactNode } from 'react';
import { fetchMe, logout as logoutRequest, type MeResponse } from '@/lib/auth';

interface AuthContextValue {
  me: MeResponse;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used inside the protected layout');
  }
  return context;
}

/**
 * Gates every page under the protected layout: fetches /auth/me once on
 * mount and redirects to /login if that fails. `apiFetch` has already
 * tried a silent refresh by the time a 401 surfaces here, so reaching the
 * catch branch means the session is genuinely gone (step 0.3 req. I).
 */
export function AuthProvider({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}): JSX.Element {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchMe()
      .then((result) => {
        if (!cancelled) {
          setMe(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          router.replace('/login');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  const logout = useCallback(async () => {
    await logoutRequest().catch(() => undefined);
    router.replace('/login');
  }, [router]);

  if (me === null) {
    return <>{fallback}</>;
  }

  return <AuthContext.Provider value={{ me, logout }}>{children}</AuthContext.Provider>;
}
