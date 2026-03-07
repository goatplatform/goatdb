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
    title: 'No Conflict Dialogs. Ever.',
    Icon: ConflictResolutionIcon,
    description: (
      <>
        Multiple users edit the same data at the same time. Changes merge
        automatically — no manual conflict resolution, no data loss.
      </>
    ),
  },
  {
    title: 'Self-Healing, Simple to Deploy',
    Icon: DeployIcon,
    description: (
      <>
        Compiles to a single binary on every runtime. If your server crashes,
        clients carry the full history and restore it automatically.
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
