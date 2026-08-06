import {
  ArrowDown,
  ArrowRight,
  Database,
  ServerSharp as Server,
  WindowFrameSharp as WindowFrame,
} from 'pixelarticons/react';
import { Fragment } from 'react';

import {
  PixelIcon,
  type PixelIconComponent,
} from '../PixelIcon';
import styles from './StackCollapse.module.css';

type Icon = PixelIconComponent;

const systems = [
  { icon: WindowFrame, label: 'Client Application' },
  { icon: Server, label: 'API Server' },
  { icon: Database, label: 'Database Server' },
] as const;

const protocols = ['HTTP/REST', 'SQL/TCP'] as const;

const benefits = [
  'Zero Config',
  'Low Latency',
  'Self-Contained',
  'Run Anywhere',
] as const;

// Filled square (blocky law: no circles), primary-colored to match the icon.

function SystemBox(
  { icon, label, badge }: { icon: Icon; label: string; badge: string },
) {
  return (
    <div className={styles.systemBox}>
      <PixelIcon icon={icon} />
      <span className={styles.boxLabel}>{label}</span>
      <span className={styles.badge}>{badge}</span>
    </div>
  );
}

function ProtocolLink({ label }: { label: string }) {
  return (
    <div className={styles.protocol}>
      <PixelIcon icon={ArrowDown} size={16} />
      <span>{label}</span>
    </div>
  );
}

function FrameCaption({ children }: { children: string }) {
  return <p className={styles.frameCaption}>{children}</p>;
}

function FrameSeparated() {
  return (
    <article className={styles.frame}>
      <FrameCaption>Traditional stack</FrameCaption>
      <SystemBox {...systems[0]} badge='1' />
      <ProtocolLink label={protocols[0]} />
      <SystemBox {...systems[1]} badge='2' />
      <ProtocolLink label={protocols[1]} />
      <SystemBox {...systems[2]} badge='3' />
      <p className={styles.frameFooter}>3 deployments · config · latency</p>
    </article>
  );
}

function EmbeddedStack() {
  return (
    <div className={styles.embeddedStack}>
      {systems.map((system, index) => (
        <Fragment key={system.label}>
          {index > 0 && <span className={styles.plus}>+</span>}
          <PixelIcon icon={system.icon} />
        </Fragment>
      ))}
    </div>
  );
}

function FrameUnified() {
  return (
    <article className={styles.frame}>
      <FrameCaption>GoatDB executable</FrameCaption>
      <div className={styles.unified}>
        <div className={styles.unifiedHeader}>
          <h3 className={styles.unifiedTitle}>Single Executable</h3>
        </div>
        <EmbeddedStack />
        <ul className={styles.benefits}>
          {benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
        </ul>
      </div>
    </article>
  );
}

function FrameConnector() {
  return (
    <li className={styles.connector} aria-hidden='true'>
      <PixelIcon icon={ArrowRight} />
    </li>
  );
}

// Static before/after pair: three deployed systems on the left, the single
// GoatDB executable on the right. Bare columns (no frame chrome — inner boxes
// carry the blocky styling; containers within containers are redundant).
// DOM (not SVG) so columns reflow on mobile and text stays selectable — the
// shared <Diagram> wrapper is SVG-centric and intentionally not used here.
export default function StackCollapse() {
  return (
    <figure className={styles.figure}>
      <ol className={styles.frames}>
        <li className={styles.frameCell}>
          <FrameSeparated />
        </li>
        <FrameConnector />
        <li className={styles.frameCell}>
          <FrameUnified />
        </li>
      </ol>
      <figcaption className={styles.figureCaption}>
        Three deployed systems collapse into one executable — client, server,
        and database embed as a single stack.
      </figcaption>
    </figure>
  );
}
