import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import useBrokenLinks from '@docusaurus/useBrokenLinks';
import {
  ArrowRight,
  Check,
  Circle,
  ComputerSharp as Computer,
  CopySharp as Copy,
  Database,
  ExternalLinkSharp as ExternalLink,
  FolderSharp as Folder,
  GitMergeSharp as GitMerge,
  Pencil,
  ReloadSharp as Reload,
  ServerSharp as Server,
  SmartphoneSharp as Smartphone,
  TerminalSharp as Terminal,
  UserSharp as User,
  WindowFrameSharp as WindowFrame,
} from 'pixelarticons/react';
import Layout from '@theme/Layout';
import { type ReactNode, useState } from 'react';

import { type CtaButtonData, CtaButtons } from '../components/CtaButtons';
import {
  PixelIcon,
  type PixelIconComponent,
} from '../components/PixelIcon';
import styles from './index.module.css';

type Icon = PixelIconComponent;
type IconItem = { icon: Icon; title: string; text: string };
type JourneyStopData = {
  icon: Icon;
  statusIcon: Icon;
  status: string;
  surface: string;
};

const initCommand = 'npx -y @goatdb/goatdb init';
const githubUrl = 'https://github.com/goatplatform/goatdb';
const licenseUrl = `${githubUrl}/blob/main/LICENSE`;
const heroTitle = 'Build live tools people and agents run together';
const heroSummary =
  'GoatDB gives browsers and agent runtimes local, reactive state that synchronizes through one coordinating server—so you can build the workflow instead of assembling its shared-state platform.';
const architectureIntro = {
  eyebrow: 'Architecture compression',
  title: 'Years of platform work, collapsed into the application',
  text:
    'Realtime collaboration usually means stitching together storage, APIs, offline replay, synchronization, merge, provenance, recovery, and operations. GoatDB integrates that shared-state burden into a single deployable application/server binary.',
};
// One persistent item id repeated in every stop: the hero's proof that a single
// state object travels across surfaces rather than three separate copies.
const journeyItemId = 'field-report-07';

// Status word carries the actor: the human+agent alternation is the story.
// All three stops wear the same plain tile -- the mesh bar below already
// carries the primary, and the stops are peers, not a hero with sidekicks.
const journeyStops = [
  {
    icon: Computer,
    statusIcon: Circle,
    status: 'you flagged',
    surface: 'browser',
  },
  {
    icon: Server,
    statusIcon: Reload,
    status: 'agent drafting',
    surface: 'agent runtime',
  },
  {
    icon: Smartphone,
    statusIcon: Check,
    status: 'you confirmed',
    surface: 'phone',
  },
] satisfies readonly JourneyStopData[];

const heroCtas = [
  {
    icon: ArrowRight,
    label: 'Build with your agent',
    to: '/docs/install',
    variant: 'primary',
  },
] satisfies readonly CtaButtonData[];

const closeCtas = [
  {
    icon: ArrowRight,
    label: 'Build with your agent',
    to: '/docs/install',
    variant: 'primary',
  },
  {
    icon: ExternalLink,
    label: 'View on GitHub',
    to: githubUrl,
    variant: 'secondary',
  },
] satisfies readonly CtaButtonData[];

const possibilities: IconItem[] = [
  {
    icon: WindowFrame,
    title: 'Live dashboards',
    text:
      "Admin panels, dispatch boards, and metrics that re-render the moment data changes—queries push to the screen; sync pulls in everyone's edits.",
  },
  {
    icon: Check,
    title: 'Approval queues',
    text:
      'Requests with statuses, owners, and an attributable record of who approved what—teammate or agent.',
  },
  {
    icon: User,
    title: 'Shift boards',
    text:
      "One live roster the whole crew checks from their phones; swaps route through a manager's approval and reach every device moments later.",
  },
  {
    icon: Smartphone,
    title: 'Field apps that work offline',
    text:
      'Inspections, job capture, and sign-offs with zero signal; the phone holds the truth and syncs when coverage returns.',
  },
  {
    icon: Folder,
    title: 'Offline-first utilities',
    text:
      'Checklists, budgets, and trackers that open instantly, keep working offline, and sync when connected.',
  },
  {
    icon: Terminal,
    title: 'Agent teams',
    text:
      'Several agents divide the work, each with its own permissions, every action attributable; people steer and approve from any device.',
  },
];

