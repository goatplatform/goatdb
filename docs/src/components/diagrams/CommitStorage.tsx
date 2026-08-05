import React from 'react';
import Diagram from '../Diagram';
import styles from './CommitStorage.module.css';

const commits = [
  { name: 'Commit A', id: 'abc123' },
  { name: 'Commit B', id: 'def456' },
  { name: 'Commit C', id: 'ghi789' },
  { name: 'Commit D', id: 'jkl012' },
] as const;

const boxX = (i: number) => 60 + i * 150;

// Vertical flow: commit row -> primary arrows -> local age row. Bare columns,
// no region or caption container rects.
export default function CommitStorage() {
  return (
    <Diagram>
      <svg
        width='720'
        height='330'
        viewBox='0 0 720 330'
        xmlns='http://www.w3.org/2000/svg'
      >
        <defs>
          <marker
            id='csArrow'
            markerWidth='10'
            markerHeight='7'
            refX='9'
            refY='3.5'
            orient='auto'
          >
            <polygon points='0 0, 10 3.5, 0 7' className={styles.arrowHead} />
          </marker>
        </defs>

        <text x='60' y='35' className={styles.caption}>
          Commit Timeline
        </text>

        {commits.map((commit, i) => (
          <g key={commit.id} transform={`translate(${boxX(i)}, 55)`}>
            <rect x='0' y='0' width='120' height='60' className={styles.box} />
            <text
              x='60'
              y='28'
              className={styles.boxTitle}
              textAnchor='middle'
            >
              {commit.name}
            </text>
            <text x='60' y='48' className={styles.label} textAnchor='middle'>
              id: {commit.id}
            </text>
          </g>
        ))}

        {commits.map((commit, i) => (
          <path
            key={commit.id}
            d={`M ${boxX(i) + 60} 115 L ${boxX(i) + 60} 150`}
            className={styles.arrow}
            markerEnd='url(#csArrow)'
          />
        ))}

        <text x='60' y='180' className={styles.caption}>
          Local Age
        </text>

        {commits.map((commit, i) => (
          <g key={commit.id} transform={`translate(${boxX(i)}, 195)`}>
            <rect
              x='0'
              y='0'
              width='120'
              height='40'
              className={styles.boxNeutral}
            />
            <text x='60' y='26' className={styles.label} textAnchor='middle'>
              age: {i + 1}
            </text>
          </g>
        ))}

        {/* Bare caption (no caption-box chrome) */}
        <text x='60' y='285' className={styles.caption}>
          Local Age Tracking
        </text>
        <text x='60' y='310' className={styles.body}>
          Sequential numbers track commit order • never synchronized • enables
          fast incremental updates
        </text>
      </svg>
    </Diagram>
  );
}
