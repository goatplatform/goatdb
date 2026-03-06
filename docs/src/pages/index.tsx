import Link from "@docusaurus/Link";
import Layout from "@theme/Layout";
import HomepageFeatures from "@site/src/components/HomepageFeatures";
import QuickStart from "@site/src/components/QuickStart";

import styles from "./index.module.css";
import OfflineFirstIcon from "@site/src/components/icons/OfflineFirstIcon";
import CollaborativeIcon from "@site/src/components/icons/CollaborativeIcon";
import AgentIcon from "@site/src/components/icons/AgentIcon";

function ProblemStatement() {
  return (
    <section className={styles.problemStatement}>
      <div className="container">
        <p className={styles.problemStatementText}>
          Current databases force a choice: embed them in the client and
          struggle with sync, or run them in the cloud and lose offline support.
          GoatDB takes a different path — a peer-to-peer data layer that reaches
          from your backend to your browser, works offline, and heals itself
          when servers crash.
        </p>
      </div>
    </section>
  );
}

function UseCases() {
  return (
    <section className={styles.useCases}>
      <div className="container">
        <h2>Built for modern apps</h2>
        <div className={styles.useCaseGrid}>
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
              <CollaborativeIcon className={styles.useCaseIcon} />
            </div>
            <h3>Collaborative Editing</h3>
            <p>
              Build Google Docs-like experiences where multiple users edit the
              same document in real-time, with automatic conflict resolution.
            </p>
          </div>
          <div className={styles.useCase}>
            <div className={styles.useCaseIconWrapper}>
              <AgentIcon className={styles.useCaseIcon} />
            </div>
            <h3>Distributed AI Agents</h3>
            <p>
              Give AI agents resilient, real-time state that follows them across
              devices. From cloud to browser, agents share a single
              cryptographically signed data layer.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function HonestTradeoff() {
  return (
    <section className={styles.honestTradeoff}>
      <div className="container">
        <div className={styles.honestTradeoffContent}>
          <h2>Not for everything</h2>
          <p>
            GoatDB trades raw query performance for developer experience and
            resilience. If you need sub-100ms queries on millions of rows, use
            PostgreSQL.
          </p>
          <Link to="/docs/benchmarks">See benchmarks →</Link>
        </div>
      </div>
    </section>
  );
}

function OpenSource() {
  return (
    <section className={styles.openSource}>
      <div className="container">
        <div className={styles.openSourceContent}>
          <h2>Open Source</h2>
          <p className={styles.openSourceDescription}>
            MIT licensed. Built in public. Used in production.
            <br />
            Help us build the future of local-first software.
          </p>
          <div className={styles.openSourceButtons}>
            <Link
              className="button button--primary button--lg"
              to="https://github.com/goatplatform/goatdb"
            >
              ⭐ Star on GitHub
            </Link>
            <Link
              className="button button--outline button--secondary button--lg"
              to="https://github.com/goatplatform/goatdb/blob/main/CONTRIBUTING.md"
            >
              Contribute
            </Link>
          </div>
          <p className={styles.openSourceStats}>
            <a href="https://github.com/goatplatform/goatdb/stargazers">
              <img
                src="https://img.shields.io/github/stars/goatplatform/goatdb?style=social"
                alt="GitHub stars"
              />
            </a>{" "}
            <a href="https://github.com/goatplatform/goatdb/network/members">
              <img
                src="https://img.shields.io/github/forks/goatplatform/goatdb?style=social"
                alt="GitHub forks"
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
      <div className="container">
        <h1 className={styles.heroTitle}>GoatDB</h1>
        <p className={styles.heroSubtitle}>
          A peer-to-peer database that spans devices.
          <br />
          For apps and agents that work everywhere.
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--primary button--lg"
            to="/docs/install"
          >
            Start Building →
          </Link>
          <Link
            className="button button--outline button--secondary button--lg"
            to="/docs/architecture"
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
      title="GoatDB - Real-time database for apps and AI agents"
      description="A p2p database for collaborative apps and distributed AI agents. Cryptographically signed commits, self-healing architecture, works offline. Single binary with Deno."
    >
      <HomepageHeader />
      <main>
        <ProblemStatement />
        <HomepageFeatures />
        <QuickStart />
        <UseCases />
        <HonestTradeoff />
        <OpenSource />
      </main>
    </Layout>
  );
}
