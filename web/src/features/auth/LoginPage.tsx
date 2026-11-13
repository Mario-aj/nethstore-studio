import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import beige480 from '../../assets/photos/beige-dress-480.webp';
import beige800 from '../../assets/photos/beige-dress-800.webp';
import beige1200 from '../../assets/photos/beige-dress-1200.webp';
import { isApiError } from '../../shared/api/client';
import { api, queryKeys } from '../../shared/api/endpoints';
import { useDeployMode } from '../../shared/hooks/useAppConfig';
import { useConnection } from '../../shared/hooks/useConnection';
import { useCountdown } from '../../shared/hooks/useNow';
import { deployText, errorMessage, t } from '../../shared/i18n/pt-AO';
import { Banner } from '../../shared/ui/Banner';
import { Button } from '../../shared/ui/Button';
import { ConnectionPill } from '../../shared/ui/ConnectionPill';
import { Icon, StatusIcon } from '../../shared/ui/Icon';
import { KEY_LENGTH, loginView, safeNext } from './loginView';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const mode = useDeployMode();
  const connection = useConnection();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: api.me, retry: false, staleTime: 60_000 });

  const inputId = useId();
  const helperId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState('');
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [rejectedKey, setRejectedKey] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [pasteFailed, setPasteFailed] = useState(false);
  const [otherError, setOtherError] = useState<string | null>(null);

  const lockSecondsLeft = useCountdown(lockedUntil);

  const login = useMutation({
    mutationFn: (secret: string) => api.login(secret),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void navigate(next, { replace: true });
    },
    onError: (error, secret) => {
      if (!isApiError(error)) {
        setOtherError(t.errors.unknown);
        return;
      }
      if (error.code === 'invalid_secret') {
        setRejectedKey(secret);
        setRemaining(error.details.remainingAttempts ?? null);
      } else if (error.code === 'too_many_attempts') {
        const seconds = error.details.retryAfterSeconds ?? 60;
        setLockedUntil(Date.now() + seconds * 1000);
      } else if (error.isNetwork) {
        connection.recheck();
      } else {
        setOtherError(errorMessage(error.code));
      }
    },
  });

  const view = loginView({
    key,
    focused,
    connection: connection.status,
    checking: login.isPending,
    rejectedKey,
    remainingAttempts: remaining,
    lockSecondsLeft,
    mode,
  });
  const text = deployText(mode);

  if (me.isSuccess) return <Navigate to={next} replace />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (view.button.disabled || key.length !== KEY_LENGTH) return;
    setOtherError(null);
    login.mutate(key);
  };

  const paste = async () => {
    setPasteFailed(false);
    try {
      const text = await navigator.clipboard.readText();
      setKey(text.replace(/\s+/g, '').slice(0, KEY_LENGTH));
      inputRef.current?.focus();
    } catch {
      setPasteFailed(true);
      inputRef.current?.focus();
    }
  };

  const helper = pasteFailed ? t.login.pasteFailed : (otherError ?? view.helper);
  const helperIsError = otherError !== null || view.helperIsError;

  return (
    <div className={styles.page}>
      <img
        className={styles.photo}
        src={beige800}
        srcSet={`${beige480} 480w, ${beige800} 800w, ${beige1200} 1200w`}
        sizes="(min-width: 560px) 560px, 100vw"
        alt=""
        fetchPriority="high"
      />
      <div className={styles.fade} aria-hidden="true" />

      <header className={styles.header}>
        <Link to="/" className={styles.brand}>
          {t.brand}
        </Link>
        <ConnectionPill status={view.pill} />
      </header>

      <main className={styles.main}>
        {view.offline ? (
          <Banner tone="error" icon="wifiOff" title={text.loginOfflineTitle}>
            {text.loginOfflineBody}
          </Banner>
        ) : null}

        <div className={styles.intro}>
          <h1 className={styles.title}>{t.login.title}</h1>
          <p className={styles.subtitle}>{t.login.subtitle}</p>
        </div>

        <form className={styles.form} onSubmit={submit} noValidate>
          <div className={styles.fieldGroup}>
            <label htmlFor={inputId} className={styles.label}>
              {t.login.label}
            </label>
            <div className={`${styles.field} ${styles[view.fieldTone]}`}>
              <input
                ref={inputRef}
                id={inputId}
                className={styles.input}
                type={reveal ? 'text' : 'password'}
                name="password"
                value={key}
                placeholder={t.login.placeholder}
                maxLength={KEY_LENGTH}
                autoComplete="current-password"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={view.fieldDisabled}
                aria-invalid={view.helperIsError || undefined}
                aria-describedby={helperId}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onChange={(event) => {
                  setPasteFailed(false);
                  setOtherError(null);
                  setKey(event.target.value.replace(/\s+/g, '').slice(0, KEY_LENGTH));
                }}
              />
              <Button
                variant="iconOnly"
                className={styles.eye}
                aria-label={reveal ? t.login.hide : t.login.show}
                aria-pressed={reveal}
                disabled={view.fieldDisabled}
                onClick={() => setReveal((value) => !value)}
              >
                <Icon name={reveal ? 'eyeOff' : 'eye'} size={20} />
              </Button>
              <button
                type="button"
                className={styles.paste}
                disabled={view.fieldDisabled}
                onClick={() => void paste()}
              >
                {t.login.paste}
              </button>
            </div>
            <div className={styles.helperRow}>
              <span
                id={helperId}
                className={`${styles.helper} ${helperIsError ? styles.helperError : ''}`}
                aria-live="polite"
              >
                {helperIsError && helper ? <StatusIcon kind="error" size={16} /> : null}
                {helper}
              </span>
              <span
                className={[
                  styles.counter,
                  view.counterTone === 'accent' ? styles.counterAccent : null,
                  view.counterTone === 'error' ? styles.counterError : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-label={`${key.length} de ${KEY_LENGTH} caracteres`}
              >
                {key.length}/{KEY_LENGTH}
              </span>
            </div>
          </div>

          {view.lockCountdown ? (
            <Banner
              tone="error"
              icon="lock"
              title={t.login.lockedTitle}
              trailing={<span className={styles.countdown}>{view.lockCountdown}</span>}
            >
              {t.login.lockedBody}
            </Banner>
          ) : null}

          <div className={styles.actions}>
            <Button type="submit" block disabled={view.button.disabled} busy={view.button.busy}>
              {view.button.label}
            </Button>
            {view.offline ? (
              <Button
                variant="outlineMd"
                block
                icon="refresh"
                busy={connection.checking}
                onClick={connection.recheck}
              >
                {t.login.reconnect}
              </Button>
            ) : null}
            <p className={styles.remember}>{t.login.remember}</p>
          </div>
        </form>
      </main>
    </div>
  );
}
