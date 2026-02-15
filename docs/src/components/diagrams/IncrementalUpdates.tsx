import React from 'react';
import Diagram from '../Diagram';

export default function IncrementalUpdates() {
  return (
    <Diagram>
      <svg
        width='720'
        height='420'
        viewBox='0 0 720 420'
        xmlns='http://www.w3.org/2000/svg'
      >
        <defs>
          <style>
            {`
            .timeline-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 2; 
            }
            [data-theme='dark'] .timeline-box { 
              fill: var(--ifm-background-surface-color); 
              stroke: var(--ifm-color-emphasis-500);
            }
            .old-commit { 
              fill: var(--ifm-color-emphasis-200); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 1.5; 
              opacity: 0.6;
            }
            [data-theme='dark'] .old-commit { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-500);
              opacity: 0.4;
            }
            .new-commit { 
              fill: var(--ifm-color-success-lightest); 
              stroke: var(--ifm-color-success); 
              stroke-width: 2; 
            }
            [data-theme='dark'] .new-commit { 
              fill: var(--ifm-color-success-darkest); 
              stroke: var(--ifm-color-success-light);
            }
            .process-arrow {
              stroke: var(--ifm-color-primary);
              stroke-width: 3;
              fill: none;
              marker-end: url(#arrowhead3);
            }
            .skip-line {
              stroke: var(--ifm-color-emphasis-400);
              stroke-width: 1;
              stroke-dasharray: 2 2;
              fill: none;
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
            .text-label { 
              font-size: 11px; 
              fill: var(--ifm-font-color-base); 
              opacity: 0.8;
            }
            .text-label-new {
              font-size: 11px;
              fill: var(--ifm-font-color-base);
              opacity: 0.8;
            }
            [data-theme='dark'] .text-label-new {
              fill: var(--ifm-color-gray-900);
              opacity: 1;
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
            .age-marker {
              fill: var(--ifm-color-primary);
              stroke: none;
            }
          `}
          </style>
        </defs>

        <g transform='translate(0, 0)'>
          <rect width='720' height='420' rx='8' ry='8' className='bg-section' />

          {/* Header */}
          <text x='30' y='40' className='text-heading'>
            Query Incremental Updates
          </text>

          {/* Timeline */}
          <g transform='translate(30, 70)'>
            <rect
              x='0'
              y='0'
              width='660'
              height='120'
              rx='4'
              ry='4'
              className='timeline-box'
            />
            <text x='20' y='30' className='text-body'>Commit Timeline:</text>

            {/* Old commits */}
            <g transform='translate(20, 50)'>
              {[0, 1, 2, 3, 4].map((i) => (
                <g key={i} transform={`translate(${i * 80}, 0)`}>
                  <rect
                    x='0'
                    y='0'
                    width='60'
                    height='40'
                    rx='2'
                    ry='2'
                    className='old-commit'
                  />
                  <text
                    x='30'
                    y='25'
                    className='text-label'
                    textAnchor='middle'
                  >
                    Age {i + 1}
                  </text>
                </g>
              ))}

              {/* Marker line */}
              <line x1='390' y1='-20' x2='390' y2='50' className='skip-line' />
              <text x='390' y='-25' className='text-label' textAnchor='middle'>
                Last processed
              </text>

              {/* New commits */}
              {[5, 6, 7].map((i) => (
                <g key={i} transform={`translate(${i * 80}, 0)`}>
                  <rect
                    x='0'
                    y='0'
                    width='60'
                    height='40'
                    rx='2'
                    ry='2'
                    className='new-commit'
                  />
                  <text
                    x='30'
                    y='25'
                    className='text-label-new'
                    textAnchor='middle'
                  >
                    Age {i + 1}
                  </text>
                </g>
              ))}
            </g>
          </g>

          {/* Process arrow */}
          <g transform='translate(360, 210)'>
            <path d='M 0 0 L 0 40' className='process-arrow' />
            <text x='20' y='40' className='text-body'>
              Skip 1-5, process 6-8
            </text>
          </g>

          {/* Query box */}
          <g transform='translate(180, 270)'>
            <rect
              x='0'
              y='0'
              width='360'
              height='80'
              rx='4'
              ry='4'
              className='timeline-box'
            />
            <text x='20' y='30' className='text-icon-small'>🔄</text>
            <text x='45' y='30' className='text-heading'>
              Query Update Process
            </text>
            <text x='45' y='55' className='text-body'>
              Resume from Age 6 → Process commits 6, 7, 8
            </text>
          </g>

          {/* Arrow marker */}
          <defs>
            <marker
              id='arrowhead3'
              markerWidth='10'
              markerHeight='10'
              refX='5'
              refY='5'
              orient='auto'
            >
              <polygon
                points='0 2.5, 7.4 5, 0 7.5'
                fill='var(--ifm-color-primary)'
              />
            </marker>
          </defs>

          {/* Caption */}
          <g transform='translate(30, 370)'>
            <rect
              x='0'
              y='0'
              width='660'
              height='40'
              rx='4'
              ry='4'
              className='caption-box'
            />
            <text x='20' y='25' className='text-icon-small'>🚀</text>
            <text x='45' y='25' className='text-body'>
              <tspan fontWeight='600' fill='var(--ifm-color-primary-darker)'>
                Incremental Updates:
              </tspan>
              <tspan dx='5'>
                Skip old commits • Process only new changes • Much faster than
                full scan
              </tspan>
            </text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}
