import {
  AiUserCircle,
  ArrowRight,
  GitMergeSharp,
  UserSharp,
} from 'pixelarticons/react';

import { PixelIcon, type PixelIconComponent } from '../PixelIcon';
import CommitSquare from './CommitSquare';
import styles from './MergeBaseBranches.module.css';

// A diverging leaf: WHO edited (identity icon) next to their signed commit,
// plus a mono note naming WHICH field they touched. Field-level notes are
// the whole point -- the merge is conflict-free because v4a and v4b touch
// different fields of the same item.
function Leaf(
  { icon, version, note }: {
    icon: PixelIconComponent;
    version: string;
    note: string;
  },
) {
  return (
    <div className={styles.leaf}>
      <div className={styles.leafRow}>
        <PixelIcon icon={icon} size={18} />
        <CommitSquare version={version} />
      </div>
      <span className={styles.tag}>{note}</span>
    </div>
  );
}

// Two stacked arrows, one per leaf row, so each divergence/convergence edge
// lines up structurally with its leaf (inner grid rows mirror the leaves
// column rows). On mobile the column collapses to a single rotated arrow.
function LinkCol() {
  return (
    <div className={styles.linkCol} aria-hidden='true'>
      <span className={styles.linkArrow}>
        <PixelIcon icon={ArrowRight} size={18} />
      </span>
      <span className={styles.linkArrow}>
        <PixelIcon icon={ArrowRight} size={18} />
      </span>
    </div>
  );
}

// Three-way merge needs a base: v3 (the LCA of the two leaves) fans out to
// the concurrent edits v4a/v4b, which converge into the automatic merge v5
// (filled square = the result the system produces). Bare 5-column grid, no
// container chrome. DOM (not SVG) so the flow reflows on mobile; the shared
// <Diagram> wrapper is SVG-centric and intentionally not used.
export default function MergeBaseBranches() {
  return (
    <figure className={styles.figure}>
      <div className={styles.grid}>
        <div className={styles.cell}>
          <CommitSquare version='v3' />
          <span className={styles.tag}>base · LCA</span>
        </div>
        <LinkCol />
        <div className={styles.leaves}>
          <Leaf icon={UserSharp} version='v4a' note='edits title' />
          <Leaf icon={AiUserCircle} version='v4b' note='edits status' />
        </div>
        <LinkCol />
        <div className={styles.cell}>
          <CommitSquare version='v5' filled icon={GitMergeSharp} />
          <span className={styles.tag}>automatic merge</span>
        </div>
      </div>
      <figcaption className={styles.figureCaption}>
        A three-way merge starts from the base — the lowest common ancestor of
        the two leaves. If the base hasn't synced to this peer yet, the merge
        defers until it arrives.
      </figcaption>
    </figure>
  );
}
