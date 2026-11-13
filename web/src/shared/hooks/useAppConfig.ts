import { useQuery } from '@tanstack/react-query';
import { api, queryKeys } from '../api/endpoints';
import type { DeployMode } from '../i18n/pt-AO';

/** Deploy mode from GET /api/config. Falls back to `lan` (the design copy) until known. */
export function useDeployMode(): DeployMode {
  const { data } = useQuery({
    queryKey: queryKeys.config,
    queryFn: api.config,
    staleTime: Infinity,
    retry: 1,
  });
  return data?.deployMode ?? 'lan';
}