const platformLayers: IconItem[] = [
  { icon: Database, title: 'Database', text: 'Persistence and indexes' },
  { icon: Server, title: 'API layer', text: 'Access and transport' },
  { icon: Reload, title: 'Realtime sync', text: 'Fan-out and replay' },
  { icon: WindowFrame, title: 'Offline state', text: 'Local reads and writes' },
  { icon: GitMerge, title: 'Merge logic', text: 'Concurrent changes' },
  { icon: Pencil, title: 'Audit history', text: 'Attributable mutations' },
  { icon: Folder, title: 'Recovery', text: 'History and restoration' },
  { icon: Terminal, title: 'Operations', text: 'Deploy and maintain' },
];

const builderResponsibilities: IconItem[] = [
  {
    icon: WindowFrame,
    title: 'Experience',
    text: 'UI, domain model, and product behavior',
  },
  {
    icon: User,
    title: 'Identity',
    text: 'Map real actors to application sessions',
  },
  {
    icon: Terminal,
    title: 'Agents',
    text: 'Orchestration, tools, retries, and guardrails',
  },
  {
    icon: Pencil,
    title: 'Policy',
    text: 'Approval semantics and human checkpoints',
  },
];

const goatResponsibilities: IconItem[] = [
  {
    icon: Database,
    title: 'Local state',
    text: 'Persistence and reactive in-process queries',
  },
  {
    icon: Reload,
    title: 'Synchronization',
    text: 'Authorized server-coordinated repository sync',
  },
  {
    icon: GitMerge,
    title: 'History',
    text: 'Structural merge and signed secure-mode commits',
  },
  {
    icon: Server,
    title: 'Shared-state server',
    text: 'Access checks, persistence, and repository isolation',
  },
];

const sharedWorkCapabilities: IconItem[] = [
  {
    icon: Folder,
    title: 'Focused repositories',
    text: 'Organize each workflow into a fast, predictable local working set.',
  },
  {
    icon: User,
    title: 'Continuous collaboration',
    text: 'People and agents revisit and update the same live state.',
  },
  {
    icon: Reload,
    title: 'Local-first work',
    text: 'Keep working locally while synchronization catches up.',
  },
  {
    icon: Pencil,
    title: 'Verifiable history',
    text: 'Secure-mode changes are tied to cryptographic signing sessions.',
  },
];

const instantReadChoices = [
  'Every opened repository is a memory-resident local replica, making reads instant and independent of network latency. Bounded repositories keep that performance predictable.',
  'A predicate scans the working set when first opened, then stays live as data changes—ideal for interactive views, monitoring, collaborative apps, and agents.',
  'Remote updates currently converge in around 700–1000ms. Faster synchronization is actively in development.',
  'Every secure commit is cryptographically signed, giving collaborative apps and agents verifiable writes by default.',
];

const speedStats = [
  { value: '1.5µs', label: 'reads' },
  { value: '7µs', label: 'writes' },
  { value: '<0.1µs', label: 'live query results' },
  { value: '~650ms, once', label: 'opening 100k items' },
] as const;

function usePageAnchor(id: string) {
  useBrokenLinks().collectAnchor(id);
}

function TextLink(
  { children, to, className = '' }: {
    children: ReactNode;
    to: string;
    className?: string;
  },
) {
  return (
    <Link className={`${styles.textLink} ${className}`} to={to}>
      {children}
      <PixelIcon icon={ArrowRight} />
    </Link>
  );
}

