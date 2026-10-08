'use client';

import { useEffect, useState, type JSX } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface ReadinessResponse {
  status: 'ok' | 'error';
  dependencies: {
    db: 'ok' | 'error';
    redis: 'ok' | 'error';
  };
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details: unknown;
    request_id: string;
  };
}

type CheckState =
  | { phase: 'loading' }
  | { phase: 'success'; data: ReadinessResponse }
  | { phase: 'failure'; message: string };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function HomePage(): JSX.Element {
  const [state, setState] = useState<CheckState>({ phase: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function checkReadiness(): Promise<void> {
      try {
        const res = await fetch(`${API_URL}/api/v1/health/ready`, { cache: 'no-store' });
        const body = (await res.json()) as ReadinessResponse | ErrorResponse;

        if (cancelled) return;

        if ('error' in body) {
          setState({ phase: 'failure', message: body.error.message });
        } else {
          setState({ phase: 'success', data: body });
        }
      } catch {
        if (!cancelled) {
          setState({ phase: 'failure', message: 'Unable to reach API' });
        }
      }
    }

    void checkReadiness();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>EduCRM</CardTitle>
          <CardDescription>API readiness check</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {state.phase === 'loading' && <Badge variant="outline">Checking...</Badge>}

          {state.phase === 'failure' && (
            <div className="flex flex-col gap-1">
              <Badge variant="destructive">Unavailable</Badge>
              <p className="text-sm text-muted-foreground">{state.message}</p>
            </div>
          )}

          {state.phase === 'success' && (
            <div className="flex flex-col gap-2">
              <Badge variant={state.data.status === 'ok' ? 'success' : 'destructive'}>
                {state.data.status}
              </Badge>
              <div className="flex gap-4 text-sm">
                <span>
                  db: <strong>{state.data.dependencies.db}</strong>
                </span>
                <span>
                  redis: <strong>{state.data.dependencies.redis}</strong>
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
