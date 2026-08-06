import { LockSharp } from 'pixelarticons/react';

import { PixelIcon, type PixelIconComponent } from '../PixelIcon';
import styles from './CommitSquare.module.css';

// A commit = 36px primary-stroke square (primary stroke = holds data). The
// LockSharp corner badge marks every commit as signed -- provenance is
// carried by the diagram, not just the prose. Shared across diagrams
// (merge graph, session signing) so the signed-commit tile reads the same
// everywhere.
export default function CommitSquare(
  { version, filled, icon }: {
    version: string;
    filled?: boolean;
    icon?: PixelIconComponent;
  },
) {
  return (
    <div className={filled ? styles.commitFilled : styles.commit}>
      <span className={styles.commitContent}>
        {icon && <PixelIcon icon={icon} size={14} />}
        <span className={styles.commitVersion}>{version}</span>
      </span>
      <span className={styles.signBadge}>
        <PixelIcon icon={LockSharp} size={12} />
      </span>
    </div>
  );
}
