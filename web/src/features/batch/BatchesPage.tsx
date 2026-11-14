import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, queryKeys } from '../../shared/api/endpoints';
import { t } from '../../shared/i18n/pt-AO';
import { AppHeader } from '../../shared/ui/AppHeader';
import { Banner } from '../../shared/ui/Banner';
import { Button, LinkButton } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';
import { PhotoTile } from '../../shared/ui/PhotoTile';
import { allBatches, anyInProgress, groupByDay } from './batchesView';
import styles from './BatchesPage.module.css';

const PAGE_SIZE = 20;
const POLL_MS = 3000;

/** "Lotes": every batch still on the server, newest first, grouped by day (DECISOES.md, "Lotes"). */
export default function BatchesPage() {
  const [now] = useState(() => new Date());
  const list = useInfiniteQuery({
    queryKey: queryKeys.batches,
    queryFn: ({ pageParam, signal }) => api.batches({ limit: PAGE_SIZE, before: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    // Keep the "A processar" rows moving until their batches finish.
    refetchInterval: (query) => (anyInProgress(query.state.data) ? POLL_MS : false),
  });

  const batches = allBatches(list.data);
  const groups = groupByDay(batches, now);

  let content;
  if (list.isPending) {
    content = (
      <div className={styles.loading} role="status">
        <span className="visually-hidden">{t.common.loading}</span>
      </div>
    );
  } else if (list.isError && !list.data) {
    content = (
      <div className={styles.state}>
        <Banner tone="error" icon="info" title={t.batches.loadFailed} />
        <Button variant="outline" icon="refresh" onClick={() => void list.refetch()}>
          {t.batches.tryAgain}
        </Button>
      </div>
    );
  } else if (batches.length === 0) {
    content = (
      <div className={styles.empty}>
        <Icon name="stack" size={36} strokeWidth={1.2} />
        <div className={styles.emptyText}>
          <p>{t.batches.emptyTitle}</p>
          <p>{t.batches.emptyBody}</p>
        </div>
        <LinkButton to="/estudio" icon="plus" className={styles.emptyButton}>
          {t.batches.newBatch}
        </LinkButton>
      </div>
    );
  } else {
    content = (
      <>
        <div className={styles.groups} aria-label={t.batches.listLabel} role="region">
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`dia-${group.key}`}>
              <h2 id={`dia-${group.key}`} className={styles.day}>
                {group.label}
              </h2>
              <ul className={styles.list}>
                {group.rows.map((row) => (
                  <li key={row.id}>
                    <Link to={`/estudio/lotes/${row.id}`} state={{ fromList: true }} className={styles.row}>
                      <PhotoTile
                        small
                        src={row.cover.src}
                        alt=""
                        state={row.cover.state}
                        className={styles.cover}
                      />
                      <span className={styles.text}>
                        <span className={styles.line1}>{row.line1}</span>
                        <span className={styles.price}>{row.price}</span>
                        <span className={styles.meta}>
                          {row.meta}
                          {row.status ? (
                            <>
                              {' · '}
                              <span className={row.status.tone === 'error' ? styles.error : styles.progress}>
                                {row.status.text}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </span>
                      <Icon name="chevronRight" size={20} className={styles.chevron} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        {list.isFetchNextPageError ? (
          <Banner tone="error" icon="info" title={t.batches.loadFailed} className={styles.moreError} />
        ) : null}
        {list.hasNextPage ? (
          <div className={styles.more}>
            <Button
              variant="outline"
              block
              busy={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {t.batches.more}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className={styles.page}>
      <AppHeader>
        <LinkButton to="/estudio" variant="outlineSmall" icon="plus" iconSize={16}>
          {t.batches.newBatch}
        </LinkButton>
      </AppHeader>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>{t.batches.eyebrow}</p>
        <h1 className={styles.title}>{t.batches.title}</h1>
      </div>
      {content}
    </div>
  );
}
