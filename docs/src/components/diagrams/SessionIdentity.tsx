import {
  CalendarSharp,
  Human,
  LockSharp,
  LogoutSharp,
  UserSharp,
} from 'pixelarticons/react';

import { PixelIcon, type PixelIconComponent } from '../PixelIcon';
import styles from './SessionIdentity.module.css';

// One identity form on the network roster. Equal geometry across forms
// (mirror law); the public key fragment is the identity's name -- primary
// marks the data that IS the identity.
function IdentityCard(
  { icon, label, user }: {
    icon: PixelIconComponent;
    label: string;
    user: string;
  },
) {
  return (
    <li className={styles.card}>
      <span className={styles.identityRow}>
        <PixelIcon icon={icon} size={18} />
        <span className={styles.cardLabel}>{label}</span>
      </span>
      <span className={styles.mono}>user: {user}</span>
      <span className={styles.monoKey}>key: 8f3a…</span>
    </li>
  );
}

// One session mechanic: rotation and revocation are properties of the
// identity, so they live on the roster -- not on the audit trail.
function Mechanic(
  { icon, children }: {
    icon: PixelIconComponent;
    children: React.ReactNode;
  },
) {
  return (
    <li className={styles.mechRow}>
      <PixelIcon icon={icon} size={16} />
      <span>{children}</span>
    </li>
  );
}

// Act 1 of the sessions trio (SessionIdentity -> SessionSigning ->
// SessionAudit): WHO can act. A session is
// an identity on the network named by its public key; the private key that
// proves it never leaves the peer. DOM figure (not SVG) so the roster
// reflows on mobile; the shared <Diagram> wrapper is SVG-centric and
// intentionally not used.
export default function SessionIdentity() {
  return (
    <figure className={styles.figure}>
      <p className={styles.context}>
        <span className={styles.mono}>/sys/sessions</span>
        <span>&nbsp;— every session is a read-only item here</span>
      </p>
      <ul className={styles.roster}>
        <IdentityCard icon={UserSharp} label='identified session' user='xyz' />
        <IdentityCard icon={Human} label='anonymous session' user='(none)' />
      </ul>
      <ul className={styles.mechanics}>
        <Mechanic icon={LockSharp}>
          private key generated on this peer — never leaves it
        </Mechanic>
        <Mechanic icon={CalendarSharp}>
          30-day expiration = automatic key rotation
        </Mechanic>
        <Mechanic icon={LogoutSharp}>
          revoke: root sets expiration to the past
        </Mechanic>
      </ul>
      <figcaption className={styles.figureCaption}>
        A session is an identity on the GoatDB network, named by its public
        key. Identified sessions bind a user ID to a peer; anonymous sessions
        bind the peer alone. The private key proving the identity never
        leaves the peer.
      </figcaption>
    </figure>
  );
}
