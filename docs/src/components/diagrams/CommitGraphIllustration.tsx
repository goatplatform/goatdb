import React from 'react';
import Diagram from '../Diagram';
import styles from './CommitGraphIllustration.module.css';

// Timeline Rail: one item's history on a single horizontal baseline --
// linear single-writer chain (v1-v3), then a concurrent branch (v4a/v4b)
// that converges into an automatic merge (v5) and continues (v6).
// All edges are orthogonal right-angle paths (diagonals banned). Identity
// icons sit on the branch nodes, replacing the old swatch legend. Merge
// node = filled primary square (primary = the GoatDB element).
export default function CommitGraphIllustration() {
  return (
    <Diagram>
      <svg
        width='720'
        height='264'
        viewBox='0 0 720 264'
        xmlns='http://www.w3.org/2000/svg'
        className={styles.rail}
      >
        <defs>
          <marker
            id='cgi-arrow'
            markerWidth='8'
            markerHeight='6'
            refX='7'
            refY='3'
            orient='auto'
          >
            <polygon
              points='0 0, 8 3, 0 6'
              fill='var(--ifm-color-primary)'
            />
          </marker>
        </defs>

        <text x='30' y='28' className={styles.heading}>
          Commit Graph Evolution
        </text>
        <text x='30' y='46' className={styles.mono}>
          /data/docs/team-roadmap
        </text>

        {/* Zone captions above the rail */}
        <text
          x='170'
          y='96'
          textAnchor='middle'
          className={styles.captionLabel}
        >
          Single Writer
        </text>
        <text
          x='518'
          y='96'
          textAnchor='middle'
          className={styles.captionLabel}
        >
          Concurrent Writers
        </text>

        {/* Balance law: EVERY horizontal edge segment is exactly 64px with
            a 2px gap at each node, and the split/converge paths are mirror
            images around the branch column (x=402). */}
        <path d='M96 164 H160' className={styles.edge} />
        <path d='M180 164 H244' className={styles.edge} />

        {/* Right-angle split from v3 up/down to the two branch rows.
            Trunk segment is drawn twice (same stroke, full overlap). */}
        <path d='M264 164 H328 V110 H392' className={styles.edge} />
        <path d='M264 164 H328 V218 H392' className={styles.edge} />

        {/* Right-angle convergence from both branches into the merge node */}
        <path d='M412 110 H476 V164 H540' className={styles.edge} />
        <path d='M412 218 H476 V164 H540' className={styles.edge} />

        {/* Baseline continues after the merge */}
        <path d='M560 164 H624' className={styles.edge} />

        {/* Baseline nodes */}
        <rect x='78' y='156' width='16' height='16' className={styles.node} />
        <text x='86' y='186' textAnchor='middle' className={styles.nodeLabel}>
          v1
        </text>

        <rect x='162' y='156' width='16' height='16' className={styles.node} />
        <text x='170' y='186' textAnchor='middle' className={styles.nodeLabel}>
          v2
        </text>

        <rect x='246' y='156' width='16' height='16' className={styles.node} />
        <text x='254' y='186' textAnchor='middle' className={styles.nodeLabel}>
          v3
        </text>
        <text x='254' y='198' textAnchor='middle' className={styles.nodeLabel}>
          base
        </text>

        {/* Upper branch: human writer (UserSharp glyph) edits `title` */}
        <g
          transform='translate(395,82) scale(0.5833)'
          className={styles.branchIcon}
        >
          <path d='M7 2h10v2H7zm0 8h10v2H7zm8-6h2v6h-2zM7 4h2v6H7zM4 14h2v8H4zm14 0h2v8h-2zM6 14h12v2H6z' />
        </g>
        <rect x='394' y='102' width='16' height='16' className={styles.node} />
        <text x='402' y='132' textAnchor='middle' className={styles.nodeLabel}>
          v4a
        </text>
        <text x='402' y='144' textAnchor='middle' className={styles.nodeLabel}>
          title
        </text>

        {/* Lower branch: agent writer (AiUserCircle glyph) edits `status` */}
        <g
          transform='translate(395,190) scale(0.5833)'
          className={styles.branchIcon}
        >
          <path d='M6 2h8v2H6zm0 18h12v2H6zM4 4h2v2H4zM2 6h2v12H2zm20 4h-2v8h2zM4 18h2v2H4zm16 0h-2v2h2zM10 6h4v2h-4zM8 8h2v4H8zm2 4h4v2h-4zm4-4h2v4h-2zm-8 8h12v2H6zM18 2h2v2h-2zm-2 2h2v2h-2zm2 2h2v2h-2zm2-2h2v2h-2z' />
        </g>
        <rect x='394' y='210' width='16' height='16' className={styles.node} />
        <text x='402' y='240' textAnchor='middle' className={styles.nodeLabel}>
          v4b
        </text>
        <text x='402' y='252' textAnchor='middle' className={styles.nodeLabel}>
          status
        </text>

        {/* Automatic merge: filled primary square */}
        <rect
          x='542'
          y='156'
          width='16'
          height='16'
          className={styles.nodeMerge}
        />
        <text x='550' y='186' textAnchor='middle' className={styles.nodeLabel}>
          v5
        </text>
        <text x='550' y='198' textAnchor='middle' className={styles.nodeLabel}>
          merge
        </text>

        <rect x='626' y='156' width='16' height='16' className={styles.node} />
        <text x='634' y='186' textAnchor='middle' className={styles.nodeLabel}>
          v6
        </text>
        <text x='634' y='198' textAnchor='middle' className={styles.nodeLabel}>
          fix typos
        </text>
      </svg>
    </Diagram>
  );
}