function HomepageHeader() {
  return (
    <header className={styles.heroBanner}>
      <div className={`container ${styles.heroLayout}`}>
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>{heroTitle}</h1>
          <p className={styles.heroSummary}>{heroSummary}</p>
          <div className={styles.heroActions}>
            <CtaButtons ctas={heroCtas} ariaLabel='Build with GoatDB' />
            <TextLink className={styles.heroSecondary} to='/docs/architecture'>
              GoatDB Architecture
            </TextLink>
          </div>
        </div>
        <HeroJourneyPreview />
      </div>
    </header>
  );
}

function SectionIntro(
  { eyebrow, title, text }: { eyebrow: string; title: string; text: ReactNode },
) {
  return (
    <header className={styles.sectionIntro}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h2>{title}</h2>
      <p>{text}</p>
    </header>
  );
}

function IconCard({ item, className }: { item: IconItem; className: string }) {
  return (
    <article className={className}>
      <PixelIcon icon={item.icon} />
      <h3>{item.title}</h3>
      <p>{item.text}</p>
    </article>
  );
}

function IconCardGrid(
  { items, className, cardClassName }: {
    items: readonly IconItem[];
    className: string;
    cardClassName: string;
  },
) {
  return (
    <div className={className}>
      {items.map((item) => (
        <IconCard key={item.title} item={item} className={cardClassName} />
      ))}
    </div>
  );
}

// Inline mark that defines "one shared state" at the point of claim.
// Two imgs swapped by theme CSS (ThemedImage renders one img here, breaking
// dark-mode contrast). dark.svg = light-mode artwork.
function SharedStateMark() {
  return (
    <>
      <img
        alt='GoatDB'
        className={styles.sharedStateMark}
        src={useBaseUrl('img/goatdb_mark_dark.svg')}
      />
      <img
        alt=''
        aria-hidden='true'
        className={`${styles.sharedStateMark} ${styles.sharedStateMarkDark}`}
        src={useBaseUrl('img/goatdb_mark_light.svg')}
      />
    </>
  );
}

function PossibilityGallery() {
  return (
    <section className={`${styles.section} ${styles.possibilities}`}>
      <div className='container'>
        <SectionIntro
          eyebrow='What becomes practical'
          title='Build the tool your work needs'
          text={
            <>
              Dashboards, approvals, rosters, and field apps—many tools over one
              shared state{' '}
              <SharedStateMark />, live for people and agents alike.
            </>
          }
        />
        <IconCardGrid
          items={possibilities}
          className={styles.possibilityGrid}
          cardClassName={styles.possibilityCard}
        />
      </div>
    </section>
  );
}

function IconListItem(
  { item, className }: { item: IconItem; className?: string },
) {
  return (
    <li className={className}>
      <PixelIcon icon={item.icon} />
      <span>
        <strong>{item.title}</strong>
        <small>{item.text}</small>
      </span>
    </li>
  );
}

function TraditionalStack() {
  return (
    <div className={styles.traditionalStack}>
      <p className={styles.stackLabel}>The conventional platform project</p>
      <h3>Specialized systems to build, connect, and operate</h3>
      <ul className={styles.platformLayerGrid}>
        {platformLayers.map((item) => (
          <IconListItem
            key={item.title}
            item={item}
            className={styles.platformLayer}
          />
        ))}
      </ul>
    </div>
  );
}

function CompressionArrow() {
  return (
    <div className={styles.compressionArrow} aria-hidden='true'>
      <PixelIcon icon={ArrowRight} size={32} />
      <span>compress</span>
    </div>
  );
}

