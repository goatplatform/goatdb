import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import QuickStart from '@site/src/components/QuickStart';
import Heading from '@theme/Heading';

import styles from './index.module.css';
import SingleTenantIcon from '@site/src/components/icons/SingleTenantIcon';
import OfflineFirstIcon from '@site/src/components/icons/OfflineFirstIcon';
import MultiplayerIcon from '@site/src/components/icons/MultiplayerIcon';
import CollaborativeIcon from '@site/src/components/icons/CollaborativeIcon';

function UseCases() {
  return (
    <section className={styles.useCases}>
      <div className='container'>
        <h2>Built for modern apps</h2>
        <div className={styles.useCaseGrid}>
          <div className={styles.useCase}>
            <div className={styles.useCaseIconWrapper}>
              <SingleTenantIcon className={styles.useCaseIcon} />
            </div>
            <h3>Ultra-Cheap Single-Tenant</h3>
            <p>
              Deploy each customer on their own $5/month VM. The
              cryptographically signed commit graph means clients can restore
              crashed servers automatically. No complex HA setup needed.
            </p>
          </div>
          <div className={styles.useCase}>
            <div className={styles.useCaseIconWrapper}>
              <OfflineFirstIcon className={styles.useCaseIcon} />
            </div>
            <h3>Offline-First Apps</h3>
            <p>
              Create mobile and desktop apps that work seamlessly offline and
              sync when connected. Perfect for field work and unreliable
              networks.
            </p>
          </div>
          <div className={styles.useCase}>
            <div className={styles.useCaseIconWrapper}>
              <MultiplayerIcon className={styles.useCaseIcon} />
            </div>
            <h3>Multiplayer Games</h3>
            <p>
              Build real-time multiplayer experiences with minimal server
              overhead. Each game room gets its own lightweight instance. Scale
              horizontally by adding cheap VMs.
            </p>
          </div>
          <div className={styles.useCase}>
            <div className={styles.useCaseIconWrapper}>
              <CollaborativeIcon className={styles.useCaseIcon} />
            </div>
            <h3>Collaborative Editing</h3>
            <p>
              Build Google Docs-like experiences where multiple users edit the
              same document in real-time, with automatic conflict resolution.
            </p>
          </div>
        </div>
        <p className={styles.tradeoffNote}>
          GoatDB trades raw query performance for developer experience. If you
          need sub-100ms queries on millions of rows, use PostgreSQL.
          <br />
          <Link to='/docs/benchmarks'>See benchmarks →</Link>
        </p>
      </div>
    </section>
  );
}

function OpenSource() {
  return (
    <section className={styles.openSource}>
      <div className='container'>
        <div className={styles.openSourceContent}>
          <h2>Open Source</h2>
          <p className={styles.openSourceDescription}>
            Apache 2.0 licensed. Built in public. Used in production.
            <br />
            Help us build the future of local-first software.
          </p>
          <div className={styles.openSourceButtons}>
            <Link
              className='button button--primary button--lg'
              to='https://github.com/goatplatform/goatdb'
            >
              ⭐ Star on GitHub
            </Link>
            <Link
              className='button button--outline button--secondary button--lg'
              to='https://github.com/goatplatform/goatdb/blob/main/CONTRIBUTING.md'
            >
              Contribute
            </Link>
          </div>
          <p className={styles.openSourceStats}>
            <a href='https://github.com/goatplatform/goatdb/stargazers'>
              <img
                src='https://img.shields.io/github/stars/goatplatform/goatdb?style=social'
                alt='GitHub stars'
              />
            </a>{' '}
            <a href='https://github.com/goatplatform/goatdb/network/members'>
              <img
                src='https://img.shields.io/github/forks/goatplatform/goatdb?style=social'
                alt='GitHub forks'
              />
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}

function HomepageHeader() {
  return (
    <header className={styles.heroBanner}>
      <div className='container'>
        <h1 className={styles.heroTitle}>GoatDB</h1>
        <p className={styles.heroSubtitle}>
          Build real-time collaborative apps that work offline.
          <br />
          Cryptographically secure. Self-healing architecture. Single-tenant
          ready.
        </p>
        <div className={styles.buttons}>
          <Link
            className='button button--primary button--lg'
            to='/docs/tutorial'
          >
            Start Building →
          </Link>
          <Link
            className='button button--outline button--secondary button--lg'
            to='/docs/architecture'
          >
            Architecture
          </Link>
        </div>
      </div>
    </header>
  );
}

export default function Home(): JSX.Element {
  return (
    <Layout
      title='GoatDB - Self-healing database for single-tenant apps'
      description='Deploy ultra-cheap single-tenant SaaS. Cryptographically signed commits let clients restore crashed servers. Single binary with Deno. Perfect for privacy-first apps.'
    >
      <HomepageHeader />
      <main>
        <QuickStart />
        <HomepageFeatures />
        <UseCases />
        <OpenSource />
      </main>
    </Layout>
  );
}
