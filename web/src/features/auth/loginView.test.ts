import { describe, expect, it } from 'vitest';
import { loginView, safeNext, type LoginInput } from './loginView';

const base: LoginInput = {
  key: '',
  focused: false,
  connection: 'online',
  checking: false,
  rejectedKey: null,
  remainingAttempts: null,
  lockSecondsLeft: 0,
  mode: 'lan',
};
const key = (n: number) => 'k'.repeat(n);

describe('loginView (FRONTEND-SPEC, seven states of Entrada)', () => {
  it('vazio: 0/32, help text, Entrar disabled', () => {
    const view = loginView(base);
    expect(view.state).toBe('vazio');
    expect(view.helper).toBe('Pede a chave a quem instalou o estúdio.');
    expect(view.button).toEqual({ label: 'Entrar', disabled: true, busy: false });
    expect(view.fieldTone).toBe('normal');
  });

  it('a escrever: champagne border and characters left', () => {
    const view = loginView({ ...base, key: key(18), focused: true });
    expect(view.state).toBe('escrever');
    expect(view.fieldTone).toBe('focus');
    expect(view.helper).toBe('Faltam 14 caracteres.');
    expect(view.button.disabled).toBe(true);
    expect(loginView({ ...base, key: key(31), focused: true }).helper).toBe('Falta 1 caracter.');
  });

  it('chave incompleta: coral border once the field loses focus', () => {
    const view = loginView({ ...base, key: key(26) });
    expect(view.state).toBe('incompleta');
    expect(view.fieldTone).toBe('error');
    expect(view.helper).toBe('A chave tem 32 caracteres. Esta tem 26.');
    expect(view.helperIsError).toBe(true);
    expect(view.button.disabled).toBe(true);
  });

  it('completa: Entrar enabled with 32 characters', () => {
    const view = loginView({ ...base, key: key(32) });
    expect(view.state).toBe('completa');
    expect(view.counterTone).toBe('accent');
    expect(view.button.disabled).toBe(false);
  });

  it('only base62 characters', () => {
    const view = loginView({ ...base, key: `${key(31)}-` });
    expect(view.state).toBe('invalida');
    expect(view.button.disabled).toBe(true);
  });

  it('chave errada: coral, attempts left when 3 or fewer, Entrar enabled', () => {
    const rejected = key(32);
    const view = loginView({ ...base, key: rejected, rejectedKey: rejected, remainingAttempts: 2 });
    expect(view.state).toBe('errada');
    expect(view.helper).toBe('Chave errada. Restam 2 tentativas.');
    expect(view.button.disabled).toBe(false);
    expect(loginView({ ...base, key: rejected, rejectedKey: rejected, remainingAttempts: 1 }).helper).toBe(
      'Chave errada. Resta 1 tentativa.',
    );
    expect(loginView({ ...base, key: rejected, rejectedKey: rejected, remainingAttempts: 8 }).helper).toBe(
      'Chave errada.',
    );
  });

  it('typing after a wrong key leaves the wrong state', () => {
    const view = loginView({
      ...base,
      key: key(31),
      focused: true,
      rejectedKey: key(32),
      remainingAttempts: 2,
    });
    expect(view.state).toBe('escrever');
  });

  it('muitas tentativas: locked field, countdown in the button', () => {
    const view = loginView({ ...base, key: key(32), lockSecondsLeft: 299 });
    expect(view.state).toBe('bloqueada');
    expect(view.fieldDisabled).toBe(true);
    expect(view.lockCountdown).toBe('4:59');
    expect(view.button).toEqual({ label: 'Tenta em 4:59', disabled: true, busy: false });
  });

  it('a verificar: busy button and the home computer message', () => {
    const view = loginView({ ...base, key: key(32), checking: true });
    expect(view.state).toBe('verificar');
    expect(view.button).toEqual({ label: 'A verificar', disabled: true, busy: true });
    expect(view.helper).toBe('A confirmar com o computador de casa.');
    expect(loginView({ ...base, key: key(32), checking: true, mode: 'public' }).helper).toBe(
      'A confirmar a chave.',
    );
  });

  it('computador fora de alcance: Desligado, Entrar disabled', () => {
    const view = loginView({ ...base, key: key(32), connection: 'offline' });
    expect(view.state).toBe('desligado');
    expect(view.offline).toBe(true);
    expect(view.pill).toBe('offline');
    expect(view.button.disabled).toBe(true);
  });
});

describe('safeNext', () => {
  it.each([
    [null, '/estudio'],
    ['/estudio', '/estudio'],
    ['/estudio/lotes/abc?x=1', '/estudio/lotes/abc?x=1'],
    ['/estudiox', '/estudio'],
    ['/', '/estudio'],
    ['//evil.example/estudio', '/estudio'],
    ['https://evil.example/estudio', '/estudio'],
    ['/estudio/../entrar', '/estudio'],
    ['/estudio\\evil', '/estudio'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNext(input)).toBe(expected);
  });
});
