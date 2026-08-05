import React from 'react';
import Diagram from '../Diagram';
import styles from './IncrementalUpdates.module.css';

const ages = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const lastProcessed = 5;

const commitX = (i: number) => 30 + i * 75;

// Vertical flow: commit timeline (muted = already processed, primary = new)
// -> primary arrow -> query update box. Bare layout, no region/caption rects.
export default function IncrementalUpdates() {
  return (
    <Diagram>
      <svg
        width='720'
        height='325'
        viewBox='0 0 720 325'
        xmlns='http://www.w3.org/2000/svg'
      >
        <defs>
          <marker
            id='iuArrow'
            markerWidth='10'
            markerHeight='7'
            refX='9'
            refY='3.5'
            orient='auto'
          >
            <polygon points='0 0, 10 3.5, 0 7' className={styles.arrowHead} />
          </marker>
        </defs>

        <text x='30' y='30' className={styles.caption}>
          Commit Timeline
        </text>
        <text x='397' y='30' className={styles.caption} textAnchor='middle'>
          Last Processed
        </text>

        {ages.map((age, i) => {
          const isNew = age > lastProcessed;
          return (
            <g key={age} transform={`translate(${commitX(i)}, 42)`}>
              <rect
                x='0'
                y='0'
                width='60'
                height='40'
                className={isNew ? styles.commitNew : styles.commitOld}
              />
              <text
                x='30'
                y='25'
                className={isNew ? styles.label : styles.labelMuted}
                textAnchor='middle'
              >
                age {age}
              </text>
            </g>
          );
        })}

        {/* "Last processed" boundary: solid 2px line (no dashes). */}
        <line
          x1='397'
          y1='38'
          x2='397'
          y2='86'
          className={styles.markerLine}
        />

        {/* Process arrow */}
        <path
          d='M 510 100 L 510 140'
          className={styles.arrow}
          markerEnd='url(#iuArrow)'
        />
        <text x='525' y='125' className={styles.label}>
          skip 1-5, process 6-8
        </text>

        {/* Query update box */}
        <rect
          x='360'
          y='155'
          width='300'
          height='75'
          className={styles.box}
        />
        <text x='380' y='182' className={styles.caption}>
          Query Update
        </text>
        <text x='380' y='207' className={styles.label}>
          resume from age 6 • process commits 6-8
        </text>

        {/* Bare caption (no caption-box chrome) */}
        <text x='30' y='280' className={styles.caption}>
          Incremental Updates
        </text>
        <text x='30' y='305' className={styles.body}>
          Skip old commits • Process only new changes • Much faster than a full
          scan
        </text>
      </svg>
    </Diagram>
  );
}
