import React from 'react';
import styles from '../diagrams.module.css';

interface BoxProps {
  label: string;
  color?: 'primary' | 'secondary' | 'success' | 'danger' | 'info';
  size?: 'small' | 'medium' | 'large';
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export default function Box({ 
  label, 
  color = 'primary', 
  size = 'medium',
  children,
  className = '',
  onClick
}: BoxProps) {
  return (
    <div 
      className={`${styles.box} ${styles[`box--${color}`]} ${styles[`box--${size}`]} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={label}
    >
      <div className={styles.boxLabel}>{label}</div>
      {children && <div className={styles.boxContent}>{children}</div>}
    </div>
  );
}