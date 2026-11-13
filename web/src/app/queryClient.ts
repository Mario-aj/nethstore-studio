import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { isApiError } from '../shared/api/client';
import { queryKeys } from '../shared/api/endpoints';

function sessionEnded(error: unknown) {
  // A protected call that answers 401 means the session ended (revoked or expired):
  // re-run `me` so the route guard sends the user to /entrar.
  if (isApiError(error) && error.code === 'unauthenticated') {
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // `me` answering 401 is how the guard learns there is no session; never loop on it.
      if (query.queryKey[0] !== queryKeys.me[0]) sessionEnded(error);
    },
  }),
  mutationCache: new MutationCache({ onError: (error) => sessionEnded(error) }),
  defaultOptions: {
    queries: {
      // Retry only when there was no answer or the server failed, never on 4xx.
      retry: (count, error) => isApiError(error) && (error.isNetwork || error.status >= 500) && count < 2,
      refetchOnWindowFocus: false,
      staleTime: 0,
    },
    mutations: { retry: false },
  },
});
