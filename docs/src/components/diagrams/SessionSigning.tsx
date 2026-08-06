import {
  ArrowRight,
  LockSharp,
  UnlockSharp,
  UserSharp,
} from 'pixelarticons/react';

import { PixelIcon, type PixelIconComponent } from '../PixelIcon';
import CommitSquare from './CommitSquare';
import styles from './SessionSigning.module.css';

// One row of an end cell: icon + mono label. Identity icons always carry a
// word label (design law).
function CellRow(
  { icon, text, primary }: {
    icon: PixelIconComponent;
    text: string;
    primary?: boolean;
  },
) {
  return (
    <span className={styles.cellRow}>
      <PixelIcon icon={icon} size={18} />
      <span className={primary ? styles.monoKey : styles.mono}>{text}</span>
    </span>
  );
}

// Single-edge connector between cells (decorative; the cells carry the
// meaning). Rotates vertical when the grid collapses on mobile.
function LinkArrow() {
  return (
    <span className={styles.linkArrow} aria-hidden='true'>
      <PixelIcon icon={ArrowRight} size={18} />
    </span>
  );
}

// Act 2 of the sessions trio (SessionIdentity -> SessionSigning ->
// SessionAudit): HOW a session signs. The session from SessionIdentity
// (`8f3a…`) stamps every commit it generates with its private key -- the
// same signed-commit tile (CommitSquare + lock badge) used by the merge
// diagrams, so provenance reads identically across pages. The matching
// public key validates. Bare 5-column grid, no container chrome.
export default function SessionSigning() {
  return (
    <figure className={styles.figure}>
      <div className={styles.grid}>
        <div className={styles.cell}>
          <CellRow icon={UserSharp} text='session 8f3a…' />
          <CellRow icon={LockSharp} text='private key' />
          <span className={styles.tag}>signs — never leaves this peer</span>
        </div>
        <LinkArrow />
        <div className={styles.cell}>
          <span className={styles.commitRow}>
            <CommitSquare version='c1' />
            <CommitSquare version='c2' />
            <CommitSquare version='c3' />
          </span>
          <span className={styles.tag}>every commit signed</span>
        </div>
        <LinkArrow />
        <div className={styles.cell}>
          <CellRow icon={UnlockSharp} text='public key 8f3a…' primary />
          <span className={styles.tag}>validates integrity + origin</span>
        </div>
      </div>
      <figcaption className={styles.figureCaption}>
        Secure mode (default): every commit a session generates is signed
        with its private key on the peer. The matching public key — already
        known to the network — validates the signature, proving the commit's
        integrity and its origin session. A signature proves the holder of
        the session key, not a real-world identity.
      </figcaption>
    </figure>
  );
}
