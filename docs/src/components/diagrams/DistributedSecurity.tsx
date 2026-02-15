import React from 'react';
import Diagram from '../Diagram';

export default function DistributedSecurity() {
  return (
    <Diagram>
      <svg
        width='720'
        height='500'
        viewBox='0 0 720 500'
        xmlns='http://www.w3.org/2000/svg'
      >
        <defs>
          <style>
            {`
            .peer-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 1.5; 
              stroke-dasharray: 6 3; 
            }
            [data-theme='dark'] .peer-box { 
              fill: var(--ifm-background-surface-color); 
              stroke: var(--ifm-color-emphasis-500);
              opacity: 0.5;
            }
            .graph-box { 
              fill: var(--ifm-color-warning-lightest); 
              stroke: var(--ifm-color-warning); 
              stroke-width: 2; 
            }
            [data-theme='dark'] .graph-box { 
              fill: var(--ifm-color-warning-darkest); 
              stroke: var(--ifm-color-warning-light);
            }
            .verify-box { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .verify-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-500);
            }
            .distribute-arrow {
              stroke: var(--ifm-color-emphasis-600);
              stroke-width: 1.5;
              stroke-dasharray: 3 3;
              fill: none;
              marker-end: url(#arrowhead3);
            }
            .text-heading { 
              font-size: 15px; 
              font-weight: 600; 
              fill: var(--ifm-font-color-base); 
            }
            [data-theme='dark'] .graph-box .text-heading { 
              fill: var(--ifm-color-gray-900); 
            }
            [data-theme='dark'] .graph-box .text-body { 
              fill: var(--ifm-color-gray-900); 
            }
            .text-body { 
              font-size: 13px; 
              fill: var(--ifm-font-color-base); 
              opacity: 0.9;
            }
            .text-small { 
              font-size: 11px; 
              fill: var(--ifm-font-color-base); 
              opacity: 0.8;
            }
            .text-code { 
              font-family: var(--ifm-font-family-monospace); 
              font-size: 11px; 
              fill: var(--ifm-color-success-darker); 
              font-weight: 500;
            }
            [data-theme='dark'] .text-code { 
              fill: var(--ifm-color-success-light); 
            }
            .text-success { 
              fill: var(--ifm-color-success-darker); 
            }
            [data-theme='dark'] .text-success { 
              fill: var(--ifm-color-success-light); 
            }
            .text-icon { font-size: 24px; }
            .text-icon-small { font-size: 16px; }
            .caption-box {
              fill: var(--ifm-color-emphasis-100);
              stroke: var(--ifm-color-emphasis-300);
              stroke-width: 1;
            }
            [data-theme='dark'] .caption-box {
              fill: var(--ifm-background-surface-color);
              stroke: var(--ifm-color-emphasis-400);
            }
          `}
          </style>
          <marker
            id='arrowhead3'
            markerWidth='8'
            markerHeight='6'
            refX='8'
            refY='3'
            orient='auto'
          >
            <polygon
              points='0 0, 8 3, 0 6'
              fill='var(--ifm-color-emphasis-600)'
            />
          </marker>
        </defs>

        <g transform='translate(0, 0)'>
          {/* Title */}
          <text x='360' y='25' className='text-heading' textAnchor='middle'>
            Distributed Security Architecture
          </text>
          <text x='360' y='45' className='text-body' textAnchor='middle'>
            Independent Verification by All Peers
          </text>

          {/* Central Commit Graph */}
          <g transform='translate(235, 70)'>
            <rect
              x='0'
              y='0'
              width='250'
              height='100'
              rx='8'
              ry='8'
              className='graph-box'
            />
            <text x='125' y='35' className='text-icon' textAnchor='middle'>
              🔗
            </text>
            <text x='125' y='50' className='text-heading' textAnchor='middle'>
              Tamper-Proof
            </text>
            <text x='125' y='70' className='text-heading' textAnchor='middle'>
              Commit Graph
            </text>
            <text x='125' y='90' className='text-body' textAnchor='middle'>
              (Signed Operations ✍️)
            </text>
          </g>

          {/* Distribution arrows */}
          <path d='M 360 170 Q 235 194 110 214' className='distribute-arrow' />
          <path d='M 360 170 L 360 214' className='distribute-arrow' />
          <path d='M 360 170 Q 485 194 610 214' className='distribute-arrow' />

          {/* Client Peer A */}
          <g transform='translate(10, 214)'>
            <rect
              x='0'
              y='0'
              width='200'
              height='210'
              rx='8'
              ry='8'
              className='peer-box'
            />
            <text x='100' y='35' className='text-icon' textAnchor='middle'>
              💻
            </text>
            <text x='100' y='60' className='text-heading' textAnchor='middle'>
              Client Peer A
            </text>

            <g transform='translate(25, 80)'>
              <rect
                x='0'
                y='0'
                width='150'
                height='110'
                rx='4'
                ry='4'
                className='verify-box'
              />
              <text x='75' y='18' className='text-body' textAnchor='middle'>
                Receives Graph Data
              </text>
              <text x='20' y='48' className='text-icon-small'>🔍</text>
              <text x='40' y='48' className='text-body'>Verify with</text>
              <text x='75' y='68' className='text-code' textAnchor='middle'>
                🔑 Public Keys
              </text>
              <text
                x='75'
                y='93'
                className='text-success text-icon-small'
                textAnchor='middle'
              >
                ✅ Verified
              </text>
            </g>

            <text x='100' y='202' className='text-small' textAnchor='middle'>
              Acts as replica
            </text>
          </g>

          {/* Client Peer B */}
          <g transform='translate(260, 214)'>
            <rect
              x='0'
              y='0'
              width='200'
              height='210'
              rx='8'
              ry='8'
              className='peer-box'
            />
            <text x='100' y='35' className='text-icon' textAnchor='middle'>
              📱
            </text>
            <text x='100' y='60' className='text-heading' textAnchor='middle'>
              Client Peer B
            </text>

            <g transform='translate(25, 80)'>
              <rect
                x='0'
                y='0'
                width='150'
                height='110'
                rx='4'
                ry='4'
                className='verify-box'
              />
              <text x='75' y='18' className='text-body' textAnchor='middle'>
                Receives Graph Data
              </text>
              <text x='20' y='48' className='text-icon-small'>🔍</text>
              <text x='40' y='48' className='text-body'>Verify with</text>
              <text x='75' y='68' className='text-code' textAnchor='middle'>
                🔑 Public Keys
              </text>
              <text
                x='75'
                y='93'
                className='text-success text-icon-small'
                textAnchor='middle'
              >
                ✅ Verified
              </text>
            </g>

            <text x='100' y='202' className='text-small' textAnchor='middle'>
              Can restore state
            </text>
          </g>

          {/* Server Peer C */}
          <g transform='translate(510, 214)'>
            <rect
              x='0'
              y='0'
              width='200'
              height='210'
              rx='8'
              ry='8'
              className='peer-box'
            />
            <text x='100' y='35' className='text-icon' textAnchor='middle'>
              ☁️
            </text>
            <text x='100' y='60' className='text-heading' textAnchor='middle'>
              Server Peer C
            </text>

            <g transform='translate(25, 80)'>
              <rect
                x='0'
                y='0'
                width='150'
                height='110'
                rx='4'
                ry='4'
                className='verify-box'
              />
              <text x='75' y='18' className='text-body' textAnchor='middle'>
                Receives Graph Data
              </text>
              <text x='20' y='48' className='text-icon-small'>🔍</text>
              <text x='40' y='48' className='text-body'>Verify with</text>
              <text x='75' y='68' className='text-code' textAnchor='middle'>
                🔑 Public Keys
              </text>
              <text
                x='75'
                y='93'
                className='text-success text-icon-small'
                textAnchor='middle'
              >
                ✅ Verified
              </text>
            </g>

            <text x='100' y='202' className='text-small' textAnchor='middle'>
              No single point of failure
            </text>
          </g>

          {/* Caption */}
          <g transform='translate(30, 440)'>
            <rect
              x='0'
              y='0'
              width='660'
              height='40'
              rx='4'
              ry='4'
              className='caption-box'
            />
            <text x='20' y='25' className='text-icon-small'>🛡️</text>
            <text x='45' y='25' className='text-body'>
              <tspan fontWeight='600' fill='var(--ifm-color-primary-darker)'>
                Distributed Verification:
              </tspan>
              <tspan dx='5'>
                Every peer validates • Client-as-replica design • Resilient to
                failures
              </tspan>
            </text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}