function GoatSystem() {
  return (
    <Link
      className={styles.goatSystem}
      to='/docs/cli#build--development-apis'
    >
      <p className={styles.stackLabel}>The GoatDB path</p>
      <img
        src='/img/goatdb_mark_dark.svg'
        alt='GoatDB'
        className={styles.goatSystemLogo}
        width={48}
        height={48}
      />
      <img
        src='/img/goatdb_mark_light.svg'
        alt='GoatDB'
        className={styles.goatSystemLogoDark}
        width={48}
        height={48}
      />
      <h3>One deployable shared-state system</h3>
      <p>
        Local repositories, reactive queries, authorization, sync, merge, signed
        history, persistence, and bounded replica-assisted recovery.
      </p>
      <small>
        The application, server, and browser client are bundled and served
        together for simple deployments, rollbacks, and updates.
      </small>
    </Link>
  );
}

function StackCompression() {
  return (
    <figure className={styles.compressionFigure}>
      <div className={styles.compressionGrid}>
        <TraditionalStack />
        <CompressionArrow />
        <GoatSystem />
      </div>
    </figure>
  );
}

function ResponsibilityPanel(
  { title, items, variant = 'default' }: {
    title: string;
    items: readonly IconItem[];
    variant?: 'default' | 'primary';
  },
) {
  const className = [
    styles.responsibilityCard,
    variant === 'primary' && styles.responsibilityCardPrimary,
  ].filter(Boolean).join(' ');
  return (
    <article className={className}>
      <h3>{title}</h3>
      <IconList items={items} />
    </article>
  );
}

function IconList({ items }: { items: readonly IconItem[] }) {
  return (
    <ul className={styles.iconList}>
      {items.map((item) => <IconListItem key={item.title} item={item} />)}
    </ul>
  );
}

function ResponsibilitySplit() {
  return (
    <div className={styles.responsibilityGrid}>
      <ResponsibilityPanel
        title='You still own the application'
        items={builderResponsibilities}
      />
      <ResponsibilityPanel
        title='GoatDB owns the shared-state mechanics'
        items={goatResponsibilities}
        variant='primary'
      />
    </div>
  );
}

function ArchitectureCompression() {
  usePageAnchor('architecture');
  return (
    <section
      className={`${styles.section} ${styles.architecture}`}
      id='architecture'
    >
      <div className='container'>
        <SectionIntro {...architectureIntro} />
        <StackCompression />
        <ResponsibilitySplit />
        <TextLink to='/docs/architecture'>
          Read the architecture and isolation details
        </TextLink>
      </div>
    </section>
  );
}

function JourneyStop({ icon, statusIcon, status, surface }: JourneyStopData) {
  return (
    <div className={styles.journeyStop}>
      <PixelIcon icon={icon} size={28} />
      <span className={styles.journeySurface}>{surface}</span>
      <span className={styles.journeyChip}>
        <span className={styles.journeyStatus}>
          <PixelIcon icon={statusIcon} size={12} />
          {status}
        </span>
        <code>{journeyItemId}</code>
      </span>
    </div>
  );
}

function JourneyFlow() {
  return (
    <div className={styles.journeyFlow}>
      {journeyStops.map((stop) => <JourneyStop key={stop.status} {...stop} />)}
    </div>
  );
}

// The logo lockup bar is the state layer: every surface stems down to GoatDB.
// Two imgs swapped by theme CSS (ThemedImage renders one img here, breaking
// dark-mode contrast).
function JourneyMesh() {
  return (
    <div className={styles.journeyMesh}>
      <img
        alt='GoatDB'
        className={styles.journeyMeshLogo}
        src={useBaseUrl('img/goatdb_logo_dark.svg')}
      />
      <img
        alt=''
        aria-hidden='true'
        className={`${styles.journeyMeshLogo} ${styles.journeyMeshLogoDark}`}
        src={useBaseUrl('img/goatdb_logo_light.svg')}
      />
    </div>
  );
}

function HeroJourneyPreview() {
  return (
    <div className={styles.heroJourney}>
      <JourneyFlow />
      <JourneyMesh />
    </div>
  );
}

