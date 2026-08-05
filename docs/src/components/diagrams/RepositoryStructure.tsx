import { ArrowDown } from 'pixelarticons/react';

import { HomepageIcon } from '../HomepageIcon';
import CommitSquare from './CommitSquare';
import styles from './RepositoryStructure.module.css';

const LOG = [
  { version: 'c1', key: 'ideas' },
  { version: 'c2', key: 'quotes' },
  { version: 'c3', key: 'reading' },
  { version: 'c4', key: 'ideas' },
  { version: 'c5', key: 'quotes' },
  { version: 'c6', key: 'reading' },
  { version: 'c7', key: 'ideas' },
] as const;

// One commit threaded on the spine: a connecting edge segment above the
// tile (except the first), then the tile with its item key. The unbroken
// edge chain is what makes the log read as ONE indivisible sequence.
function Entry(
  { version, itemKey, first, filled }: {
    version: string;
    itemKey: string;
    first?: boolean;
    filled?: boolean;
  },
) {
  return (
    <li className={styles.entry}>
      {!first && <span className={styles.edge} aria-hidden='true' />}
      <span className={styles.row}>
        <CommitSquare version={version} filled={filled} />
        <span className={styles.key}>{itemKey}</span>
      </span>
    </li>
  );
}

// Physical layer: a repository is one .goat file holding a single
// append-only log. The file frame is the boundary; inside, every commit --
// for every item -- hangs on one continuous spine (the atomic log), keys
// interleaved in write order. c8 is the filled hero (newest append); the
// open arrow stub below it says the log only ever grows at the end.
// Storage features (SSD, atomicity, length prefix) stay in the prose.
export default function RepositoryStructure() {
  return (
    <figure className={styles.figure}>
      <div className={styles.frame}>
        <span className={styles.frameLabel}>notes.goat</span>
        <ol className={styles.spine}>
          {LOG.map((r, i) => (
            <Entry
              key={r.version}
              version={r.version}
              itemKey={r.key}
              first={i === 0}
            />
          ))}
          <Entry version='c8' itemKey='quotes' filled />
          <li className={styles.openEnd} aria-hidden='true'>
            <span className={styles.edge} />
            <HomepageIcon icon={ArrowDown} size={18} />
          </li>
        </ol>
      </div>
      <figcaption className={styles.figureCaption}>
        One .goat file per repository: a single append-only log of signed
        commits. Every commit — for every item — lands at the end of the same
        log. A human-readable .jsonl variant exists for debugging.
      </figcaption>
    </figure>
  );
}
