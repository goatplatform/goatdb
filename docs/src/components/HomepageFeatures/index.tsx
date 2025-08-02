import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Svg?: React.ComponentType<React.ComponentProps<'svg'>>;
  emoji?: string;
  description: JSX.Element;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Works Offline',
    emoji: '🔌',
    description: (
      <>
        Your app works without internet. 
        Changes sync automatically when reconnected.
      </>
    ),
  },
  {
    title: 'Self-Healing Architecture',
    emoji: '🔗',
    description: (
      <>
        Cryptographically signed commits enable clients to restore 
        crashed servers. Ultra-cheap single-tenant deployments.
      </>
    ),
  },
  {
    title: 'Instant UI Updates',
    emoji: '🔄',
    description: (
      <>
        Local changes are instant. Remote changes stream in real-time. 
        No spinners. No loading states. No waiting.
      </>
    ),
  },
  {
    title: 'Smart Conflict Resolution',
    emoji: '🤝',
    description: (
      <>
        Like Git's three-way merge but for live data. 
        Multiple users edit simultaneously without conflicts.
      </>
    ),
  },
  {
    title: 'Just TypeScript',
    emoji: '📘',
    description: (
      <>
        TypeScript schemas. JavaScript queries. 
        No SQL. No query language. Just your code.
      </>
    ),
  },
  {
    title: 'Single Binary Deploy',
    emoji: '🚀',
    description: (
      <>
        Deno compiles everything into one binary. Deploy on cheap VMs. 
        Each customer gets their own instance. Scale by adding instances.
      </>
    ),
  },
];

function Feature({title, emoji, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className={styles.feature}>
        <div className={styles.featureEmoji}>{emoji}</div>
        <div className="padding-horiz--md">
          <Heading as="h3">{title}</Heading>
          <p>{description}</p>
        </div>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): JSX.Element {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.featuresHeader}>
          <h2>Why developers choose GoatDB</h2>
          <p>The only database where clients can securely restore a crashed server. Perfect for single-tenant SaaS.</p>
        </div>
        <div className={styles.architectureSection}>
          <h3>Never lose a change</h3>
          <p className={styles.architectureDescription}>Each document has its own commit graph. Branches merge automatically using 
          three-way merge with ephemeral CRDTs. No merge conflicts, ever.</p>
          <div className={styles.architectureFeatures}>
            <div className={styles.architectureFeature}>
              <span className={styles.architectureIcon}>🌳</span>
              <h4>Version History</h4>
              <p>Every item tracks its complete history</p>
            </div>
            <div className={styles.architectureFeature}>
              <span className={styles.architectureIcon}>🔀</span>
              <h4>Three-Way Merge</h4>
              <p>Git-style merging for live data</p>
            </div>
            <div className={styles.architectureFeature}>
              <span className={styles.architectureIcon}>⚡</span>
              <h4>Ephemeral CRDTs</h4>
              <p>Conflict-free types without the overhead</p>
            </div>
            <div className={styles.architectureFeature}>
              <span className={styles.architectureIcon}>🔍</span>
              <h4>Time Travel</h4>
              <p>Navigate through document history</p>
            </div>
          </div>
        </div>
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}