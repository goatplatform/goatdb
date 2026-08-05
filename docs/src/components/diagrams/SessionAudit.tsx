import { ArrowDown, Check, MonitorSharp } from 'pixelarticons/react';

import { HomepageIcon, type HomepageIconComponent } from '../HomepageIcon';
import styles from './SessionAudit.module.css';

// Header row of one card: WHO acts here. Identity icons always carry a
// word label (design law).
function CardHead(
  { icon, label }: { icon: HomepageIconComponent; label: string },
) {
  return (
    <span className={styles.cardHead}>
      <HomepageIcon icon={icon} size={16} />
      <span className={styles.headLabel}>{label}</span>
    </span>
  );
}

// One peer's independent after-the-fact audit of the replicated commit.
// Identical geometry across peers IS the statement: every peer checks on
// its own, and only after the action was taken.
function PeerAudit({ label }: { label: string }) {
  return (
    <div className={styles.peerCard}>
      <CardHead icon={MonitorSharp} label={label} />
      <span className={styles.checkRow}>
        <HomepageIcon icon={Check} size={14} />
        <span className={styles.mono}>integrity</span>
      </span>
      <span className={styles.checkRow}>
        <HomepageIcon icon={Check} size={14} />
        <span className={styles.mono}>session 8f3a…</span>
      </span>
      <span className={styles.checkRow}>
        <HomepageIcon icon={Check} size={14} />
        <span className={styles.mono}>authorized</span>
      </span>
      <span className={styles.cardNote}>commit enters the graph</span>
    </div>
  );
}

// Act 3 of the sessions trio (SessionIdentity -> SessionSigning ->
// SessionAudit): WHO did what, and who
// checks. Peers act first -- commits are signed and applied locally, even
// offline. Authorization is enforced by every peer independently, after the
// fact, when signed history replicates. The `8f3a…` fragment is the
// identity from SessionIdentity, returning as the signature tag. DOM
// figure; vertical beats are mobile-native.
export default function SessionAudit() {
  return (
    <figure className={styles.figure}>
      <ol className={styles.beats}>
        <li className={styles.beat}>
          <div className={styles.commitCard}>
            <CardHead icon={MonitorSharp} label='peer a signs' />
            <span className={styles.mono}>write /user/xyz</span>
            <span className={styles.monoKey}>sig: 8f3a…</span>
          </div>
          <span className={styles.note}>
            applied locally at once — no permission check at action time;
            works offline
          </span>
        </li>
        <li className={styles.connector}>
          <span aria-hidden='true'>
            <HomepageIcon icon={ArrowDown} size={18} />
          </span>
          <span className={styles.connectorNote}>
            signed history replicates to all peers
          </span>
        </li>
        <li className={styles.beat}>
          <div className={styles.auditPair}>
            <PeerAudit label='peer b' />
            <PeerAudit label='peer c' />
          </div>
          <span className={styles.note}>
            invalid or unauthorized commits are rejected here — never
            entering the graph
          </span>
        </li>
      </ol>
      <p className={styles.payoff}>
        The commit graph doubles as a cryptographic audit trail — every
        action attributable to its signing session, enforced independently on
        every peer.
      </p>
      <figcaption className={styles.figureCaption}>
        Secure mode (default): every commit is signed with the session's
        private key. Peers verify integrity, signing session, and
        authorization independently when history arrives — after the fact. A
        signature proves the holder of a session key, not a real-world
        identity; mapping sessions to actors is the application's job. Reads
        stay local and unsigned.
      </figcaption>
    </figure>
  );
}
