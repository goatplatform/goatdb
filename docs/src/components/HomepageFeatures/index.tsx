import styles from './styles.module.css';
import OfflineIcon from '../icons/OfflineIcon';
import ConflictResolutionIcon from '../icons/ConflictResolutionIcon';
import DeployIcon from '../icons/DeployIcon';

type DifferentiatorItem = {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  description: JSX.Element;
};

const differentiators: DifferentiatorItem[] = [
  {
    title: 'Works Offline, Syncs Automatically',
    Icon: OfflineIcon,
    description: (
      <>
        Your app works without internet. Local changes are instant — no
        spinners, no loading states. Changes sync automatically when
        reconnected.
      </>
    ),
  },
  {
    title: 'Git-Style Conflict Resolution',
    Icon: ConflictResolutionIcon,
    description: (
      <>
        Three-way merge with ephemeral CRDTs. Multiple users edit
        simultaneously without conflicts — like Git, but for live data.
      </>
    ),
  },
  {
    title: 'Single Binary, Ultra-Cheap Deploy',
    Icon: DeployIcon,
    description: (
      <>
        Deno compiles everything into one binary. Each customer gets their own
        instance on a $5/month VM. Clients restore crashed servers
        automatically.
      </>
    ),
  },
];

export default function HomepageFeatures(): JSX.Element {
  return (
    <section className={styles.features}>
      <div className='container'>
        <div className={styles.differentiatorGrid}>
          {differentiators.map(({ title, Icon, description }, idx) => (
            <div key={idx} className={styles.differentiator}>
              <div className={styles.differentiatorIcon}>
                <Icon className={styles.icon} />
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
