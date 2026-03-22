import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import QuickStart from '@site/src/components/QuickStart';

import styles from './index.module.css';

function HomepageHeader() {
  return (
    <header className={styles.heroBanner}>
      <div className='container'>
        <h1 className={styles.heroTitle}>
          <img
            src='/img/goatdb_hero_dark.svg'
            alt='GoatDB'
            className={styles.heroLogo}
            width={420}
            height={112}
          />
          <img
            src='/img/goatdb_hero_light.svg'
            alt='GoatDB'
            className={styles.heroLogoDark}
            width={420}
            height={112}
          />
        </h1>
        <p className={styles.heroSubtitle}>
          GoatDB reads from memory on every device.
          <br />
          Your AI agent thinks at microsecond speed &mdash; no round-trips, no
          waiting.
        </p>
        <p className={styles.heroSpecs}>
          GoatDB reads from memory &mdash; 300&times; faster than SQLite in the
          browser.
          <br />
          Queries update live as data changes. Syncs automatically. Every write
          cryptographically signed.
        </p>
        <div className={styles.buttons}>
          <Link
            className='button button--primary button--lg'
            to='/docs/install'
          >
            Get Started →
          </Link>
          <Link
            className='button button--outline button--secondary button--lg'
            to='#quickstart'
          >
            See how it works
          </Link>
        </div>
      </div>
    </header>
  );
}

function TheSplit() {
  return (
    <section className={styles.theSplit}>
      <div className='container'>
        <h2>GoatDB combines the best of both worlds.</h2>
        <div className={styles.splitCards}>
          <div className={styles.splitCard}>
            <p className={styles.splitCardTitle}>Remote databases</p>
            <p className={styles.splitCardSubtitle}>
              PostgreSQL, MySQL, DynamoDB
            </p>
            <p>
              Shared across devices with strong consistency. Designed for
              centralized workloads where all clients connect to one server.
            </p>
          </div>
          <div className={styles.splitCard}>
            <p className={styles.splitCardTitle}>Embedded databases</p>
            <p className={styles.splitCardSubtitle}>SQLite, LevelDB, RocksDB</p>
            <p>
              Fast reads, no network. Designed for single-device workloads where
              data stays local to one process.
            </p>
          </div>
        </div>
        <p className={styles.bridgeText}>
          AI agents reason locally, run on any device, and collaborate across
          instances. They need both: local speed and shared state. That&apos;s
          GoatDB.
        </p>
      </div>
    </section>
  );
}

function ServerIcon({ clsSrv, clsRack }: { clsSrv: string; clsRack: string }) {
  return (
    <>
      {/* Chassis */}
      <rect x='0' y='0' width='48' height='44' className={clsSrv} />
      {/* Rack unit 1 — y=4..14 */}
      <rect x='4' y='4' width='40' height='10' className={clsSrv} />
      <rect x='7' y='7' width='3' height='3' className={clsRack} />
      <rect x='12' y='7' width='3' height='3' className={clsRack} />
      <rect x='18' y='8' width='22' height='2' className={clsRack} />
      {/* Rack unit 2 — y=17..27 */}
      <rect x='4' y='17' width='40' height='10' className={clsSrv} />
      <rect x='7' y='20' width='3' height='3' className={clsRack} />
      <rect x='12' y='20' width='3' height='3' className={clsRack} />
      <rect x='18' y='21' width='22' height='2' className={clsRack} />
      {/* Rack unit 3 — y=30..40 */}
      <rect x='4' y='30' width='40' height='10' className={clsSrv} />
      <rect x='7' y='33' width='3' height='3' className={clsRack} />
      <rect x='12' y='33' width='3' height='3' className={clsRack} />
      <rect x='18' y='34' width='22' height='2' className={clsRack} />
    </>
  );
}

function LaptopIcon({ cls }: { cls: string }) {
  return (
    <>
      <rect x='2' y='0' width='36' height='22' className={cls} />
      <rect x='0' y='22' width='40' height='4' className={cls} />
    </>
  );
}

