import {
  ArrowDown,
  ArrowRight,
  Database,
  FileSharp,
  Grid3x3Sharp,
  MessageSharp,
  NoteSharp,
  ServerSharp,
  UserSharp,
  WindowFrameSharp,
} from 'pixelarticons/react';

import {
  PixelIcon,
  type PixelIconComponent,
} from '../PixelIcon';
import styles from './RepositoryModel.module.css';

type Icon = PixelIconComponent;

// Repo identities make sharding-by-concern literal: each repository owns a
// domain, not an arbitrary key range.
const repos = [
  { name: 'user', icon: UserSharp },
  { name: 'notes', icon: NoteSharp },
  { name: 'chat', icon: MessageSharp },
  { name: 'files', icon: FileSharp },
] as const;

function FrameCaption({ icon: IconComponent, children }: {
  icon: Icon;
  children: string;
}) {
  return (
    <p className={styles.frameCaption}>
      <span className={styles.captionIcon}>
        <PixelIcon icon={IconComponent} size={14} />
      </span>
      {children}
    </p>
  );
}

// Identical on both frames: the application doesn't change -- only who owns
// the partition logic does. Neutral border keeps the symmetry readable.
function AppBox() {
  return (
    <div className={styles.appBox}>
      <PixelIcon icon={WindowFrameSharp} />
      <span className={styles.boxLabel}>Application</span>
    </div>
  );
}

function DownLink({ label }: { label: string }) {
  return (
    <div className={styles.downLink}>
      <PixelIcon icon={ArrowDown} size={16} />
      <span>{label}</span>
    </div>
  );
}

// DB-level: one Database per strip = the database scaled out into shard
// nodes by the infrastructure. Mirrors the app-side repo cells: cells with
// identity icons, but infra-owned and hidden behind the single endpoint.
function ClusterBox() {
  return (
    <div className={styles.clusterBox}>
      <div className={styles.strips}>
        {[0, 1, 2].map((i) => (
          <div className={styles.strip} key={i}>
            <PixelIcon icon={Database} size={18} />
          </div>
        ))}
      </div>
      <span className={styles.clusterLabel}>hidden shards</span>
    </div>
  );
}

// App-level: each repo is a file the app addresses directly. One ArrowDown
// per repo draws the fan-out without any drawn connector lines.
function RepoCell({ name, icon: IconComponent }: { name: string; icon: Icon }) {
  return (
    <div className={styles.repoCell}>
      <PixelIcon icon={ArrowDown} size={16} />
      <div className={styles.repoSquare}>
        <PixelIcon icon={IconComponent} size={20} />
      </div>
      <span className={styles.repoTab}>{name}</span>
    </div>
  );
}

function FrameDb() {
  return (
    <article className={styles.frame}>
      <FrameCaption icon={ServerSharp}>DB-level sharding</FrameCaption>
      <AppBox />
      <DownLink label='single endpoint' />
      <ClusterBox />
      <p className={styles.frameFooter}>
        Single endpoint · hidden shards · resharding + cluster ops
      </p>
    </article>
  );
}

function FrameApp() {
  return (
    <article className={styles.frame}>
      <FrameCaption icon={Grid3x3Sharp}>App-level sharding</FrameCaption>
      <AppBox />
      {/* Mirrors the left lane's 'single endpoint' label row so both
       * columns share structure and height. */}
      <span className={styles.gridLabel}>direct file access</span>
      <div className={styles.repoGrid}>
        {repos.map((repo) => (
          <RepoCell key={repo.name} name={repo.name} icon={repo.icon} />
        ))}
      </div>
      <p className={styles.frameFooter}>
        repo = file = shard · open what you need · independent sync
      </p>
    </article>
  );
}

function FrameConnector() {
  return (
    <li className={styles.connector} aria-hidden='true'>
      <p className={styles.connectorLabel}>
        Sharding moves
        <br />
        into the app
      </p>
      <PixelIcon icon={ArrowRight} />
    </li>
  );
}

// Two-lane before/after: sharding owned by database infrastructure (left)
// vs owned by the application (right). Bare columns, no container chrome.
// DOM (not SVG) so columns reflow on mobile and text stays selectable --
// the shared <Diagram> wrapper is SVG-centric and intentionally not used.
export default function RepositoryModel() {
  return (
    <figure className={styles.figure}>
      <ol className={styles.frames}>
        <li className={styles.frameCell}>
          <FrameDb />
        </li>
        <FrameConnector />
        <li className={styles.frameCell}>
          <FrameApp />
        </li>
      </ol>
      <figcaption className={styles.figureCaption}>
        Sharding moves from the infrastructure into the application — each
        repository is a file your app names and opens directly.
      </figcaption>
    </figure>
  );
}
