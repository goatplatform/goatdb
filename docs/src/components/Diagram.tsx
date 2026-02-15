import React from 'react';
import styles from './Diagram.module.css';

type DiagramProps = {
  children: React.ReactNode;
  title?: string;
};

export default function Diagram({ children, title }: DiagramProps) {
  return (
    <div className={styles.diagramContainer}>
      {title && <div className={styles.diagramTitle}>{title}</div>}
      <div className={styles.diagramContent}>
        {children}
      </div>
    </div>
  );
}
