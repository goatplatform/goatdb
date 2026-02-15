import React from 'react';
import Diagram from '../Diagram';

export default function RepositoryModel() {
  return (
    <Diagram>
      <svg
        width='720'
        height='200'
        viewBox='0 0 720 200'
        xmlns='http://www.w3.org/2000/svg'
      >
        <defs>
          <style>
            {`
            .crowded-container { 
              fill: var(--ifm-color-emphasis-200); 
              stroke: var(--ifm-color-emphasis-600); 
              stroke-width: 3; 
            }
            [data-theme='dark'] .crowded-container { 
              fill: var(--ifm-color-emphasis-300); 
              stroke: var(--ifm-color-emphasis-400);
            }
            .heavy-load { 
              fill: var(--ifm-color-emphasis-400);
              opacity: 0.7;
            }
            [data-theme='dark'] .heavy-load { 
              fill: var(--ifm-color-emphasis-200);
              opacity: 0.8;
            }
            .organized-container { 
              fill: var(--ifm-color-primary-lightest); 
              stroke: var(--ifm-color-primary); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .organized-container { 
              fill: var(--ifm-color-primary-darkest); 
              stroke: var(--ifm-color-primary-light);
            }
            .light-load { 
              fill: var(--ifm-color-primary-lighter);
              opacity: 0.3;
            }
            [data-theme='dark'] .light-load { 
              fill: var(--ifm-color-primary-darker);
              opacity: 0.5;
            }
            .transform-arrow { 
              fill: none;
              stroke: var(--ifm-color-warning-dark); 
              stroke-width: 3; 
              stroke-linecap: round;
            }
            [data-theme='dark'] .transform-arrow { 
              stroke: var(--ifm-color-warning);
            }
            .scale-label { 
              font-size: 13px; 
              font-weight: 600;
              fill: var(--ifm-color-warning-dark);
              text-anchor: middle;
            }
            [data-theme='dark'] .scale-label { 
              fill: var(--ifm-color-warning);
            }
            .text-explanation { 
              font-size: 14px; 
              fill: var(--ifm-font-color-base); 
            }
            .text-sub { 
              font-size: 12px; 
              fill: var(--ifm-color-emphasis-700);
            }
            [data-theme='dark'] .text-sub { 
              fill: var(--ifm-color-emphasis-600);
            }
            marker#arrow polygon {
              fill: var(--ifm-color-warning-dark);
            }
            [data-theme='dark'] marker#arrow polygon {
              fill: var(--ifm-color-warning);
            }
          `}
          </style>

          <marker
            id='arrow'
            markerWidth='8'
            markerHeight='6'
            refX='7'
            refY='3'
            orient='auto'
          >
            <polygon points='0 0, 8 3, 0 6' />
          </marker>
        </defs>

        {/* PROBLEM: Crowded large containers with tight spacing */}
        <g transform='translate(135, 35)'>
          {/* Large container 1 with heavy load - tight spacing */}
          <rect
            x='0'
            y='0'
            width='90'
            height='70'
            rx='4'
            className='crowded-container'
          />
          <rect
            x='4'
            y='4'
            width='82'
            height='62'
            rx='2'
            className='heavy-load'
          />

          {/* Large container 2 with heavy load - overlapping */}
          <rect
            x='75'
            y='10'
            width='90'
            height='70'
            rx='4'
            className='crowded-container'
          />
          <rect
            x='79'
            y='14'
            width='82'
            height='62'
            rx='2'
            className='heavy-load'
          />
        </g>

        {/* TRANSFORMATION: Right-sized arrow with clear label */}
        <path
          d='M 330 80 L 390 80'
          className='transform-arrow'
          markerEnd='url(#arrow)'
        />
        <text x='358' y='68' className='scale-label'>Scale Out</text>
        <text x='360' y='102' className='scale-label'>Don't Scale Up</text>

        {/* SOLUTION: Organized small containers with generous spacing */}
        <g transform='translate(405, 40)'>
          {/* Row 1 with proper spacing (golden ratio inspired) */}
          <rect
            x='0'
            y='0'
            width='30'
            height='30'
            rx='2'
            className='organized-container'
          />
          <rect
            x='3'
            y='3'
            width='24'
            height='24'
            rx='1'
            className='light-load'
          />

          <rect
            x='40'
            y='0'
            width='30'
            height='30'
            rx='2'
            className='organized-container'
          />
          <rect
            x='43'
            y='3'
            width='24'
            height='24'
            rx='1'
            className='light-load'
          />

          <rect
            x='80'
            y='0'
            width='30'
            height='30'
            rx='2'
            className='organized-container'
          />
          <rect
            x='83'
            y='3'
            width='24'
            height='24'
            rx='1'
            className='light-load'
          />

          <rect
            x='120'
            y='0'
            width='30'
            height='30'
            rx='2'
            className='organized-container'
          />
          <rect
            x='123'
            y='3'
            width='24'
            height='24'
            rx='1'
            className='light-load'
          />

          <rect
            x='160'
            y='0'
            width='30'
            height='30'
            rx='2'
            className='organized-container'
          />
          <rect
            x='163'
            y='3'
            width='24'
            height='24'
            rx='1'
            className='light-load'
          />

          <rect
            x='200'
            y='0'
            width='30'
            height='30'
            rx='2'
            className='organized-container'
          />
          <rect
            x='203'
            y='3'
            width='24'
            height='24'
            rx='1'
            className='light-load'
          />

          {/* Row 2 with proper spacing */}
          <rect
            x='20'
            y='40'
            width='30'
            height='30'
            rx='2'
            className='organized-container'
          />
          <rect
            x='23'
            y='43'
            width='24'
            height='24'
            rx='1'
            className='light-load'
          />

          <rect
            x='60'
            y='40'
            width='30'
            height='30'
            rx='2'
            className='organized-container'
          />
          <rect
            x='63'
            y='43'
            width='24'
            height='24'
            rx='1'
            className='light-load'
          />

          <rect
            x='100'
            y='40'
            width='30'
            height='30'
            rx='2'
            className='organized-container'
          />
          <rect
            x='103'
            y='43'
            width='24'
            height='24'
            rx='1'
            className='light-load'
          />

          <rect
            x='140'
            y='40'
            width='30'
            height='30'
            rx='2'
            className='organized-container'
          />
          <rect
            x='143'
            y='43'
            width='24'
            height='24'
            rx='1'
            className='light-load'
          />

          <rect
            x='180'
            y='40'
            width='30'
            height='30'
            rx='2'
            className='organized-container'
          />
          <rect
            x='183'
            y='43'
            width='24'
            height='24'
            rx='1'
            className='light-load'
          />
        </g>

        {/* Bottom Explanation */}
        <g transform='translate(85, 150)'>
          <text x='0' y='20' className='text-explanation'>
            <tspan fontWeight='600' fill='var(--ifm-color-primary)'>
              Horizontal Scaling:
            </tspan>
            <tspan dx='5'>
              Scale by adding more repositories, not expanding existing ones
            </tspan>
          </text>
          <text x='0' y='40' className='text-sub'>
            Each repository: up to 100k items • Independent sync • Fault
            isolation
          </text>
        </g>
      </svg>
    </Diagram>
  );
}
