import React from 'react';
import styles from '../diagrams.module.css';

interface NodeProps {
  type: 'circle' | 'square' | 'diamond';
  label: string;
  status?: 'active' | 'inactive' | 'processing' | 'error';
  size?: 'small' | 'medium' | 'large';
  className?: string;
  onClick?: () => void;
}

export default function Node({ 
  type, 
  label, 
  status = 'active',
  size = 'medium',
  className = '',
  onClick
}: NodeProps) {
  return (
    <div 
      className={`${styles.node} ${styles[`node--${type}`]} ${styles[`node--${status}`]} ${styles[`node--${size}`]} ${className}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={`${label} (${status})`}
    >
      <span className={styles.nodeLabel}>{label}</span>
    </div>
  );
}