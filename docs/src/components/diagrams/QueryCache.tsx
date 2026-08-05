import React from 'react';
import Diagram from '../Diagram';
import styles from './QueryCache.module.css';

const results = ['alice smith', 'bob johnson', 'carol davis'] as const;

// Two bare columns (query | cache) with a primary arrow between. The circle
// age badge becomes a filled square (blocky law).
export default function QueryCache() {
  return (
    <Diagram>
      <svg
        width='720'
        height='315'
        viewBox='0 0 720 315'
        xmlns='http://www.w3.org/2000/svg'
      >
        <defs>
          <marker
            id='qcArrow'
            markerWidth='10'
            markerHeight='7'
            refX='9'
            refY='3.5'
            orient='auto'
          >
            <polygon points='0 0, 10 3.5, 0 7' className={styles.arrowHead} />
          </marker>
        </defs>

        {/* Query column */}
        <text x='40' y='35' className={styles.caption}>
          Query: Active Users
        </text>
        <rect x='40' y='50' width='300' height='170' className={styles.box} />
        <text x='60' y='88' className={styles.label}>
          filter: active users only
        </text>
        <text x='60' y='118' className={styles.caption}>
          Results
        </text>
        {results.map((name, i) => (
          <g key={name} transform={`translate(60, ${134 + i * 20})`}>
            <rect x='0' y='0' width='6' height='6' className={styles.bullet} />
            <text x='14' y='7' className={styles.label}>
              {name}
            </text>
          </g>
        ))}

        {/* Arrow between columns */}
        <path
          d='M 345 135 L 375 135'
          className={styles.arrow}
          markerEnd='url(#qcArrow)'
        />

        {/* Cache column */}
        <text x='380' y='35' className={styles.caption}>
          Query Cache
        </text>
        <rect
          x='380'
          y='50'
          width='300'
          height='170'
          className={styles.boxPrimary}
        />
        <text x='400' y='88' className={styles.label}>
          cached: [alice, bob, carol]
        </text>
        <text x='400' y='130' className={styles.label}>
          last processed age
        </text>
        <rect x='620' y='111' width='26' height='26' className={styles.badge} />
        <text x='633' y='129' className={styles.badgeText} textAnchor='middle'>
          42
        </text>

        {/* Bare caption (no caption-box chrome) */}
        <text x='40' y='270' className={styles.caption}>
          Smart Caching
        </text>
        <text x='40' y='295' className={styles.body}>
          Stores results + last processed age - updates process only new
          commits (age &gt; 42)
        </text>
      </svg>
    </Diagram>
  );
}
