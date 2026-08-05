import React from 'react';
import { ArrowRight } from 'pixelarticons/react';

import { HomepageIcon } from '../HomepageIcon';
import styles from './ComparisonSplitSimple.module.css';

type Complexity = 'low' | 'medium' | 'high';

interface ComparisonProps {
  title: string;
  traditional: {
    label: string;
    items: string[];
    complexity: Complexity;
  };
  goatdb: {
    label: string;
    items: string[];
    complexity: Complexity;
  };
}

// Infima rainbow is banned in diagrams: complexity maps to the neutral
// emphasis scale, with primary reserved for the GoatDB-side 'low'.
const badgeClass: Record<Complexity, string> = {
  high: styles.badgeHigh,
  medium: styles.badgeMedium,
  low: styles.badgeLow,
};

function Panel(
  { label, items, complexity, hero = false }: ComparisonProps['traditional'] & {
    hero?: boolean;
  },
) {
  return (
    <article className={hero ? styles.panelHero : styles.panel}>
      <header className={styles.panelHeader}>
        <p className={styles.panelCaption}>{label}</p>
        <span className={`${styles.badge} ${badgeClass[complexity]}`}>
          Complexity: {complexity}
        </span>
      </header>
      <ul className={styles.items}>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </article>
  );
}

// Bare two-panel pattern (caption + content | pixel arrow | caption + content)
// matching StackCollapse. The GoatDB panel is the hero: primary stroke + hard
// offset shadow; the traditional panel stays neutral.
export default function ComparisonSplitSimple(
  { title, traditional, goatdb }: ComparisonProps,
) {
  return (
    <div className={styles.figure} aria-label={`${title} comparison`}>
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.panels}>
        <Panel {...traditional} />
        <div className={styles.connector} aria-hidden='true'>
          <HomepageIcon icon={ArrowRight} />
        </div>
        <Panel {...goatdb} hero />
      </div>

      {/* SEO description */}
      <div className={styles.srOnly}>
        Comparison of {title}{' '}
        between traditional approach and GoatDB approach. Traditional approach
        has {traditional.complexity} complexity with challenges including{' '}
        {traditional.items.join(', ')}. GoatDB approach has {goatdb.complexity}
        {' '}
        complexity with benefits including {goatdb.items.join(', ')}.
      </div>
    </div>
  );
}
