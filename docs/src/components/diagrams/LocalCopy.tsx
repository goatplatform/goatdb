import React from 'react';
import Diagram from '../Diagram';
import styles from './LocalCopy.module.css';

function Peer({ x, caption }: { x: number; caption: string }) {
  return (
    <g transform={`translate(${x}, 0)`}>
      <text x='0' y='40' className={styles.caption}>
        {caption}
      </text>
      <rect x='0' y='55' width='200' height='90' className={styles.box} />
      <text x='100' y='95' className={styles.label} textAnchor='middle'>
        opened repository
      </text>
      <text x='100' y='115' className={styles.label} textAnchor='middle'>
        full replica
      </text>
    </g>
  );
}

// Two bare peer columns (no grouping rects) with a primary sync arrow pair.
export default function LocalCopy() {
  return (
    <Diagram>
      <svg
        width='720'
        height='260'
        viewBox='0 0 720 260'
        xmlns='http://www.w3.org/2000/svg'
      >
        <defs>
          <marker
            id='lcArrow'
            markerWidth='10'
            markerHeight='7'
            refX='9'
            refY='3.5'
            orient='auto'
          >
            <polygon points='0 0, 10 3.5, 0 7' className={styles.arrowHead} />
          </marker>
        </defs>

        <Peer x={60} caption='Peer 1' />
        <Peer x={460} caption='Peer 2' />

        {/* Sync arrows */}
        <text x='360' y='85' className={styles.caption} textAnchor='middle'>
          Sync
        </text>
        <path
          d='M 275 100 L 445 100'
          className={styles.arrow}
          markerEnd='url(#lcArrow)'
        />
        <path
          d='M 445 120 L 275 120'
          className={styles.arrow}
          markerEnd='url(#lcArrow)'
        />

        {/* Bare caption (no caption-box chrome) */}
        <text x='60' y='215' className={styles.caption}>
          Local-First
        </text>
        <text x='60' y='240' className={styles.body}>
          Local reads • Full offline mode • Instant queries
        </text>
      </svg>
    </Diagram>
  );
}