function BulletList({ items }: { items: readonly string[] }) {
  return (
    <ul className={styles.squareList}>
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

function SharedWorkPanel() {
  return (
    <article className={styles.fitPanel}>
      <h3>Made for shared work</h3>
      <IconList items={sharedWorkCapabilities} />
    </article>
  );
}

function InstantReadChoices() {
  return (
    <article className={styles.limitsPanel}>
      <h3>Built for instant, live apps</h3>
      <BulletList items={instantReadChoices} />
      <p>
        One focused data layer for building small, reactive, collaborative apps
        quickly—without assembling a database stack.
      </p>
    </article>
  );
}

function SpeedStat({ value, label }: { value: string; label: string }) {
  return (
    <div className={styles.speedStat}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

// The section's single highlight (highlight rule): the honest, like-for-like
// point-read factor is the claim everything else supports.
function SpeedFactor() {
  return (
    <Link className={styles.speedFactor} to='/docs/benchmarks#browser'>
      <strong>300×</strong>
      <span>faster reads than SQLite in the browser</span>
      <small>7× on the server. Measured, same machine, reproducible.</small>
    </Link>
  );
}

function SpeedProof() {
  return (
    <div className={styles.speedProof}>
      <div className={styles.speedRow}>
        <SpeedFactor />
        <div className={styles.speedStats}>
          {speedStats.map((stat) => <SpeedStat key={stat.label} {...stat} />)}
        </div>
      </div>
      <TextLink to='/docs/benchmarks'>
        Hardware, workload, and methodology
      </TextLink>
    </div>
  );
}

function FitEvidence() {
  return (
    <section className={`${styles.section} ${styles.fitEvidence}`}>
      <div className='container'>
        <SectionIntro
          eyebrow='Measured speed'
          title='One loader. Then nothing ever loads'
          text="Apps where nothing ever spins are usually out of reach—they take an architecture most teams can't afford to build. GoatDB makes it the default: each repository loads once, the way a desktop app opens a document, and from then on every read, write, and screen update runs at memory speed—the same in the browser as on the server. No per-interaction spinners, no optimistic-state machinery, no cache tier to maintain."
        />
        <SpeedProof />
        <div className={styles.fitGrid}>
          <SharedWorkPanel />
          <InstantReadChoices />
        </div>
      </div>
    </section>
  );
}

/* The card itself is the copy target: one press area, the icon is the
 * affordance and flips to a check as feedback. Plain <code>, not CodeBlock:
 * a single plain-token shell line needs no Prism, and dropping CodeBlock
 * removes Docusaurus's hover-only copy button entirely. */
function InitCommand() {
  const [copied, setCopied] = useState(false);
  const copyInit = async () => {
    await navigator.clipboard.writeText(initCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type='button'
      className={styles.initCommand}
      onClick={copyInit}
      aria-label='Copy init command'
      title='Copy init command'
    >
      <code>{initCommand}</code>
      <PixelIcon icon={copied ? Check : Copy} />
    </button>
  );
}

function OpenSource() {
  return (
    <section className={styles.openSource}>
      <div className='container'>
        <p className={styles.eyebrow}>
          <Link to={githubUrl}>Open source</Link> ·{' '}
          <Link to={licenseUrl}>MIT licensed</Link>
        </p>
        <h2>Start with shared state, then shape the app around your work</h2>
        <p>
          Initialize a project, connect the people and agents your workflow
          needs, and keep the whole shared-state plane in code you can inspect.
        </p>
        <InitCommand />
        <CtaButtons ctas={closeCtas} ariaLabel='Build with GoatDB' />
      </div>
    </section>
  );
}

export default function Home(): React.JSX.Element {
  return (
    <Layout
      title='GoatDB — Realtime shared state for people and agents'
      description='Build realtime human-agent apps with local, reactive, synchronized shared state—without assembling a distributed platform first.'
    >
      <main>
        <HomepageHeader />
        <PossibilityGallery />
        <ArchitectureCompression />
        <FitEvidence />
        <OpenSource />
      </main>
    </Layout>
  );
}
