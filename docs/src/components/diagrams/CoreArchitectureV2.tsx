import React from 'react';
import Diagram from '../Diagram';

export default function CoreArchitectureV2() {
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
            .layer-bg {
              fill: none;
              stroke: var(--ifm-color-emphasis-400);
              stroke-width: 1.5;
            }
            [data-theme='dark'] .layer-bg {
              fill: none;
              stroke: var(--ifm-color-emphasis-500);
            }
            
            .layer-accent-1 { stroke: var(--ifm-color-secondary-dark); stroke-width: 3; fill: none; }
            .layer-accent-2 { stroke: var(--ifm-color-warning-dark); stroke-width: 3; fill: none; }
            .layer-accent-3 { stroke: var(--ifm-color-info-dark); stroke-width: 3; fill: none; }
            .layer-accent-4 { stroke: var(--ifm-color-success-dark); stroke-width: 3; fill: none; }
            .layer-accent-5 { stroke: var(--ifm-color-primary-dark); stroke-width: 3; fill: none; }
            .layer-accent-6 { stroke: var(--ifm-color-danger-dark); stroke-width: 3; fill: none; }
            [data-theme='dark'] .layer-accent-1 { stroke: var(--ifm-color-secondary); }
            [data-theme='dark'] .layer-accent-2 { stroke: var(--ifm-color-warning); }
            [data-theme='dark'] .layer-accent-3 { stroke: var(--ifm-color-info); }
            [data-theme='dark'] .layer-accent-4 { stroke: var(--ifm-color-success); }
            [data-theme='dark'] .layer-accent-5 { stroke: var(--ifm-color-primary); }
            [data-theme='dark'] .layer-accent-6 { stroke: var(--ifm-color-danger); }
            
            .layer-icon-bg {
              fill: none;
              stroke: var(--ifm-color-emphasis-300);
              stroke-width: 0.5;
              stroke-dasharray: 2 2;
            }
            [data-theme='dark'] .layer-icon-bg {
              fill: none;
              stroke: var(--ifm-color-emphasis-400);
              stroke-dasharray: 2 2;
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
            
            .text-label {
              font-size: 11px;
              fill: var(--ifm-color-emphasis-700);
            }
            [data-theme='dark'] .text-label {
              fill: var(--ifm-color-emphasis-600);
            }
            
            .text-layer-tag {
              font-size: 10px;
              fill: var(--ifm-color-primary);
              opacity: 0.9;
            }
            [data-theme='dark'] .text-layer-tag {
              fill: var(--ifm-color-primary-light);
            }
            
            .connector-line {
              stroke: var(--ifm-color-emphasis-400);
              stroke-width: 1;
              stroke-dasharray: 2 2;
              fill: none;
            }
            [data-theme='dark'] .connector-line {
              stroke: var(--ifm-color-emphasis-500);
            }
            
            .layer-number {
              fill: var(--ifm-color-emphasis-600);
              font-size: 10px;
            }
            [data-theme='dark'] .layer-number {
              fill: var(--ifm-color-emphasis-500);
            }
            
            .visual-element {
              fill: none;
              stroke: var(--ifm-color-info-dark);
              stroke-width: 1;
            }
            [data-theme='dark'] .visual-element {
              fill: none;
              stroke: var(--ifm-color-info);
            }
            
            .bg-section {
              fill: none;
              stroke: var(--ifm-color-emphasis-300);
              stroke-width: 1;
              stroke-dasharray: 4 2;
            }
            [data-theme='dark'] .bg-section {
              fill: none;
              stroke: var(--ifm-color-emphasis-400);
            }
          `}
          </style>
        </defs>

        <g transform='translate(0, 0)'>
          {/* Background */}
          <rect width='720' height='500' rx='8' ry='8' className='bg-section' />

          {/* Title */}
          <text
            x='360'
            y='30'
            className='text-heading'
            textAnchor='middle'
            fontSize='16'
          >
            GoatDB Core Architecture
          </text>

          {/* Layer 1: React Integration */}
          <g transform='translate(60, 60)'>
            <rect
              x='0'
              y='0'
              width='600'
              height='60'
              rx='4'
              className='layer-bg'
            />
            <line x='0' y='0' x2='0' y2='60' className='layer-accent-1' />

            {/* React hooks icon */}
            <g
              transform='translate(20, 18)'
              aria-label='React Integration icon'
            >
              <circle
                cx='10'
                cy='12'
                r='3'
                stroke='var(--ifm-color-secondary-dark)'
                strokeWidth='1.5'
                fill='none'
              />
              <ellipse
                cx='10'
                cy='12'
                rx='8'
                ry='4'
                stroke='var(--ifm-color-secondary-dark)'
                strokeWidth='1.5'
                fill='none'
              />
              <ellipse
                cx='10'
                cy='12'
                rx='8'
                ry='4'
                stroke='var(--ifm-color-secondary-dark)'
                strokeWidth='1.5'
                fill='none'
                transform='rotate(60 10 12)'
              />
              <ellipse
                cx='10'
                cy='12'
                rx='8'
                ry='4'
                stroke='var(--ifm-color-secondary-dark)'
                strokeWidth='1.5'
                fill='none'
                transform='rotate(-60 10 12)'
              />
            </g>

            {/* Content */}
            <text x='65' y='28' className='text-heading'>
              React Integration
            </text>
            <text x='65' y='44' className='text-body'>
              Hooks for client applications
            </text>

            {/* Right-aligned text */}
            <text x='584' y='44' className='text-label' textAnchor='end'>
              useQuery • useItem
            </text>

            {/* Layer number */}
            <text x='584' y='28' className='layer-number' textAnchor='end'>
              OPTIONAL
            </text>
          </g>

          {/* Connector */}
          <line
            x1='360'
            y1='120'
            x2='360'
            y2='130'
            className='connector-line'
          />

          {/* Layer 2: Database Core */}
          <g transform='translate(60, 130)'>
            <rect
              x='0'
              y='0'
              width='600'
              height='60'
              rx='4'
              className='layer-bg'
            />
            <line x='0' y='0' x2='0' y2='60' className='layer-accent-2' />

            {/* Database layers icon */}
            <g transform='translate(20, 19)' aria-label='Database Core icon'>
              <rect
                x='0'
                y='0'
                width='16'
                height='5'
                rx='2'
                stroke='var(--ifm-color-warning-dark)'
                strokeWidth='1.5'
                fill='none'
              />
              <rect
                x='0'
                y='7'
                width='16'
                height='5'
                rx='2'
                stroke='var(--ifm-color-warning-dark)'
                strokeWidth='1.5'
                fill='none'
              />
              <rect
                x='0'
                y='14'
                width='16'
                height='5'
                rx='2'
                stroke='var(--ifm-color-warning-dark)'
                strokeWidth='1.5'
                fill='none'
              />
            </g>

            {/* Content */}
            <text x='65' y='28' className='text-heading'>Database Core</text>
            <text x='65' y='44' className='text-body'>
              Main GoatDB API, Sessions, ManagedItems
            </text>

            {/* Right-aligned text */}
            <text x='584' y='44' className='text-label' textAnchor='end'>
              GoatDB • Sessions
            </text>

            {/* Layer number */}
            <text x='584' y='28' className='layer-number' textAnchor='end'>
              LAYER 1
            </text>
          </g>

          {/* Connector */}
          <line
            x1='360'
            y1='190'
            x2='360'
            y2='200'
            className='connector-line'
          />

          {/* Layer 3: Repository System */}
          <g transform='translate(60, 200)'>
            <rect
              x='0'
              y='0'
              width='600'
              height='60'
              rx='4'
              className='layer-bg'
            />
            <line x='0' y='0' x2='0' y2='60' className='layer-accent-3' />

            {/* Repository commit graph icon */}
            <g
              transform='translate(20, 18)'
              aria-label='Repository System icon'
            >
              <circle
                cx='8'
                cy='12'
                r='3'
                stroke='var(--ifm-color-info-dark)'
                strokeWidth='1.5'
                fill='none'
              />
              <circle
                cx='16'
                cy='6'
                r='3'
                stroke='var(--ifm-color-info-dark)'
                strokeWidth='1.5'
                fill='none'
              />
              <circle
                cx='16'
                cy='18'
                r='3'
                stroke='var(--ifm-color-info-dark)'
                strokeWidth='1.5'
                fill='none'
              />
              <line
                x1='11'
                y1='12'
                x2='13'
                y2='9'
                stroke='var(--ifm-color-info-dark)'
                strokeWidth='1'
              />
              <line
                x1='11'
                y1='12'
                x2='13'
                y2='15'
                stroke='var(--ifm-color-info-dark)'
                strokeWidth='1'
              />
            </g>

            <text x='65' y='28' className='text-heading'>
              Repository System
            </text>
            <text x='65' y='44' className='text-body'>
              Commits, Queries, Version Control
            </text>

            {/* Right-aligned text */}
            <text x='584' y='44' className='text-label' textAnchor='end'>
              Commits → Queries
            </text>

            {/* Layer number */}
            <text x='584' y='28' className='layer-number' textAnchor='end'>
              LAYER 2
            </text>
          </g>

          {/* Connector */}
          <line
            x1='360'
            y1='260'
            x2='360'
            y2='270'
            className='connector-line'
          />

          {/* Layer 4: Conflict Resolution */}
          <g transform='translate(60, 270)'>
            <rect
              x='0'
              y='0'
              width='600'
              height='60'
              rx='4'
              className='layer-bg'
            />
            <line x='0' y='0' x2='0' y2='60' className='layer-accent-4' />

            {/* Conflict resolution Y-merge icon */}
            <g
              transform='translate(20, 16)'
              aria-label='Conflict Resolution icon'
            >
              <path
                d='M 6 5 L 10 12 L 14 5'
                stroke='var(--ifm-color-success-dark)'
                strokeWidth='1.5'
                fill='none'
                strokeLinecap='round'
              />
              <path
                d='M 10 12 L 10 19'
                stroke='var(--ifm-color-success-dark)'
                strokeWidth='1.5'
                strokeLinecap='round'
              />
              <circle
                cx='5'
                cy='3'
                r='1.5'
                stroke='var(--ifm-color-success-dark)'
                strokeWidth='1.5'
                fill='none'
              />
              <circle
                cx='15'
                cy='3'
                r='1.5'
                stroke='var(--ifm-color-success-dark)'
                strokeWidth='1.5'
                fill='none'
              />
              <circle
                cx='10'
                cy='21'
                r='1.5'
                stroke='var(--ifm-color-success-dark)'
                strokeWidth='1.5'
                fill='none'
              />
            </g>

            <text x='65' y='28' className='text-heading'>
              Conflict Resolution
            </text>
            <text x='65' y='44' className='text-body'>
              Merging, CRDTs, Schemas with automatic conflict resolution
            </text>

            {/* Right-aligned text */}
            <text x='584' y='44' className='text-label' textAnchor='end'>
              3-way merge
            </text>

            {/* Layer number */}
            <text x='584' y='28' className='layer-number' textAnchor='end'>
              LAYER 3
            </text>
          </g>

          {/* Connector */}
          <line
            x1='360'
            y1='330'
            x2='360'
            y2='340'
            className='connector-line'
          />

          {/* Layer 5: Networking */}
          <g transform='translate(60, 340)'>
            <rect
              x='0'
              y='0'
              width='600'
              height='60'
              rx='4'
              className='layer-bg'
            />
            <line x='0' y='0' x2='0' y2='60' className='layer-accent-5' />

            {/* Networking interlocking rings icon */}
            <g transform='translate(20, 18)' aria-label='Networking icon'>
              <circle
                cx='8'
                cy='12'
                r='6'
                stroke='var(--ifm-color-primary-dark)'
                strokeWidth='1.5'
                fill='none'
              />
              <circle
                cx='12'
                cy='12'
                r='6'
                stroke='var(--ifm-color-primary-dark)'
                strokeWidth='1.5'
                fill='none'
              />
            </g>

            <text x='65' y='28' className='text-heading'>Networking Layer</text>
            <text x='65' y='44' className='text-body'>
              P2P Sync, Client/Server, Bloom Filters
            </text>

            {/* Right-aligned text */}
            <text x='584' y='44' className='text-label' textAnchor='end'>
              P2P protocol
            </text>

            {/* Layer number */}
            <text x='584' y='28' className='layer-number' textAnchor='end'>
              LAYER 4
            </text>
          </g>

          {/* Connector */}
          <line
            x1='360'
            y1='400'
            x2='360'
            y2='410'
            className='connector-line'
          />

          {/* Layer 6: Runtime Abstraction */}
          <g transform='translate(60, 410)'>
            <rect
              x='0'
              y='0'
              width='600'
              height='60'
              rx='4'
              className='layer-bg'
            />
            <line x='0' y='0' x2='0' y2='60' className='layer-accent-6' />

            {/* Runtime abstraction layered platforms icon */}
            <g
              transform='translate(20, 18)'
              aria-label='Runtime Abstraction icon'
            >
              <rect
                x='0'
                y='4'
                width='12'
                height='12'
                rx='2'
                stroke='var(--ifm-color-danger-dark)'
                strokeWidth='1.5'
                fill='none'
              />
              <rect
                x='3'
                y='7'
                width='12'
                height='12'
                rx='2'
                stroke='var(--ifm-color-danger-dark)'
                strokeWidth='1.5'
                fill='none'
                strokeDasharray='2 2'
              />
              <rect
                x='6'
                y='10'
                width='12'
                height='12'
                rx='2'
                stroke='var(--ifm-color-danger-dark)'
                strokeWidth='1.5'
                fill='none'
                strokeDasharray='3 1'
              />
            </g>

            <text x='65' y='28' className='text-heading'>
              Runtime Abstraction
            </text>
            <text x='65' y='44' className='text-body'>
              Platform APIs, Persistence, Workers
            </text>

            {/* Right-aligned text */}
            <text x='584' y='44' className='text-label' textAnchor='end'>
              Deno • Node • Browser
            </text>

            {/* Layer number */}
            <text x='584' y='28' className='layer-number' textAnchor='end'>
              LAYER 5
            </text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}
