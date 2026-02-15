import React from 'react';
import Diagram from '../Diagram';

export default function QueryProcessing() {
  return (
    <Diagram>
      <svg
        width='760'
        height='260'
        viewBox='0 0 760 260'
        xmlns='http://www.w3.org/2000/svg'
      >
        <defs>
          <style>
            {`
            .cache-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-500); 
              stroke-width: 2; 
            }
            [data-theme='dark'] .cache-box { 
              fill: var(--ifm-background-surface-color); 
              stroke: var(--ifm-color-emphasis-600);
            }
            .timeline-box { 
              fill: var(--ifm-color-primary-lightest); 
              stroke: var(--ifm-color-primary); 
              stroke-width: 2; 
            }
            [data-theme='dark'] .timeline-box { 
              fill: var(--ifm-color-emphasis-200); 
              stroke: var(--ifm-color-primary-light);
            }
            .commit-box { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .commit-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-500);
            }
            .commit-active { 
              fill: var(--ifm-color-primary-lighter); 
              stroke: var(--ifm-color-primary-dark); 
              stroke-width: 3; 
            }
            [data-theme='dark'] .commit-active { 
              fill: var(--ifm-color-primary-darkest); 
              stroke: var(--ifm-color-primary);
              opacity: 0.9;
            }
            .result-box {
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-emphasis-300);
              stroke-width: 1.5;
            }
            [data-theme='dark'] .result-box {
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-400);
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
            .text-code { 
              font-family: var(--ifm-font-family-monospace); 
              font-size: 12px; 
              fill: var(--ifm-color-primary-darker); 
              font-weight: 500;
            }
            [data-theme='dark'] .text-code { 
              fill: var(--ifm-color-primary-light); 
            }
            .text-icon-small { font-size: 18px; }
            .arrow { 
              stroke: var(--ifm-color-primary-dark); 
              stroke-width: 1.5; 
              fill: none; 
              marker-end: url(#arrowhead); 
            }
            [data-theme='dark'] .arrow { 
              stroke: var(--ifm-color-primary); 
            }
            .arrow-dashed { 
              stroke: var(--ifm-color-primary-dark); 
              stroke-width: 1.5; 
              fill: none; 
              stroke-dasharray: 5 3; 
              marker-end: url(#arrowhead); 
            }
            [data-theme='dark'] .arrow-dashed { 
              stroke: var(--ifm-color-primary); 
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
            .arrow-marker { fill: var(--ifm-color-primary-dark); }
            [data-theme='dark'] .arrow-marker { fill: var(--ifm-color-primary); }
          `}
          </style>
        </defs>

        <g transform='translate(0, 0)'>
          {/* Query State */}
          <g transform='translate(0, 0)'>
            <rect
              x='0'
              y='0'
              width='340'
              height='160'
              rx='4'
              ry='4'
              className='cache-box'
            />
            <text x='20' y='30' className='text-icon-small'>🔍</text>
            <text x='45' y='30' className='text-heading'>Query State</text>

            <rect
              x='20'
              y='50'
              width='300'
              height='40'
              rx='2'
              ry='2'
              className='result-box'
            />
            <text x='30' y='75' className='text-code'>
              Results: [item1, item2, ...]
            </text>

            <rect
              x='20'
              y='100'
              width='300'
              height='40'
              rx='2'
              ry='2'
              className='result-box'
            />
            <text x='30' y='125' className='text-code'>
              Last Processed Age:{' '}
              <tspan fill='var(--ifm-color-primary)' fontWeight='600'>3</tspan>
            </text>
          </g>

          {/* Commit Timeline */}
          <g transform='translate(380, 0)'>
            <rect
              x='0'
              y='0'
              width='380'
              height='160'
              rx='4'
              ry='4'
              className='timeline-box'
            />
            <text x='20' y='30' className='text-icon-small'>📝</text>
            <text x='45' y='30' className='text-heading'>Commit Timeline</text>

            <g transform='translate(20, 60)'>
              <rect
                x='0'
                y='0'
                width='60'
                height='40'
                rx='2'
                ry='2'
                className='commit-box'
              />
              <text x='30' y='25' textAnchor='middle' className='text-body'>
                1
              </text>

              <rect
                x='80'
                y='0'
                width='60'
                height='40'
                rx='2'
                ry='2'
                className='commit-box'
              />
              <text x='110' y='25' textAnchor='middle' className='text-body'>
                2
              </text>

              <rect
                x='160'
                y='0'
                width='60'
                height='40'
                rx='2'
                ry='2'
                className='commit-active'
              />
              <text
                x='190'
                y='25'
                textAnchor='middle'
                className='text-body'
                fontWeight='600'
              >
                3
              </text>

              <rect
                x='240'
                y='0'
                width='60'
                height='40'
                rx='2'
                ry='2'
                className='commit-box'
              />
              <text x='270' y='25' textAnchor='middle' className='text-body'>
                4
              </text>

              {/* Arrows between commits */}
              <line x1='60' y1='20' x2='80' y2='20' className='arrow' />
              <line x1='140' y1='20' x2='160' y2='20' className='arrow' />
              <line x1='220' y1='20' x2='240' y2='20' className='arrow' />

              {/* Resume indicator */}
              <path
                d='M 190 45 Q 190 65 270 65 Q 270 65 270 45'
                className='arrow-dashed'
              />
              <text
                x='230'
                y='85'
                textAnchor='middle'
                className='text-body'
                fontSize='11'
              >
                Resume from age 3
              </text>
            </g>
          </g>

          {/* Bottom caption */}
          <g transform='translate(0, 180)'>
            <rect
              x='0'
              y='0'
              width='760'
              height='60'
              rx='4'
              ry='4'
              className='caption-box'
            />
            <text x='20' y='25' className='text-icon-small'>📊</text>
            <text x='45' y='25' className='text-body'>
              <tspan fontWeight='600' fill='var(--ifm-color-primary-darker)'>
                Real-Time Queries:
              </tspan>
              <tspan dx='5'>
                First-class citizens • Non-blocking execution • Composable
                chains
              </tspan>
            </text>
            <text x='45' y='45' className='text-body'>
              Tracks own commit history • Resumes from last processed • Updates
              incrementally
            </text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}
