import { Fragment } from 'react';

import CommitSquare from './CommitSquare';
import styles from './CommitGraphs.module.css';

const GRAPHS = [
  { key: 'ideas', versions: ['c1', 'c4', 'c7'] },
  { key: 'quotes', versions: ['c2', 'c5', 'c8'], tipFilled: true },
  { key: 'reading', versions: ['c3', 'c6'] },
] as const;

// One item's commit graph: the key chip (same primary mono as the log's)
// above a vertical spine of that item's commits, in the same glyph language
// as RepositoryStructure -- the single log spine re-threaded by key.
function Graph(
  { itemKey, versions, tipFilled }: {
    itemKey: string;
    versions: readonly string[];
    tipFilled?: boolean;
  },
) {
  return (
    <div className={styles.graph}>
      <span className={styles.key}>{itemKey}</span>
      {versions.map((v, i) => (
        <Fragment key={v}>
          {i > 0 && <span className={styles.edge} aria-hidden='true' />}
          <CommitSquare
            version={v}
            filled={tipFilled && i === versions.length - 1}
          />
        </Fragment>
      ))}
    </div>
  );
}

// Logical layer: the same commits as RepositoryStructure's log, grouped by
// key into one independent spine per item -- multiple commit graphs inside
// a single repository frame. Unequal spine lengths show items evolving
// independently, in parallel. c8 stays filled: the same newest append in
// both views. Spines stay strictly linear; branching and merging are the
// commit-graph page's story, not this one.
export default function CommitGraphs() {
  return (
    <figure className={styles.figure}>
      <div className={styles.frame}>
        <span className={styles.frameLabel}>/data/notes</span>
        <div className={styles.graphs}>
          {GRAPHS.map((g) => (
            <Graph
              key={g.key}
              itemKey={g.key}
              versions={g.versions}
              tipFilled={'tipFilled' in g}
            />
          ))}
        </div>
      </div>
      <figcaption className={styles.figureCaption}>
        The same log, grouped by key: one independent commit graph per item,
        all inside the repository. Each item's history evolves in parallel —
        no interference between items.
      </figcaption>
    </figure>
  );
}
