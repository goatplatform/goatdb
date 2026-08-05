import {
  AiUserCircle,
  ArrowRight,
  UserSharp,
} from 'pixelarticons/react';

import { HomepageIcon, type HomepageIconComponent } from '../HomepageIcon';
import styles from './FieldMergeCloseUp.module.css';

type Author = 'human' | 'agent';

const AUTHOR_ICON: Record<Author, HomepageIconComponent> = {
  human: UserSharp,
  agent: AiUserCircle,
};

// One side of a concurrent edit: WHO signed it (icon + word label -- icons
// alone don't read as identities), then WHAT they wrote as an operation
// (= overwrite, + add/put/insert). A struck op lost the merge (last change
// wins) -- the resolution is shown at the input, not just the output.
function EditLine(
  { author, op, struck }: { author: Author; op: string; struck?: boolean },
) {
  return (
    <span className={styles.editLine}>
      <HomepageIcon icon={AUTHOR_ICON[author]} size={14} />
      <span className={styles.editAuthor}>{author}</span>
      <span className={struck ? styles.editOpStruck : styles.editOp}>
        {op}
      </span>
    </span>
  );
}

// Small provenance icons trailing the merged value: who survived the merge.
// LCW rows show the single winner; union/key-merge/merged rows show both.
function Survivors({ of }: { of: Author | 'both' }) {
  const authors: Author[] = of === 'both' ? ['human', 'agent'] : [of];
  return (
    <span className={styles.survivors}>
      {authors.map((a) => <HomepageIcon key={a} icon={AUTHOR_ICON[a]} size={14} />)}
    </span>
  );
}

// One row = one field type's merge act: the field, the two concurrent
// signed edits on it, and the deterministic merged outcome. The merged cell
// is a fixed 2-line stack (value + survivors, then strategy badge) so it
// mirrors the 2-line edits cell and the badge never wraps mid-value.
function StrategyRow(
  { field, type, humanOp, agentOp, struck, merged, survivors, strategy }: {
    field: string;
    type: string;
    humanOp: string;
    agentOp: string;
    struck?: Author;
    merged: string;
    survivors: Author | 'both';
    strategy: string;
  },
) {
  return (
    <div className={styles.row}>
      <span className={styles.fieldCell}>
        {field} · {type}
      </span>
      <span className={styles.editsCell}>
        <EditLine author='human' op={humanOp} struck={struck === 'human'} />
        <EditLine author='agent' op={agentOp} struck={struck === 'agent'} />
      </span>
      <span className={styles.arrowCell} aria-hidden='true'>
        <HomepageIcon icon={ArrowRight} size={18} />
      </span>
      <span className={styles.mergedCell}>
        <span className={styles.mergedLine}>
          <span className={styles.mergedValue}>{merged}</span>
          <Survivors of={survivors} />
        </span>
        <span className={styles.strategyBadge}>{strategy}</span>
      </span>
    </div>
  );
}

// Field-level merge semantics: the graph story (base + leaves + merge)
// belongs to MergeBaseBranches further down the page; THIS figure teaches
// what happens INSIDE the item -- each field type resolves by its own
// deterministic strategy (schema.md "Conflict Resolution Deep Dive").
// DOM (not SVG) so rows reflow on mobile and text stays selectable; <div>
// grid (not ol/li) to stay immune to Infima's li+li margin shift.
export default function FieldMergeCloseUp() {
  return (
    <figure className={styles.figure}>
      <div className={styles.header} aria-hidden='true'>
        <span className={styles.caption}>FIELD</span>
        <span className={styles.caption}>CONCURRENT EDITS</span>
        <span />
        <span className={styles.caption}>MERGED</span>
      </div>
      <StrategyRow
        field='title'
        type='string'
        humanOp='= "Q1 goals"'
        agentOp='= "Q2 goals"'
        struck='agent'
        merged='"Q1 goals"'
        survivors='human'
        strategy='last change wins'
      />
      {/* The limit case: LCW discards one write even though both moved
        * stock 10 -> 9 -- the struck line IS the lost decrement, which is
        * what makes the merged 9 (not 8) correct structurally yet wrong
        * for a counter. Full transitions are shown because the base value
        * is what makes 9-not-8 computable. This row is the referent for
        * the :::note warning below the figure (additive-counter semantics
        * are an application-level concern). */}
      <StrategyRow
        field='stock'
        type='number'
        humanOp='10 → 9'
        agentOp='10 → 9'
        struck='human'
        merged='9'
        survivors='agent'
        strategy='last change wins'
      />
      <StrategyRow
        field='tags'
        type='set'
        humanOp='+ q1'
        agentOp='+ q2'
        merged='q1, q2'
        survivors='both'
        strategy='union'
      />
      <StrategyRow
        field='meta'
        type='map'
        humanOp='+ priority: high'
        agentOp='+ assignee: bot'
        merged='priority: high · assignee: bot'
        survivors='both'
        strategy='key merge'
      />
      <StrategyRow
        field='doc'
        type='rich text'
        humanOp='p → h1'
        agentOp='+ "beautiful"'
        merged='h1 "Hello beautiful world"'
        survivors='both'
        strategy='tree merge'
      />
      <StrategyRow
        field='doc'
        type='rich text'
        humanOp='prepend "Q1 "'
        agentOp='append " v2"'
        merged='"Q1 roadmap v2"'
        survivors='both'
        strategy='char merge'
      />
      <StrategyRow
        field='list'
        type='ordered'
        humanOp='insert "milk" after "bread"'
        agentOp='insert "eggs" before "bread"'
        merged='"eggs", "bread", "milk"'
        survivors='both'
        strategy='order merge'
      />
      <figcaption className={styles.figureCaption}>
        Every field type merges by its own deterministic strategy:
        primitives — string, number, boolean, date — keep the last change,
        sets union, maps merge per key, rich text
        merges structure per node and text per character, and ordered
        collections merge concurrent inserts into one deterministic order —
        whether ordering items in a repo or entries in a set/map field. Each
        edit stays signed by the session that wrote it.
      </figcaption>
    </figure>
  );
}
