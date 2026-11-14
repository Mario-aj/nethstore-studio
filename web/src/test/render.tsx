import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, parsePath, Route, Routes, useLocation } from 'react-router';

export function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

/** Renders `element` at `path` (with optional history `state`) inside a fresh QueryClient and an in-memory router. */
export function renderAt(
  element: ReactElement,
  { path = '/', route = '*', state }: { path?: string; route?: string; state?: unknown } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[state === undefined ? path : { ...parsePath(path), state }]}>
        <Routes>
          <Route path={route} element={element} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
