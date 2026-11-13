import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '../api/endpoints';
import type { Connection } from '../ui/ConnectionPill';

export const HEALTH_INTERVAL_MS = 10_000;

/** "Ligado"/"Desligado" from GET /api/health every 10 s (SPEC 11.3). */
export function useConnection(): { status: Connection; recheck: () => void; checking: boolean } {
  const query = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => api.health(),
    refetchInterval: HEALTH_INTERVAL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
  const status: Connection = query.isError ? 'offline' : query.isSuccess ? 'online' : 'unknown';
  return {
    status,
    recheck: () => void query.refetch(),
    checking: query.isFetching,
  };
}
