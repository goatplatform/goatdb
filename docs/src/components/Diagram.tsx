import React from 'react';
import styles from './Diagram.module.css';

type DiagramProps = {
  children: React.ReactNode;
  title?: string;
  wide?: boolean;
};

function DiagramContent({ children, title, wide }: DiagramProps) {
  const className = wide
    ? `${styles.diagramContent} ${styles.diagramContentWide}`
    : styles.diagramContent;
  return (
    <div
      className={className}
      role={wide ? 'region' : undefined}
      aria-label={wide ? title ?? 'Scrollable diagram' : undefined}
      tabIndex={wide ? 0 : undefined}
    >
      {children}
    </div>
  );
}

export default function Diagram(props: DiagramProps) {
  return (
    <div className={styles.diagramContainer}>
      {props.title && <div className={styles.diagramTitle}>{props.title}</div>}
      <DiagramContent {...props} />
      {props.wide && (
        <div className={styles.scrollHint}>Scroll horizontally if needed</div>
      )}
    </div>
  );
}
