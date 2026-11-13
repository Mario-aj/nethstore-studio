import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { Icon, Spinner, type IconName } from './Icon';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'outline' | 'outlineMd' | 'outlineSmall' | 'text' | 'iconOnly';

interface CommonProps {
  variant?: ButtonVariant;
  icon?: IconName;
  iconAfter?: IconName;
  iconSize?: number;
  block?: boolean;
  children?: ReactNode;
}

export function buttonClassName(variant: ButtonVariant, block = false, extra?: string): string {
  return [styles.button, styles[variant], block ? styles.block : null, extra].filter(Boolean).join(' ');
}

interface ButtonProps extends CommonProps, ButtonHTMLAttributes<HTMLButtonElement> {
  busy?: boolean;
}

export function Button({
  variant = 'primary',
  icon,
  iconAfter,
  iconSize = 18,
  block = false,
  busy = false,
  className,
  children,
  type = 'button',
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName(variant, block, className)}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? (
        <Spinner onAccent={variant === 'primary'} />
      ) : icon ? (
        <Icon name={icon} size={iconSize} strokeWidth={1.6} />
      ) : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} size={iconSize} strokeWidth={1.6} /> : null}
    </button>
  );
}

interface LinkButtonProps extends CommonProps, Omit<LinkProps, 'className' | 'children'> {
  className?: string;
}

export function LinkButton({
  variant = 'primary',
  icon,
  iconAfter,
  iconSize = 18,
  block = false,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link className={buttonClassName(variant, block, className)} {...rest}>
      {icon ? <Icon name={icon} size={iconSize} strokeWidth={1.6} /> : null}
      {children}
      {iconAfter ? <Icon name={iconAfter} size={iconSize} strokeWidth={1.6} /> : null}
    </Link>
  );
}
