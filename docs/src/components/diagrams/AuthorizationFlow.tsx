import {
  ArrowDown,
  Check,
  Close,
  Database,
  UserSharp,
} from 'pixelarticons/react';

import { PixelIcon, type PixelIconComponent } from '../PixelIcon';
import styles from './AuthorizationFlow.module.css';

// Identity rail of one swimlane: WHO acts here. Identity icons always carry
// a word label (design law); the mono note names the actor's concrete data.
function LaneIdentity(
  { icon, label, note }: {
    icon: PixelIconComponent;
    label: string;
    note: string;
  },
) {
  return (
    <div className={styles.identity}>
      <span className={styles.identityRow}>
        <PixelIcon icon={icon} size={18} />
        <span className={styles.laneLabel}>{label}</span>
      </span>
      <span className={styles.identityNote}>{note}</span>
    </div>
  );
}

// Vertical handoff between lanes. The arrow is decorative (aria-hidden);
// the note carries the meaning of the handoff.
function Connector({ note }: { note: string }) {
  return (
    <li className={styles.connector}>
      <span aria-hidden='true'>
        <PixelIcon icon={ArrowDown} size={18} />
      </span>
      <span className={styles.connectorNote}>{note}</span>
    </li>
  );
}

// One exit of the boolean fork. Both exits share identical geometry (mirror
// symmetry = no third path); only stroke color and icon differ.
function VerdictBox(
  { allowed, label, note }: {
    allowed?: boolean;
    label: string;
    note: string;
  },
) {
  return (
    <div className={allowed ? styles.allowBox : styles.denyBox}>
      <span className={styles.verdictRow}>
        <PixelIcon icon={allowed ? Check : Close} size={16} />
        <span className={styles.verdictLabel}>{label}</span>
      </span>
      <span className={styles.verdictNote}>{note}</span>
    </div>
  );
}

// Lane 1: the session acts. One concrete representative op -- the
// figcaption states the check applies to every operation.
function SessionLane() {
  return (
    <li className={styles.lane}>
      <LaneIdentity icon={UserSharp} label='session' note='owner: xyz' />
      <div className={styles.card}>
        <span className={styles.mono}>write</span>
        <span className={styles.mono}>/user/xyz</span>
      </div>
    </li>
  );
}

// Lane 2: GoatDB evaluates. The matched rule card is primary-stroke --
// primary marks the data being acted on. The fn signature is the
// AuthRuleInfo contract from this page's code samples.
function GoatDbLane() {
  return (
    <li className={styles.lane}>
      <LaneIdentity icon={Database} label='goatdb' note='DataRegistry' />
      <div className={styles.ruleCard}>
        <span className={styles.mono}>/^\/user\/\w+$/</span>
        <span className={styles.monoSmall}>
          fn({'{'} session, op, repoPath, itemKey {'}'})
        </span>
      </div>
    </li>
  );
}

// Actor swimlane: WHO does WHAT in one authorization trace. Session acts,
// GoatDB evaluates the matching registered rule, the boolean verdict gates
// the operation. DOM (not SVG) so lanes reflow on mobile; the shared
// <Diagram> wrapper is SVG-centric and intentionally not used.
export default function AuthorizationFlow() {
  return (
    <figure className={styles.figure}>
      <ol className={styles.lanes}>
        <SessionLane />
        <Connector note='every operation is checked' />
        <GoatDbLane />
        <Connector note='the rule returns a boolean' />
        <li className={styles.verdicts}>
          <VerdictBox allowed label='allowed' note='operation proceeds' />
          <VerdictBox label='denied' note='operation blocked' />
        </li>
      </ol>
      <figcaption className={styles.figureCaption}>
        Every read and write is checked against the registered authorization
        rules. The matching rule receives the session, operation, and path —
        its boolean decides whether the operation proceeds.
      </figcaption>
    </figure>
  );
}
