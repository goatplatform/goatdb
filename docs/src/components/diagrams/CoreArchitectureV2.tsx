import {
  CpuSharp,
  Database,
  GitBranchSharp,
  GitMergeSharp,
  ModemSharp,
  WindowFrameSharp,
} from 'pixelarticons/react';

import {
  PixelIcon,
  type PixelIconComponent,
} from '../PixelIcon';
import styles from './CoreArchitectureV2.module.css';

type Layer = {
  icon: PixelIconComponent;
  heading: string;
  body: string;
  data: string;
};

const layers: Layer[] = [
  {
    icon: WindowFrameSharp,
    heading: 'React Integration',
    body: 'Hooks for client applications',
    data: 'useQuery • useItem',
  },
  {
    icon: Database,
    heading: 'Database Core',
    body: 'Main GoatDB API, Sessions, ManagedItems',
    data: 'GoatDB • Sessions',
  },
  {
    icon: GitBranchSharp,
    heading: 'Repository System',
    body: 'Commits, Queries, Version Control',
    data: 'Commits → Queries',
  },
  {
    icon: GitMergeSharp,
    heading: 'Conflict Resolution',
    body: 'Schemas and deterministic structural merge',
    data: '3-way merge',
  },
  {
    icon: ModemSharp,
    heading: 'Networking Layer',
    body: 'HTTP Client/Server Sync, Bloom Filters',
    data: 'Commit-graph sync • P2P planned',
  },
  {
    icon: CpuSharp,
    heading: 'Runtime Abstraction',
    body: 'Platform APIs, Persistence, Workers',
    data: 'Deno • Node • Browser',
  },
];

// Badge carries the ordering story: OPT = optional layer, 1-5 = stack depth.
// Primary fill because the sequence is the diagram's point (mirrors
// StackCollapse's deployment-count badges).
function LayerBadge({ index }: { index: number }) {
  return <span className={styles.badge}>{index === 0 ? 'OPT' : index}</span>;
}

function LayerRow({ layer, index }: { layer: Layer; index: number }) {
  return (
    <li className={styles.row}>
      <div className={styles.identity}>
        <PixelIcon icon={layer.icon} size={20} />
        <LayerBadge index={index} />
        <h3 className={styles.heading}>{layer.heading}</h3>
      </div>
      <span className={styles.desc}>{layer.body}</span>
      <span className={styles.data}>{layer.data}</span>
    </li>
  );
}

// Ledger layout: each row is a single line spread across the full figure
// width -- identity (icon + badge + pixel heading) left, description mid,
// mono data label at the right edge like a register entry. One loud element
// per row (the heading); icons stay neutral so badges keep the accent. DOM
// (not SVG) so rows reflow on mobile and text stays selectable -- the shared
// <Diagram> wrapper is SVG-centric and intentionally not used here.
export default function CoreArchitectureV2() {
  return (
    <figure className={styles.figure}>
      <ol className={styles.layers}>
        {layers.map((layer, index) => (
          <LayerRow key={layer.heading} layer={layer} index={index} />
        ))}
      </ol>
      <figcaption className={styles.figureCaption}>
        Each layer builds on the ones below. React Integration is optional.
      </figcaption>
    </figure>
  );
}
