import React from 'react';
import Diagram from '../Diagram';

export default function CommitStorage() {
  return (
    <Diagram>
      <svg
        width='720'
        height='400'
        viewBox='0 0 720 400'
        xmlns='http://www.w3.org/2000/svg'
      >
        <defs>
          <style>
            {`
            .commit-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-primary); 
              stroke-width: 2; 
            }
            [data-theme='dark'] .commit-box { 
              fill: var(--ifm-background-surface-color); 
              stroke: var(--ifm-color-primary-light);
            }
            .age-box { 
              fill: var(--ifm-color-success-lightest); 
              stroke: var(--ifm-color-success); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .age-box { 
              fill: var(--ifm-color-success-darkest); 
              stroke: var(--ifm-color-success-light);
            }
            .arrow-line {
              stroke: var(--ifm-color-emphasis-600);
              stroke-width: 2;
              fill: none;
              marker-end: url(#arrowhead);
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
            .text-age {
              font-size: 13px;
              fill: var(--ifm-font-color-base);
              opacity: 0.9;
            }
            [data-theme='dark'] .text-age {
              fill: var(--ifm-color-gray-900);
              opacity: 1;
            }
            .text-label { 
              font-size: 12px; 
              fill: var(--ifm-font-color-base); 
              opacity: 0.8;
            }
            .text-icon-small { font-size: 18px; }
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
          <rect width='720' height='400' rx='8' ry='8' className='bg-section' />

          {/* Timeline header */}
          <text x='30' y='40' className='text-heading'>Commit Timeline</text>

          {/* Commits - centered and spread */}
          <g transform='translate(60, 70)'>
            {/* Commit 1 */}
            <g transform='translate(0, 0)'>
              <rect
                x='0'
                y='0'
                width='120'
                height='60'
                rx='4'
                ry='4'
                className='commit-box'
              />
              <text x='60' y='25' className='text-body' textAnchor='middle'>
                Commit A
              </text>
              <text x='60' y='45' className='text-label' textAnchor='middle'>
                ID: abc123
              </text>
            </g>

            {/* Commit 2 */}
            <g transform='translate(150, 0)'>
              <rect
                x='0'
                y='0'
                width='120'
                height='60'
                rx='4'
                ry='4'
                className='commit-box'
              />
              <text x='60' y='25' className='text-body' textAnchor='middle'>
                Commit B
              </text>
              <text x='60' y='45' className='text-label' textAnchor='middle'>
                ID: def456
              </text>
            </g>

            {/* Commit 3 */}
            <g transform='translate(300, 0)'>
              <rect
                x='0'
                y='0'
                width='120'
                height='60'
                rx='4'
                ry='4'
                className='commit-box'
              />
              <text x='60' y='25' className='text-body' textAnchor='middle'>
                Commit C
              </text>
              <text x='60' y='45' className='text-label' textAnchor='middle'>
                ID: ghi789
              </text>
            </g>

            {/* Commit 4 */}
            <g transform='translate(450, 0)'>
              <rect
                x='0'
                y='0'
                width='120'
                height='60'
                rx='4'
                ry='4'
                className='commit-box'
              />
              <text x='60' y='25' className='text-body' textAnchor='middle'>
                Commit D
              </text>
              <text x='60' y='45' className='text-label' textAnchor='middle'>
                ID: jkl012
              </text>
            </g>
          </g>

          {/* Arrows - adjusted for new centering */}
          <g transform='translate(60, 160)'>
            <path d='M 60 0 L 60 40' className='arrow-line' />
            <path d='M 210 0 L 210 40' className='arrow-line' />
            <path d='M 360 0 L 360 40' className='arrow-line' />
            <path d='M 510 0 L 510 40' className='arrow-line' />
          </g>

          {/* Age assignments - aligned with caption */}
          <g transform='translate(30, 220)'>
            <text x='0' y='0' className='text-heading'>
              Local Age Assignment
            </text>

            {/* Age 1 */}
            <g transform='translate(30, 20)'>
              <rect
                x='30'
                y='0'
                width='60'
                height='40'
                rx='4'
                ry='4'
                className='age-box'
              />
              <text x='60' y='25' className='text-age' textAnchor='middle'>
                Age: 1
              </text>
            </g>

            {/* Age 2 */}
            <g transform='translate(180, 20)'>
              <rect
                x='30'
                y='0'
                width='60'
                height='40'
                rx='4'
                ry='4'
                className='age-box'
              />
              <text x='60' y='25' className='text-age' textAnchor='middle'>
                Age: 2
              </text>
            </g>

            {/* Age 3 */}
            <g transform='translate(330, 20)'>
              <rect
                x='30'
                y='0'
                width='60'
                height='40'
                rx='4'
                ry='4'
                className='age-box'
              />
              <text x='60' y='25' className='text-age' textAnchor='middle'>
                Age: 3
              </text>
            </g>

            {/* Age 4 */}
            <g transform='translate(480, 20)'>
              <rect
                x='30'
                y='0'
                width='60'
                height='40'
                rx='4'
                ry='4'
                className='age-box'
              />
              <text x='60' y='25' className='text-age' textAnchor='middle'>
                Age: 4
              </text>
            </g>
          </g>

          {/* Arrow marker */}
          <defs>
            <marker
              id='arrowhead'
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
          <g transform='translate(30, 320)'>
            <rect
              x='0'
              y='0'
              width='660'
              height='60'
              rx='4'
              ry='4'
              className='caption-box'
            />
            <text x='20' y='25' className='text-icon-small'>🔢</text>
            <text x='45' y='25' className='text-body'>
              <tspan fontWeight='600' fill='var(--ifm-color-primary-darker)'>
                Local Age Tracking:
              </tspan>
              <tspan dx='5'>Sequential numbers track commit order</tspan>
            </text>
            <text x='45' y='45' className='text-body'>
              Never synchronized • Enables fast incremental updates
            </text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}