function PhoneIcon({ cls }: { cls: string }) {
  return (
    <>
      <polygon
        points='3 0, 17 0, 20 3, 20 29, 17 32, 3 32, 0 29, 0 3'
        className={cls}
      />
      <polygon points='10 3, 13 6, 10 9, 7 6' className={cls} />
    </>
  );
}

function DbIcon({
  cls,
  x,
  y,
  w,
  h,
}: {
  cls: string;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  const c = Math.max(2, Math.round(w * 0.2)); // chamfer size for pixel-art corners
  const shelf = y + Math.round(h * 0.35);
  // Single hexagonal outline (chamfered top + bottom corners) + shelf line
  const outline = [
    `${x + c},${y}`,
    `${x + w - c},${y}`,
    `${x + w},${y + c}`,
    `${x + w},${y + h - c}`,
    `${x + w - c},${y + h}`,
    `${x + c},${y + h}`,
    `${x},${y + h - c}`,
    `${x},${y + c}`,
  ].join(' ');
  return (
    <g shapeRendering='crispEdges'>
      <polygon points={outline} className={cls} />
      <line
        x1={x}
        y1={shelf}
        x2={x + w}
        y2={shelf}
        className={cls}
        style={{ fill: 'none' }}
      />
    </g>
  );
}

function LaptopFigure({ cls, clsDb }: { cls: string; clsDb?: string }) {
  return (
    <>
      <LaptopIcon cls={cls} />
      {clsDb && <DbIcon cls={clsDb} x={14} y={5} w={12} h={12} />}
    </>
  );
}

function PhoneFigure({ cls, clsDb }: { cls: string; clsDb?: string }) {
  return (
    <>
      <PhoneIcon cls={cls} />
      {clsDb && <DbIcon cls={clsDb} x={5} y={14} w={10} h={12} />}
    </>
  );
}

function ServerFigure({
  clsSrv,
  clsRack,
  clsDb,
}: {
  clsSrv: string;
  clsRack: string;
  clsDb?: string;
}) {
  return (
    <>
      <ServerIcon clsSrv={clsSrv} clsRack={clsRack} />
      {clsDb && <DbIcon cls={clsDb} x={18} y={14} w={12} h={12} />}
    </>
  );
}

function ThirdCategory() {
  return (
    <section className={styles.thirdCategory} id='third-category'>
      {/* Shared SVG markers for topology arrows */}
      <svg width='0' height='0' style={{ position: 'absolute' }}>
        <defs>
          <marker
            id='topo-fwd'
            markerUnits='userSpaceOnUse'
            markerWidth='6'
            markerHeight='4'
            refX='0'
            refY='2'
            orient='auto'
          >
            <polygon
              points='0 0, 6 2, 0 4'
              fill='var(--ifm-color-primary-light)'
            />
          </marker>
          <marker
            id='topo-fwd-p'
            markerUnits='userSpaceOnUse'
            markerWidth='6'
            markerHeight='4'
            refX='0'
            refY='2'
            orient='auto'
          >
            <polygon points='0 0, 6 2, 0 4' fill='var(--ifm-color-primary)' />
          </marker>
          <marker
            id='topo-rev-p'
            markerUnits='userSpaceOnUse'
            markerWidth='6'
            markerHeight='4'
            refX='6'
            refY='2'
            orient='auto'
          >
            <polygon points='6 0, 0 2, 6 4' fill='var(--ifm-color-primary)' />
          </marker>
        </defs>
      </svg>
      <div className='container'>
        <div className={styles.thirdCategoryContent}>
          <div className={styles.thirdCategoryText}>
            <h2>Local speed. Shared state. One key to protect.</h2>
            <p>
              Data lives in memory on every device. Reads run at microsecond
              speed &mdash; no network, no disk. Changes sync through the server
              automatically. Conflicts resolve with Git-style three-way merge at
              the field level. Every write is cryptographically signed with
              Ed25519.
            </p>
            <p>
              Like Git, the server coordinates &mdash; but every client holds
              the full commit graph. If the server crashes, any client restores
              it. The only thing the operator protects is the root key. Scale
              horizontally by adding repositories &mdash; each one syncs,
              persists, and fails independently.
            </p>
          </div>
          <div className={styles.thirdCategoryChart}>
            <div className={styles.topologyPanels}>
              {/* Panel 1: Remote */}
              <div className={styles.topologyPanel}>
                <div className={styles.topologyHeader}>
                  <span className={styles.topologyTitle}>Remote</span>
                  <span className={styles.topologySubtitle}>
                    PostgreSQL, MySQL
                  </span>
                </div>
                <div className={styles.topologyScene}>
                  <svg viewBox='0 0 280 72' xmlns='http://www.w3.org/2000/svg'>
                    {/* Laptop left */}
                    <g
                      transform='translate(16, 23)'
                      shapeRendering='crispEdges'
                    >
                      <LaptopFigure cls={styles.svgDeviceDim} />
                    </g>
                    {/* Server center */}
                    <g
                      transform='translate(116, 14)'
                      shapeRendering='crispEdges'
                    >
                      <ServerFigure
                        clsSrv={styles.svgServerDim}
                        clsRack={styles.svgRackDim}
                      />
                    </g>
                    {/* Phone right */}
                    <g
                      transform='translate(244, 20)'
                      shapeRendering='crispEdges'
                    >
                      <PhoneFigure cls={styles.svgDeviceDim} />
                    </g>
                    {/* Arrow: laptop → server */}
                    <line
                      x1='56'
                      y1='36'
                      x2='110'
                      y2='36'
                      className={styles.svgArrow}
                      markerEnd='url(#topo-fwd)'
                    />
                    {/* Arrow: phone → server */}
                    <line
                      x1='244'
                      y1='36'
                      x2='170'
                      y2='36'
                      className={styles.svgArrow}
                      markerEnd='url(#topo-fwd)'
                    />
                  </svg>
                </div>
                <span className={styles.topologyLabel}>
                  All reads go through the server
                  <br />
                  Devices share one central copy
                </span>
              </div>

              {/* Panel 2: Embedded */}
              <div className={styles.topologyPanel}>
                <div className={styles.topologyHeader}>
                  <span className={styles.topologyTitle}>Embedded</span>
                  <span className={styles.topologySubtitle}>
                    SQLite, LevelDB
                  </span>
                </div>
                <div className={styles.topologyScene}>
                  <svg viewBox='0 0 280 72' xmlns='http://www.w3.org/2000/svg'>
                    {/* Dimmed laptop left */}
                    <g
                      transform='translate(16, 23)'
                      shapeRendering='crispEdges'
                    >
                      <LaptopFigure
                        cls={styles.svgDeviceDimmer}
                        clsDb={styles.svgDbDimmer}
                      />
                    </g>
                    {/* Active laptop center */}
                    <g
                      transform='translate(120, 23)'
                      shapeRendering='crispEdges'
                    >
                      <LaptopFigure
                        cls={styles.svgDeviceDim}
                        clsDb={styles.svgDb}
                      />
                    </g>
                    {/* Dimmed phone right */}
                    <g
                      transform='translate(244, 20)'
                      shapeRendering='crispEdges'
                    >
                      <PhoneFigure
                        cls={styles.svgDeviceDimmer}
                        clsDb={styles.svgDbDimmer}
                      />
                    </g>
                  </svg>
                </div>
                <span className={styles.topologyLabel}>
                  Data stays on one device
                  <br />
                  Each device keeps a separate local copy
                </span>
              </div>

              {/* Panel 3: GoatDB */}
              <div
                className={`${styles.topologyPanel} ${styles.topologyPanelHighlight}`}
              >
                <div className={styles.topologyHeader}>
                  <svg
                    viewBox='0 0 18.4 25.8'
                    height='14'
                    xmlns='http://www.w3.org/2000/svg'
                    style={{
                      display: 'inline',
                      verticalAlign: 'middle',
                      marginRight: '5px',
                      flexShrink: 0,
                    }}
                  >
                    <path
                      fill='var(--ifm-color-primary)'
                      d='M1.4,3.3c-.9,0-1.4-.8-1.4-1.7S.4,0,1.4,0h4c2.3,0,3.4,2,2.3,4.4l-2.8,6.1c-.4.8-.6,1.3-.6,2.3s.3,1.7.7,2.5l3,6.2c.4.9.6,1,1.1,1s.7,0,1.1-1l3-6.2c.4-.9.7-1.4.7-2.5s-.2-1.4-.6-2.3l-2.8-6.1C9.5,2,10.6,0,12.9,0h4C17.8,0,18.4.8,18.4,1.7s-.4,1.7-1.4,1.7h-3.2l2.7,6c.5,1.1.8,2.2.8,3.5s-.3,2.4-.9,3.7l-3.2,6.5c-.9,1.8-2.3,2.8-4,2.8s-3.1-1-4-2.8l-3.2-6.5c-.6-1.3-.9-2.2-.9-3.7s.3-2.3.8-3.5l2.7-6s-3,0-3,0Z'
                    />
                  </svg>
                  <span
                    className={`${styles.topologyTitle} ${styles.topologyTitlePrimary}`}
                    style={{ position: 'relative', top: '-2px' }}
                  >
                    GoatDB
                  </span>
                </div>
                <div className={styles.topologyScene}>
                  <svg viewBox='0 0 280 72' xmlns='http://www.w3.org/2000/svg'>
                    {/* Laptop left */}
                    <g
                      transform='translate(16, 23)'
                      shapeRendering='crispEdges'
                    >
                      <LaptopFigure
                        cls={styles.svgDevice}
                        clsDb={styles.svgDb}
                      />
                    </g>
                    {/* Server center */}
                    <g
                      transform='translate(116, 14)'
                      shapeRendering='crispEdges'
                    >
                      <ServerFigure
                        clsSrv={styles.svgServer}
                        clsRack={styles.svgRack}
                      />
                    </g>
                    {/* Phone right */}
                    <g
                      transform='translate(244, 20)'
                      shapeRendering='crispEdges'
                    >
                      <PhoneFigure
                        cls={styles.svgDevice}
                        clsDb={styles.svgDb}
                      />
                    </g>
                    {/* Sync: laptop ↔ server */}
                    <line
                      x1='62'
                      y1='36'
                      x2='110'
                      y2='36'
                      className={styles.svgSyncDirect}
                      markerEnd='url(#topo-fwd-p)'
                      markerStart='url(#topo-rev-p)'
                    />
                    {/* Sync: server ↔ phone */}
                    <line
                      x1='170'
                      y1='36'
                      x2='238'
                      y2='36'
                      className={styles.svgSyncDirect}
                      markerEnd='url(#topo-fwd-p)'
                      markerStart='url(#topo-rev-p)'
                    />
                  </svg>
                </div>
                <span className={styles.topologyLabel}>
                  Every client is a full replica.
                  <br />
                  Server coordinates &mdash; clients can restore it.
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BrowserNative() {
  return (
    <section className={styles.browserNative}>
      <div className='container'>
        <div className={styles.browserNativeContent}>
          <div className={styles.browserNativeText}>
            <h2>Built for the main thread</h2>
            <p>
              GoatDB is browser-native. Query scans run as cooperative
              coroutines that yield every ~20ms &mdash; one-third of a 60fps
              frame. The scheduler picks the shortest-running task first, so UI
              interactions always win. If a scan becomes irrelevant, cancel it
              mid-flight.
            </p>
            <p>
              File I/O runs in a dedicated worker with zero-copy transfer. Query
              results persist to disk and restore on reopen &mdash; no re-scan
              on page load. On the server, the same queries run as synchronous
              loops with zero scheduling overhead.
            </p>
          </div>
          <div className={styles.topologyPanels}>
            {/* Panel 1: Traditional */}
            <div className={styles.topologyPanel}>
              <div className={styles.topologyHeader}>
                <span className={styles.topologyTitle}>TRADITIONAL</span>
                <span className={styles.topologySubtitle}>
                  long-running query
                </span>
              </div>
              <div className={styles.topologyScene}>
                <svg
                  viewBox='0 0 280 72'
                  xmlns='http://www.w3.org/2000/svg'
                  shapeRendering='crispEdges'
                >
                  {/* Large blocking query */}
                  <rect
                    x='8'
                    y='14'
                    width='192'
                    height='44'
                    className={styles.svgBlock}
                  />
                  <text
                    x='104'
                    y='39'
                    textAnchor='middle'
                    fontSize='9'
                    fontFamily='monospace'
                    fill='var(--ifm-color-emphasis-600)'
                  >
                    query
                  </text>
                  {/* Blocked UI area */}
                  <rect
                    x='208'
                    y='14'
                    width='64'
                    height='44'
                    fill='none'
                    stroke='var(--ifm-color-emphasis-400)'
                    strokeWidth='1'
                    strokeOpacity='0.5'
                  />
                  {/* UI label (gets crossed out by bar below) */}
                  <text
                    x='240'
                    y='39'
                    textAnchor='middle'
                    fontSize='9'
                    fontFamily='monospace'
                    fill='var(--ifm-color-emphasis-500)'
                  >
                    UI
                  </text>
                  {/* Strikethrough over UI */}
                  <rect
                    x='208'
                    y='35'
                    width='64'
                    height='3'
                    fill='var(--ifm-color-emphasis-500)'
                  />
                </svg>
              </div>
              <span className={styles.topologyLabel}>
                Query runs to completion
                <br />
                UI waits for the full scan
              </span>
            </div>

            {/* Panel 2: GoatDB */}
            <div
              className={`${styles.topologyPanel} ${styles.topologyPanelHighlight}`}
            >
              <div className={styles.topologyHeader}>
                <svg
                  viewBox='0 0 18.4 25.8'
                  height='14'
                  xmlns='http://www.w3.org/2000/svg'
                  style={{
                    display: 'inline',
                    verticalAlign: 'middle',
                    marginRight: '5px',
                    flexShrink: 0,
                  }}
                >
                  <path
                    fill='var(--ifm-color-primary)'
                    d='M1.4,3.3c-.9,0-1.4-.8-1.4-1.7S.4,0,1.4,0h4c2.3,0,3.4,2,2.3,4.4l-2.8,6.1c-.4.8-.6,1.3-.6,2.3s.3,1.7.7,2.5l3,6.2c.4.9.6,1,1.1,1s.7,0,1.1-1l3-6.2c.4-.9.7-1.4.7-2.5s-.2-1.4-.6-2.3l-2.8-6.1C9.5,2,10.6,0,12.9,0h4C17.8,0,18.4.8,18.4,1.7s-.4,1.7-1.4,1.7h-3.2l2.7,6c.5,1.1.8,2.2.8,3.5s-.3,2.4-.9,3.7l-3.2,6.5c-.9,1.8-2.3,2.8-4,2.8s-3.1-1-4-2.8l-3.2-6.5c-.6-1.3-.9-2.2-.9-3.7s.3-2.3.8-3.5l2.7-6s-3,0-3,0Z'
                  />
                </svg>
                <span
                  className={`${styles.topologyTitle} ${styles.topologyTitlePrimary}`}
                  style={{ position: 'relative', top: '-2px' }}
                >
                  GOATDB
                </span>
              </div>
              <div className={styles.topologyScene}>
                <svg
                  viewBox='0 0 280 72'
                  xmlns='http://www.w3.org/2000/svg'
                  shapeRendering='crispEdges'
                >
                  {/* UI slots (wide — UI gets to breathe) */}
                  <rect
                    x='8'
                    y='18'
                    width='44'
                    height='36'
                    className={styles.svgDevice}
                  />
                  <text
                    x='30'
                    y='39'
                    textAnchor='middle'
                    fontSize='8'
                    fontFamily='monospace'
                    fill='var(--ifm-color-primary)'
                  >
                    UI
                  </text>
                  <rect
                    x='76'
                    y='18'
                    width='44'
                    height='36'
                    className={styles.svgDevice}
                  />
                  <text
                    x='98'
                    y='39'
                    textAnchor='middle'
                    fontSize='8'
                    fontFamily='monospace'
                    fill='var(--ifm-color-primary)'
                  >
                    UI
                  </text>
                  <rect
                    x='144'
                    y='18'
                    width='44'
                    height='36'
                    className={styles.svgDevice}
                  />
                  <text
                    x='166'
                    y='39'
                    textAnchor='middle'
                    fontSize='8'
                    fontFamily='monospace'
                    fill='var(--ifm-color-primary)'
                  >
                    UI
                  </text>
                  {/* Narrow GoatDB yield slices between UI slots */}
                  <rect
                    x='56'
                    y='14'
                    width='16'
                    height='44'
                    className={styles.svgDb}
                  />
                  <g transform='translate(61.4, 32.4) scale(0.28)'>
                    <path
                      fill='var(--ifm-color-primary)'
                      d='M1.4,3.3c-.9,0-1.4-.8-1.4-1.7S.4,0,1.4,0h4c2.3,0,3.4,2,2.3,4.4l-2.8,6.1c-.4.8-.6,1.3-.6,2.3s.3,1.7.7,2.5l3,6.2c.4.9.6,1,1.1,1s.7,0,1.1-1l3-6.2c.4-.9.7-1.4.7-2.5s-.2-1.4-.6-2.3l-2.8-6.1C9.5,2,10.6,0,12.9,0h4C17.8,0,18.4.8,18.4,1.7s-.4,1.7-1.4,1.7h-3.2l2.7,6c.5,1.1.8,2.2.8,3.5s-.3,2.4-.9,3.7l-3.2,6.5c-.9,1.8-2.3,2.8-4,2.8s-3.1-1-4-2.8l-3.2-6.5c-.6-1.3-.9-2.2-.9-3.7s.3-2.3.8-3.5l2.7-6s-3,0-3,0Z'
                    />
                  </g>
                  <rect
                    x='124'
                    y='14'
                    width='16'
                    height='44'
                    className={styles.svgDb}
                  />
                  <g transform='translate(129.4, 32.4) scale(0.28)'>
                    <path
                      fill='var(--ifm-color-primary)'
                      d='M1.4,3.3c-.9,0-1.4-.8-1.4-1.7S.4,0,1.4,0h4c2.3,0,3.4,2,2.3,4.4l-2.8,6.1c-.4.8-.6,1.3-.6,2.3s.3,1.7.7,2.5l3,6.2c.4.9.6,1,1.1,1s.7,0,1.1-1l3-6.2c.4-.9.7-1.4.7-2.5s-.2-1.4-.6-2.3l-2.8-6.1C9.5,2,10.6,0,12.9,0h4C17.8,0,18.4.8,18.4,1.7s-.4,1.7-1.4,1.7h-3.2l2.7,6c.5,1.1.8,2.2.8,3.5s-.3,2.4-.9,3.7l-3.2,6.5c-.9,1.8-2.3,2.8-4,2.8s-3.1-1-4-2.8l-3.2-6.5c-.6-1.3-.9-2.2-.9-3.7s.3-2.3.8-3.5l2.7-6s-3,0-3,0Z'
                    />
                  </g>
                  <rect
                    x='192'
                    y='14'
                    width='16'
                    height='44'
                    className={styles.svgDb}
                  />
                  <g transform='translate(197.4, 32.4) scale(0.28)'>
                    <path
                      fill='var(--ifm-color-primary)'
                      d='M1.4,3.3c-.9,0-1.4-.8-1.4-1.7S.4,0,1.4,0h4c2.3,0,3.4,2,2.3,4.4l-2.8,6.1c-.4.8-.6,1.3-.6,2.3s.3,1.7.7,2.5l3,6.2c.4.9.6,1,1.1,1s.7,0,1.1-1l3-6.2c.4-.9.7-1.4.7-2.5s-.2-1.4-.6-2.3l-2.8-6.1C9.5,2,10.6,0,12.9,0h4C17.8,0,18.4.8,18.4,1.7s-.4,1.7-1.4,1.7h-3.2l2.7,6c.5,1.1.8,2.2.8,3.5s-.3,2.4-.9,3.7l-3.2,6.5c-.9,1.8-2.3,2.8-4,2.8s-3.1-1-4-2.8l-3.2-6.5c-.6-1.3-.9-2.2-.9-3.7s.3-2.3.8-3.5l2.7-6s-3,0-3,0Z'
                    />
                  </g>
                  {/* Idle zone */}
                  <rect
                    x='212'
                    y='14'
                    width='60'
                    height='44'
                    fill='none'
                    stroke='var(--ifm-color-emphasis-300)'
                    strokeWidth='1'
                    strokeDasharray='4 2'
                  />
                </svg>
              </div>
              <span className={styles.topologyLabel}>
                Tasks yield every ~20ms
                <br />
                UI stays responsive between chunks
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HonestTradeoff() {
  return (
    <section className={styles.honestTradeoff}>
      <div className='container'>
        <div className={styles.honestTradeoffContent}>
          <h2>Where GoatDB fits</h2>
          <p>
            GoatDB loads the full repository into memory at open time &mdash;
            under a second for 100k items. After that one-time cost, reads
            complete in ~1&micro;s. Each write is individually signed with
            Ed25519, so bulk inserts trade throughput for cryptographic
            attribution &mdash; ~16&times; slower than unsigned SQLite writes.
            Instead of SQL joins, GoatDB uses predicate-based queries that
            subscribe to changes and update incrementally.
          </p>
          <p>
            GoatDB is built for apps that AI tools scaffold in one prompt and
            agents that run on any device. For SQL analytics, pair it with
            PostgreSQL. For warehousing, pair it with ClickHouse &mdash; GoatDB
            handles the local-first layer.
          </p>
          <Link to='/docs/benchmarks'>See the full benchmarks →</Link>
        </div>
      </div>
    </section>
  );
}

function OpenSource() {
  return (
    <section className={styles.openSource}>
      <div className='container'>
        <div className={styles.openSourceContent}>
          <h2>Open source. MIT licensed. Built in public.</h2>
          <p className={styles.openSourceDescription}>
            GoatDB is built in public. The binary commit format, custom binary
            codec, and P2P sync protocol are all shipping now. Here&apos;s
            what&apos;s next &mdash; and where your help matters most.
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
              to='/docs/contributing'
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

export default function Home(): JSX.Element {
  return (
    <Layout
      title='GoatDB — Local-first distributed database for the AI era'
      description='GoatDB reads from memory — 300× faster than SQLite in the browser. Syncs automatically. Every write cryptographically signed. Local-first distributed database for AI agents. Runs on Deno, Node.js, and browser.'
    >
      <HomepageHeader />
      <main>
        <TheSplit />
        <ThirdCategory />
        <HomepageFeatures />
        <BrowserNative />
        <QuickStart />
        <HonestTradeoff />
        <OpenSource />
      </main>
    </Layout>
  );
}
