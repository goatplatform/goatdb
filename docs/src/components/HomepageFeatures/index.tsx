import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';
import OfflineIcon from '../icons/OfflineIcon';
import SelfHealingIcon from '../icons/SelfHealingIcon';
import InstantUpdateIcon from '../icons/InstantUpdateIcon';
import ConflictResolutionIcon from '../icons/ConflictResolutionIcon';
import TypeScriptIcon from '../icons/TypeScriptIcon';
import DeployIcon from '../icons/DeployIcon';
import VersionHistoryIcon from '../icons/VersionHistoryIcon';
import ThreeWayMergeIcon from '../icons/ThreeWayMergeIcon';
import EphemeralCRDTIcon from '../icons/EphemeralCRDTIcon';
import TimeTravelIcon from '../icons/TimeTravelIcon';

type FeatureItem = {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  description: JSX.Element;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Works Offline',
    Icon: OfflineIcon,
    description: (
      <>
        Your app works without internet. Changes sync automatically when
        reconnected.
      </>
    ),
  },
  {
    title: 'Self-Healing Architecture',
    Icon: SelfHealingIcon,
    description: (
      <>
        Cryptographically signed commits enable clients to restore crashed
        servers. Ultra-cheap single-tenant deployments.
      </>
    ),
  },
  {
    title: 'Instant UI Updates',
    Icon: InstantUpdateIcon,
    description: (
      <>
        Local changes are instant. Remote changes stream in real-time. No
        spinners. No loading states. No waiting.
      </>
    ),
  },
  {
    title: 'Smart Conflict Resolution',
    Icon: ConflictResolutionIcon,
    description: (
      <>
        Like Git's three-way merge but for live data. Multiple users edit
        simultaneously without conflicts.
      </>
    ),
  },
  {
    title: 'Just TypeScript',
    Icon: TypeScriptIcon,
    description: (
      <>
        TypeScript schemas. JavaScript queries. No SQL. No query language. Just
        your code.
      </>
    ),
  },
  {
    title: 'Single Binary Deploy',
    Icon: DeployIcon,
    description: (
      <>
        Deno compiles everything into one binary. Deploy on cheap VMs. Each
        customer gets their own instance. Scale by adding instances.
      </>
    ),
  },
];

function Feature({ title, Icon, description }: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className={styles.feature}>
        <div className={styles.featureIcon}>
          <Icon className={styles.icon} />
        </div>
        <div className='padding-horiz--md'>
          <Heading as='h3'>{title}</Heading>
          <p>{description}</p>
        </div>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): JSX.Element {
  return (
    <section className={styles.features}>
      <div className='container'>
        <div className={styles.featuresHeader}>
          <h2>Why developers choose GoatDB</h2>
          <p>
            The only database where clients can securely restore a crashed
            server. Perfect for single-tenant SaaS.
          </p>
        </div>
        <div className={styles.architectureSection}>
          <h3>Never lose a change</h3>
          <p className={styles.architectureDescription}>
            Each document has its own commit graph. Branches merge automatically
            using three-way merge with ephemeral CRDTs. No merge conflicts,
            ever.
          </p>
          <div className={styles.architectureFeatures}>
            <div className={styles.architectureFeature}>
              <div className={styles.architectureIconWrapper}>
                <VersionHistoryIcon className={styles.architectureIcon} />
              </div>
              <h4>Version History</h4>
              <p>Every item tracks its complete history</p>
            </div>
            <div className={styles.architectureFeature}>
              <div className={styles.architectureIconWrapper}>
                <ThreeWayMergeIcon className={styles.architectureIcon} />
              </div>
              <h4>Three-Way Merge</h4>
              <p>Git-style merging for live data</p>
            </div>
            <div className={styles.architectureFeature}>
              <div className={styles.architectureIconWrapper}>
                <EphemeralCRDTIcon className={styles.architectureIcon} />
              </div>
              <h4>Ephemeral CRDTs</h4>
              <p>Conflict-free types without the overhead</p>
            </div>
            <div className={styles.architectureFeature}>
              <div className={styles.architectureIconWrapper}>
                <TimeTravelIcon className={styles.architectureIcon} />
              </div>
              <h4>Time Travel</h4>
              <p>Navigate through document history</p>
            </div>
          </div>
        </div>
        <div className='row'>
          {FeatureList.map((props, idx) => <Feature key={idx} {...props} />)}
        </div>
      </div>
    </section>
  );
}
