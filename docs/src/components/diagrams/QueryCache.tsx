import React from 'react';
import Diagram from '../Diagram';

export default function QueryCache() {
  return (
    <Diagram>
      <svg
        width='720'
        height='360'
        viewBox='0 0 720 360'
        xmlns='http://www.w3.org/2000/svg'
      >
        <defs>
          <style>
            {`
            .query-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-primary); 
              stroke-width: 2.5; 
            }
            [data-theme='dark'] .query-box { 
              fill: var(--ifm-background-surface-color); 
              stroke: var(--ifm-color-primary-light);
            }
            .cache-box { 
              fill: var(--ifm-color-warning-lightest); 
              stroke: var(--ifm-color-warning); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .cache-box { 
              fill: var(--ifm-color-warning-darkest); 
              stroke: var(--ifm-color-warning-light);
            }
            .result-box { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .result-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-500);
            }
            .age-badge {
              fill: var(--ifm-color-success);
              stroke: none;
            }
            .text-heading { 
              font-size: 15px; 
              font-weight: 600; 
              fill: var(--ifm-font-color-base); 
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
            .text-icon-small { font-size: 18px; }
            .text-age-badge { 
              font-size: 13px; 
              fill: white; 
              font-weight: bold;
            }
            [data-theme='dark'] .text-age-badge {
              fill: var(--ifm-color-gray-900);
            }
            .bg-section { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-300); 
              stroke-width: 1.5; 
              stroke-dasharray: 6 3; 
            }
            [data-theme='dark'] .bg-section { 
              fill: var(--ifm-background-surface-color); 
              opacity: 0.5;
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
        </defs>

        <g transform='translate(0, 0)'>
          <rect width='720' height='350' rx='8' ry='8' className='bg-section' />

          {/* Query Box */}
          <g transform='translate(40, 30)'>
            <rect
              x='0'
              y='0'
              width='300'
              height='220'
              rx='4'
              ry='4'
              className='query-box'
            />
            <text x='20' y='35' className='text-icon-small'>🔍</text>
            <text x='45' y='35' className='text-heading'>
              Query: Active Users
            </text>

            <g transform='translate(20, 65)'>
              <rect
                x='0'
                y='0'
                width='260'
                height='45'
                rx='2'
                ry='2'
                className='result-box'
              />
              <text x='130' y='28' className='text-body' textAnchor='middle'>
                Filter: active users only
              </text>
            </g>

            <g transform='translate(20, 130)'>
              <text x='0' y='0' className='text-body'>Results:</text>
              <text x='0' y='25' className='text-small'>• Alice Smith</text>
              <text x='0' y='50' className='text-small'>• Bob Johnson</text>
              <text x='0' y='75' className='text-small'>• Carol Davis</text>
            </g>
          </g>

          {/* Cache Box */}
          <g transform='translate(380, 30)'>
            <rect
              x='0'
              y='0'
              width='300'
              height='220'
              rx='4'
              ry='4'
              className='cache-box'
            />
            <text x='20' y='35' className='text-icon-small'>💾</text>
            <text x='45' y='35' className='text-heading'>Query Cache</text>

            <g transform='translate(20, 65)'>
              <text x='0' y='20' className='text-body'>Cached Results:</text>
              <g transform='translate(0, 35)'>
                <rect
                  x='0'
                  y='0'
                  width='260'
                  height='45'
                  rx='2'
                  ry='2'
                  className='result-box'
                />
                <text x='130' y='28' className='text-small' textAnchor='middle'>
                  [Alice, Bob, Carol] ✓
                </text>
              </g>

              <g transform='translate(0, 105)'>
                <text x='0' y='15' className='text-body'>
                  Last Processed Age:
                </text>
                <g transform='translate(136, -5)'>
                  <circle cx='15' cy='15' r='15' className='age-badge' />
                  <text
                    x='15'
                    y='20'
                    className='text-age-badge'
                    textAnchor='middle'
                  >
                    42
                  </text>
                </g>
              </g>
            </g>
          </g>

          {/* Arrow between boxes */}
          <g transform='translate(340, 140)'>
            <path
              d='M 0 0 L 40 0'
              stroke='var(--ifm-color-emphasis-600)'
              strokeWidth='2'
              markerEnd='url(#arrowhead2)'
            />
          </g>

          {/* Arrow marker */}
          <defs>
            <marker
              id='arrowhead2'
              markerWidth='10'
              markerHeight='7'
              refX='9'
              refY='3.5'
              orient='auto'
            >
              <polygon
                points='0 0, 10 3.5, 0 7'
                fill='var(--ifm-color-emphasis-600)'
              />
            </marker>
          </defs>

          {/* Caption */}
          <g transform='translate(30, 270)'>
            <rect
              x='0'
              y='0'
              width='660'
              height='60'
              rx='4'
              ry='4'
              className='caption-box'
            />
            <text x='20' y='25' className='text-icon-small'>⚡</text>
            <text x='45' y='25' className='text-body'>
              <tspan fontWeight='600' fill='var(--ifm-color-primary-darker)'>
                Smart Caching:
              </tspan>
              <tspan dx='5'>Stores results + last processed age</tspan>
            </text>
            <text x='45' y='45' className='text-body'>
              Updates process only new commits (age {'>'} 42)
            </text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}
