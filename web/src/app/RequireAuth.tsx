import { useQuery } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation } from 'react-router';
import { isApiError } from '../shared/api/client';
import { api, queryKeys } from '../shared/api/endpoints';
import { t } from '../shared/i18n/pt-AO';
import styles from './App.module.css';

/** Protected routes need a valid session (`me`). On 401, go to /entrar?next=... (SPEC 11.1). */
export function RequireAuth() {
  const location = useLocation();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me, retry: false, staleTime: 60_000 });

  if (me.isPending) {
    return (
      <div className={styles.splash} role="status">
        <span className="visually-hidden">{t.common.loading}</span>
      </div>
    );
  }
  if (me.isError && isApiError(me.error) && me.error.status === 401) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/entrar?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}
