import {
  ArrowDown,
  ArrowRight,
  ArrowsHorizontal,
  CirclePower,
  Database,
  LockSharp,
  MonitorSharp,
  PhoneSharp,
  ServerSharp,
  ShieldSharp,
  TabletSharp,
} from 'pixelarticons/react';

import { HomepageIcon, type HomepageIconComponent } from '../HomepageIcon';
import styles from './SyncProtocolV2.module.css';

type Icon = HomepageIconComponent;

// Same device fleet on both lanes: the architecture changes, the hardware
// people carry doesn't. Symmetry carries "same devices, different role".
const devices = [MonitorSharp, PhoneSharp, TabletSharp] as const;

function LaneCaption({ children }: { children: string }) {
  return <p className={styles.laneCaption}>{children}</p>;
}

// Centralized: the server absorbs compute + storage + trust, so it must
// scale UP. Stacked repeated strips = "more machine" (repetition = scale
// law).
function BeefyServer() {
  return (
    <div className={styles.serverBox}>
      <div className={styles.stackStrips}>
        {[0, 1, 2].map((i) => (
          <div className={styles.hStrip} key={i}>
            <HomepageIcon icon={ServerSharp} size={18} />
          </div>
        ))}
      </div>
      <span className={styles.boxTag}>compute + storage + trust</span>
    </div>
  );
}

// GoatDB: peers carry the data and the compute, so the server shrinks to a
// cheap anchor -- but it is still one peer-shaped participant in the mesh,
// so it wears the SAME tile as the clients (primary square + shadow, server
// icon + own replica) to make the symmetry literal. Its three jobs --
// authentication, authorization, uptime -- hang below as a small badge row
// fused with the tag (the properties).
function AnchorServer() {
  return (
    <div className={styles.serverBox}>
      <div className={styles.serverNode}>
        <HomepageIcon icon={ServerSharp} size={20} />
        <HomepageIcon icon={Database} size={14} />
      </div>
      <div className={styles.roleRow}>
        <HomepageIcon icon={LockSharp} size={14} />
        <HomepageIcon icon={ShieldSharp} size={14} />
        <HomepageIcon icon={CirclePower} size={14} />
        <span className={styles.boxTag}>trust + uptime only</span>
      </div>
    </div>
  );
}

// peer = device + full local replica inside a primary-stroke square
// (primary stroke = holds data); non-peer = empty terminal, neutral stroke.
// fan renders the ArrowDown hub-spoke link (centralized lane only -- on the
// GoatDB lane a single shared link taps the mesh instead).
function DeviceCell({ icon, peer, fan }: {
  icon: Icon;
  peer?: boolean;
  fan?: boolean;
}) {
  return (
    <div className={styles.cell}>
      {fan && <HomepageIcon icon={ArrowDown} size={16} />}
      <div className={peer ? styles.peerSquare : styles.clientSquare}>
        <HomepageIcon icon={icon} size={20} />
        {peer && <HomepageIcon icon={Database} size={14} />}
      </div>
    </div>
  );
}

// Identical 5-slot grid on both lanes. Only the GoatDB lane fills the link
// slots: peers sync directly with each other, terminals never do.
function DeviceRow({ peer, fan }: { peer?: boolean; fan?: boolean }) {
  return (
    <div className={styles.deviceRow}>
      <DeviceCell icon={devices[0]} peer={peer} fan={fan} />
      <span className={styles.linkSlot}>
        {peer && <HomepageIcon icon={ArrowsHorizontal} size={14} />}
      </span>
      <DeviceCell icon={devices[1]} peer={peer} fan={fan} />
      <span className={styles.linkSlot}>
        {peer && <HomepageIcon icon={ArrowsHorizontal} size={14} />}
      </span>
      <DeviceCell icon={devices[2]} peer={peer} fan={fan} />
    </div>
  );
}

function LaneCentralized() {
  return (
    <article className={styles.lane}>
      <LaneCaption>Centralized</LaneCaption>
      <BeefyServer />
      <span className={styles.laneNote}>
        provisioned for peak load
        <br />
        crash = outage
      </span>
      <DeviceRow fan />
      <p className={styles.laneFooter}>server owns the data and the work</p>
    </article>
  );
}

function LaneGoat() {
  return (
    <article className={styles.lane}>
      <LaneCaption>GoatDB P2P</LaneCaption>
      <AnchorServer />
      <span className={styles.laneNote}>
        commodity hardware · stateless
        <br />
        crash = rebuilt by peers
      </span>
      {/* One link into the mesh: the server is one participant, not a hub. */}
      <span className={styles.singleLink}>
        <HomepageIcon icon={ArrowDown} size={16} />
      </span>
      <DeviceRow peer />
      <p className={styles.laneFooter}>peers carry the data and the work</p>
    </article>
  );
}

function LaneConnector() {
  return (
    <li className={styles.connector} aria-hidden='true'>
      <p className={styles.connectorLabel}>
        Compute moves
        <br />
        to the edges
        <br />
        the server shrinks
      </p>
      <HomepageIcon icon={ArrowRight} />
    </li>
  );
}

// Two-lane comparison: centralized scale-up (left) vs GoatDB's P2P network
// with a lightweight trust-and-uptime anchor server (right). Bare columns,
// no container chrome. DOM (not SVG) so lanes reflow on mobile and text
// stays selectable -- the shared <Diagram> wrapper is SVG-centric and
// intentionally not used.
export default function SyncProtocolV2() {
  return (
    <figure className={styles.figure}>
      <ol className={styles.lanes}>
        <li className={styles.laneCell}>
          <LaneCentralized />
        </li>
        <LaneConnector />
        <li className={styles.laneCell}>
          <LaneGoat />
        </li>
      </ol>
      <figcaption className={styles.figureCaption}>
        Centralized sync scales the server up. GoatDB scales it down — peers
        carry the data, the server keeps trust and uptime, and clients rebuild
        it after a crash.
      </figcaption>
    </figure>
  );
}
