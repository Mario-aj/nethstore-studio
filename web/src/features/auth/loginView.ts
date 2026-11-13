// Pure derivation of the Entrada screen from its inputs (FRONTEND-SPEC, table of
// the seven states). Kept out of the component so every state is unit tested.

import { formatCountdown } from '../../shared/lib/format';
import { deployText, t, type DeployMode } from '../../shared/i18n/pt-AO';
import type { Connection } from '../../shared/ui/ConnectionPill';

export const KEY_LENGTH = 32;
const BASE62 = /^[0-9A-Za-z]*$/;

export interface LoginInput {
  key: string;
  focused: boolean;
  connection: Connection;
  checking: boolean;
  /** The exact key the API rejected; the "wrong" state lasts while the field still holds it. */
  rejectedKey: string | null;
  remainingAttempts: number | null;
  lockSecondsLeft: number;
  mode: DeployMode;
}

export type LoginState =
  | 'vazio'
  | 'escrever'
  | 'incompleta'
  | 'completa'
  | 'invalida'
  | 'errada'
  | 'bloqueada'
  | 'verificar'
  | 'desligado';

export interface LoginView {
  state: LoginState;
  fieldTone: 'normal' | 'focus' | 'error' | 'locked';
  fieldDisabled: boolean;
  helper: string;
  helperIsError: boolean;
  counterTone: 'muted' | 'accent' | 'error';
  button: { label: string; disabled: boolean; busy: boolean };
  lockCountdown: string | null;
  offline: boolean;
  pill: Connection;
}

export function loginView(input: LoginInput): LoginView {
  const n = input.key.length;
  const text = deployText(input.mode);
  const counterDefault = n === KEY_LENGTH ? 'accent' : 'muted';
  const enter = (disabled: boolean) => ({ label: t.login.enter, disabled, busy: false });
  const base = { lockCountdown: null, offline: false, pill: input.connection };

  if (input.checking) {
    return {
      ...base,
      state: 'verificar',
      fieldTone: 'locked',
      fieldDisabled: true,
      helper: text.loginChecking,
      helperIsError: false,
      counterTone: counterDefault,
      button: { label: t.login.checking, disabled: true, busy: true },
    };
  }

  if (input.lockSecondsLeft > 0) {
    const countdown = formatCountdown(input.lockSecondsLeft);
    return {
      ...base,
      state: 'bloqueada',
      fieldTone: 'locked',
      fieldDisabled: true,
      helper: '',
      helperIsError: false,
      counterTone: 'muted',
      button: { label: t.login.lockedButton(countdown), disabled: true, busy: false },
      lockCountdown: countdown,
    };
  }

  if (input.connection === 'offline') {
    return {
      ...base,
      state: 'desligado',
      fieldTone: input.focused ? 'focus' : 'normal',
      fieldDisabled: false,
      helper: '',
      helperIsError: false,
      counterTone: counterDefault,
      button: enter(true),
      offline: true,
    };
  }

  if (input.rejectedKey !== null && input.key === input.rejectedKey) {
    const remaining = input.remainingAttempts;
    return {
      ...base,
      state: 'errada',
      fieldTone: 'error',
      fieldDisabled: false,
      helper:
        remaining !== null && remaining <= 3 ? t.login.helperWrongRemaining(remaining) : t.login.helperWrong,
      helperIsError: true,
      counterTone: 'error',
      button: enter(false),
    };
  }

  if (!BASE62.test(input.key)) {
    return {
      ...base,
      state: 'invalida',
      fieldTone: 'error',
      fieldDisabled: false,
      helper: t.login.helperInvalidChars,
      helperIsError: true,
      counterTone: 'error',
      button: enter(true),
    };
  }

  if (n === 0) {
    return {
      ...base,
      state: 'vazio',
      fieldTone: input.focused ? 'focus' : 'normal',
      fieldDisabled: false,
      helper: t.login.helperEmpty,
      helperIsError: false,
      counterTone: 'muted',
      button: enter(true),
    };
  }

  if (n < KEY_LENGTH) {
    if (input.focused) {
      return {
        ...base,
        state: 'escrever',
        fieldTone: 'focus',
        fieldDisabled: false,
        helper: t.login.helperTyping(KEY_LENGTH - n),
        helperIsError: false,
        counterTone: 'muted',
        button: enter(true),
      };
    }
    return {
      ...base,
      state: 'incompleta',
      fieldTone: 'error',
      fieldDisabled: false,
      helper: t.login.helperIncomplete(n),
      helperIsError: true,
      counterTone: 'error',
      button: enter(true),
    };
  }

  return {
    ...base,
    state: 'completa',
    fieldTone: input.focused ? 'focus' : 'normal',
    fieldDisabled: false,
    helper: '',
    helperIsError: false,
    counterTone: 'accent',
    button: enter(false),
  };
}

/** Only internal studio paths are accepted as a post-login destination (SPEC 11.1). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/estudio')) return '/estudio';
  if (next.includes('\\') || /[\r\n\t]/.test(next)) return '/estudio';
  try {
    const url = new URL(next, 'https://estudio.invalid');
    const internal = url.origin === 'https://estudio.invalid';
    if (!internal || !(url.pathname === '/estudio' || url.pathname.startsWith('/estudio/')))
      return '/estudio';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/estudio';
  }
}
