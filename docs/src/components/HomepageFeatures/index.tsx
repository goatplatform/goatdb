import Link from '@docusaurus/Link';
import styles from './styles.module.css';
import MultiDeviceIcon from '../icons/MultiDeviceIcon';
import PromptIcon from '../icons/PromptIcon';
import SpeedometerIcon from '../icons/SpeedometerIcon';
import ReactHooksIcon from '../icons/ReactHooksIcon';

type DifferentiatorItem = {
  title: string;
  link: string;
  Icon: React.ComponentType<{ className?: string }>;
  description: JSX.Element;
};

const differentiators: DifferentiatorItem[] = [
  {
    title: 'Queries that stay fast',
    link: '/docs/benchmarks',
    Icon: SpeedometerIcon,
    description: (
      <>
        Queries subscribe to data and update incrementally &mdash; results stay
        current as data changes. 1,000&times; faster than SQLite in the browser
        at 10k items. GoatDB uses predicates because they naturally compose into
        live subscriptions. One concept for AI to learn, zero boilerplate to
        generate.
      </>
    ),
  },
  {
    title: 'Autonomous and offline',
    link: '/docs/sync',
    Icon: MultiDeviceIcon,
    description: (
      <>
        Agents run the same code everywhere &mdash; backend, edge, browser
        &mdash; with no runtime-specific adapters. They work fully offline and
        sync through the server when connected. Clients only open the
        repositories they need &mdash; scale by adding repos, not expanding
        them.
      </>
    ),
  },
  {
    title: 'Built for agents to write and run',
    link: '/docs/sessions',
    Icon: PromptIcon,
    description: (
      <>
        AI coding tools scaffold a complete GoatDB app in a single prompt
        &mdash; schema, queries, sync. Pure TypeScript from end to end. Every
        commit is signed with Ed25519, so you always know which agent or user
        wrote what &mdash; cryptographic attribution, built in.
      </>
    ),
  },
  {
    title: 'React hooks. Zero boilerplate.',
    link: '/docs/react',
    Icon: ReactHooksIcon,
    description: (
      <>
        Four hooks replace your entire state layer. useQuery subscribes to live
        data. useItem tracks a single document with field-level granularity.
        Built on useSyncExternalStore &mdash; the same primitive behind Zustand
        and Redux Toolkit. Direct mutation, auto-commit, no useCallback needed.
      </>
    ),
  },
];

export default function HomepageFeatures(): JSX.Element {
  return (
    <section className={styles.features}>
      <div className='container'>
        <div className={styles.differentiatorGrid}>
          {differentiators.map(({ title, link, Icon, description }, idx) => (
            <Link key={idx} to={link} className={styles.differentiator}>
              <div className={styles.differentiatorIcon}>
                <Icon className={styles.icon} />
              </div>
              <h3>{title}</h3>
              <p>{description}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
