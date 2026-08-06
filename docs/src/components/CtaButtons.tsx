import Link from '@docusaurus/Link';

import { PixelIcon, type PixelIconComponent } from './PixelIcon';
import styles from './CtaButtons.module.css';

export type CtaVariant = 'primary' | 'secondary';

export type CtaButtonData = {
  icon: PixelIconComponent;
  label: string;
  to: string;
  variant: CtaVariant;
};

const variantClasses: Record<CtaVariant, string> = {
  primary: 'button button--primary',
  secondary: 'button button--outline button--secondary',
};

export function CtaButton(
  { icon, label, to, variant }: CtaButtonData,
) {
  return (
    <Link
      className={`${styles.button} ${variantClasses[variant]}`}
      to={to}
    >
      {label}
      <PixelIcon icon={icon} />
    </Link>
  );
}

export function CtaButtons(
  { ctas, ariaLabel }: {
    ctas: readonly CtaButtonData[];
    ariaLabel: string;
  },
) {
  return (
    <div className={styles.buttons} role='group' aria-label={ariaLabel}>
      {ctas.map((cta) => <CtaButton key={cta.to} {...cta} />)}
    </div>
  );
}
