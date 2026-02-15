import React from 'react';
import Diagram from '../Diagram';

export default function GarbageCollection() {
  return (
    <Diagram>
      <svg
        width='720'
        height='280'
        viewBox='0 0 720 280'
        xmlns='http://www.w3.org/2000/svg'
      >
        <defs>
          <style>
            {`
            .timeline-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-500); 
              stroke-width: 2; 
              stroke-dasharray: 6 3; 
            }
            [data-theme='dark'] .timeline-box { 
              fill: var(--ifm-background-surface-color); 
              stroke: var(--ifm-color-emphasis-600);
            }
            .commit-expired { 
              fill: var(--ifm-color-danger-lightest); 
              stroke: var(--ifm-color-danger-dark); 
              stroke-width: 2; 
              opacity: 0.5; 
            }
            [data-theme='dark'] .commit-expired { 
              fill: var(--ifm-color-danger-darkest); 
              stroke: var(--ifm-color-danger);
              opacity: 0.4;
            }
            .commit-active { 
              fill: var(--ifm-color-success-lightest); 
              stroke: var(--ifm-color-success-dark); 
              stroke-width: 2.5; 
            }
            [data-theme='dark'] .commit-active { 
              fill: var(--ifm-color-success-darkest); 
              stroke: var(--ifm-color-success);
              opacity: 0.9;
            }
            .threshold-line { 
              stroke: var(--ifm-color-danger-dark); 
              stroke-width: 2; 
              stroke-dasharray: 8 4; 
            }
            [data-theme='dark'] .threshold-line { 
              stroke: var(--ifm-color-danger); 
            }
            .text-heading { 
              font-size: 15px; 
              font-weight: 600; 
              fill: var(--ifm-font-color-base); 
            }
            .text-body { 
              font-size: 13px; 
              fill: var(--ifm-font-color-base); 
            }
            .text-icon-small { font-size: 18px; }
            .commit-arrow { 
              stroke: var(--ifm-color-emphasis-600); 
              stroke-width: 1.5; 
              fill: none; 
              marker-end: url(#arrowhead); 
            }
            [data-theme='dark'] .commit-arrow { 
              stroke: var(--ifm-color-emphasis-700); 
            }
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
            id='arrowhead'
            markerWidth='10'
            markerHeight='10'
            refX='8'
            refY='4'
            orient='auto'
          >
            <polygon points='0 0, 10 4, 0 8' className='arrow-marker' />
          </marker>
          <style>
            {`
            .arrow-marker { fill: var(--ifm-color-emphasis-600); }
            [data-theme='dark'] .arrow-marker { fill: var(--ifm-color-emphasis-700); }
          `}
          </style>
        </defs>

        <g transform='translate(0, 0)'>
          <rect
            x='0'
            y='0'
            width='720'
            height='180'
            rx='8'
            ry='8'
            className='timeline-box'
          />
          <text x='20' y='30' className='text-icon-small'>⏰</text>
          <text x='45' y='30' className='text-heading'>Commit Timeline</text>

          {/* Timeline */}
          <g transform='translate(60, 60)'>
            {/* Expired commits */}
            <rect
              x='0'
              y='0'
              width='70'
              height='50'
              rx='2'
              ry='2'
              className='commit-expired'
            />
            <text x='35' y='30' textAnchor='middle' className='text-body'>
              C1
            </text>

            <rect
              x='100'
              y='0'
              width='70'
              height='50'
              rx='2'
              ry='2'
              className='commit-expired'
            />
            <text x='135' y='30' textAnchor='middle' className='text-body'>
              C2
            </text>

            <rect
              x='200'
              y='0'
              width='70'
              height='50'
              rx='2'
              ry='2'
              className='commit-expired'
            />
            <text x='235' y='30' textAnchor='middle' className='text-body'>
              C3
            </text>

            {/* Threshold line */}
            <line
              x1='310'
              y1='-20'
              x2='310'
              y2='70'
              className='threshold-line'
            />
            <text
              x='310'
              y='-30'
              textAnchor='middle'
              className='text-body'
              fontWeight='600'
              fill='var(--ifm-color-danger-dark)'
            >
              Expiration Threshold
            </text>

            {/* Active commits */}
            <rect
              x='350'
              y='0'
              width='70'
              height='50'
              rx='2'
              ry='2'
              className='commit-active'
            />
            <text x='385' y='30' textAnchor='middle' className='text-body'>
              C4
            </text>

            <rect
              x='450'
              y='0'
              width='70'
              height='50'
              rx='2'
              ry='2'
              className='commit-active'
            />
            <text x='485' y='30' textAnchor='middle' className='text-body'>
              C5
            </text>

            <rect
              x='550'
              y='0'
              width='70'
              height='50'
              rx='2'
              ry='2'
              className='commit-active'
            />
            <text x='585' y='30' textAnchor='middle' className='text-body'>
              C6
            </text>

            {/* Arrows */}
            <line x1='70' y1='25' x2='100' y2='25' className='commit-arrow' />
            <line x1='170' y1='25' x2='200' y2='25' className='commit-arrow' />
            <line x1='270' y1='25' x2='350' y2='25' className='commit-arrow' />
            <line x1='420' y1='25' x2='450' y2='25' className='commit-arrow' />
            <line x1='520' y1='25' x2='550' y2='25' className='commit-arrow' />
          </g>

          {/* Time labels */}
          <g transform='translate(60, 150)'>
            <text x='35' y='0' textAnchor='middle' className='text-body'>
              ← Older
            </text>
            <text x='585' y='0' textAnchor='middle' className='text-body'>
              Newer →
            </text>
          </g>
        </g>

        {/* Bottom caption */}
        <g transform='translate(0, 200)'>
          <rect
            x='0'
            y='0'
            width='720'
            height='60'
            rx='4'
            ry='4'
            className='caption-box'
          />
          <text x='20' y='25' className='text-icon-small'>⚡</text>
          <text x='45' y='25' className='text-body'>
            <tspan fontWeight='600' fill='var(--ifm-color-primary-darker)'>
              Smart Cleanup (Design Phase):
            </tspan>
            <tspan dx='5'>
              Time-based expiration • Preserves delta chain integrity
            </tspan>
          </text>
          <text x='45' y='45' className='text-body'>
            Removes expired commits safely • Maintains offline capabilities •
            Coming soon
          </text>
        </g>
      </svg>
    </Diagram>
  );
}
