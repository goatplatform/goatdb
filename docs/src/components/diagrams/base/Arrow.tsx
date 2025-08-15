import React from 'react';
import styles from '../diagrams.module.css';

interface ArrowProps {
  direction?: 'horizontal' | 'vertical' | 'bidirectional';
  animated?: boolean;
  label?: string;
  className?: string;
}

export default function Arrow({ 
  direction = 'horizontal', 
  animated = false,
  label,
  className = ''
}: ArrowProps) {
  return (
    <div 
      className={`${styles.arrow} ${styles[`arrow--${direction}`]} ${animated ? styles['arrow--animated'] : ''} ${className}`}
      aria-hidden="true"
    >
      <svg 
        viewBox="0 0 100 40" 
        preserveAspectRatio="none"
        className={styles.arrowSvg}
      >
        {direction === 'bidirectional' ? (
          <>
            <line x1="10" y1="20" x2="90" y2="20" strokeWidth="2" stroke="currentColor" />
            <polygon points="5,20 15,15 15,25" fill="currentColor" />
            <polygon points="95,20 85,15 85,25" fill="currentColor" />
          </>
        ) : (
          <>
            <line x1="0" y1="20" x2="85" y2="20" strokeWidth="2" stroke="currentColor" />
            <polygon points="100,20 85,15 85,25" fill="currentColor" />
          </>
        )}
      </svg>
      {label && <span className={styles.arrowLabel}>{label}</span>}
    </div>
  );
}