import React from 'react';
import Diagram from '../Diagram';

export default function CommitGraphIllustration() {
  return (
    <Diagram>
      <svg
        width='720'
        height='480'
        viewBox='0 0 720 480'
        xmlns='http://www.w3.org/2000/svg'
      >
        <defs>
          <style>
            {`
            .repo-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-primary); 
              stroke-width: 2.5; 
            }
            [data-theme='dark'] .repo-box { 
              fill: var(--ifm-background-surface-color); 
              stroke: var(--ifm-color-primary-light);
            }
            .item-box { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .item-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-500);
            }
            .commit-node {
              fill: var(--ifm-color-primary-lighter);
              stroke: var(--ifm-color-primary-dark);
              stroke-width: 2;
            }
            [data-theme='dark'] .commit-node {
              fill: var(--ifm-color-primary-darkest);
              stroke: var(--ifm-color-primary);
            }
            .commit-edge {
              stroke: var(--ifm-color-primary);
              stroke-width: 1.5;
              fill: none;
              marker-end: url(#arrowhead2);
            }
            .merge-node {
              fill: var(--ifm-color-warning-lighter);
              stroke: var(--ifm-color-warning-dark);
              stroke-width: 2;
            }
            [data-theme='dark'] .merge-node {
              fill: var(--ifm-color-warning-darkest);
              stroke: var(--ifm-color-warning);
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
            .user-label {
              fill: var(--ifm-color-primary-lighter);
              stroke: none;
              opacity: 0.8;
            }
            [data-theme='dark'] .user-label {
              fill: var(--ifm-color-primary-darkest);
              opacity: 0.6;
            }
            .user-b {
              fill: var(--ifm-color-success-lighter);
            }
            [data-theme='dark'] .user-b {
              fill: var(--ifm-color-success-darkest);
            }
          `}
          </style>
          <marker
            id='arrowhead2'
            markerWidth='8'
            markerHeight='6'
            refX='7'
            refY='3'
            orient='auto'
          >
            <polygon points='0 0, 8 3, 0 6' fill='var(--ifm-color-primary)' />
          </marker>
        </defs>

        <g transform='translate(0, 0)'>
          <rect width='720' height='480' rx='8' ry='8' className='bg-section' />

          {/* Repository Container */}
          <g transform='translate(30, 30)'>
            <rect
              x='0'
              y='0'
              width='660'
              height='350'
              rx='4'
              ry='4'
              className='repo-box'
            />
            <text x='20' y='30' className='text-icon-small'>📂</text>
            <text x='45' y='30' className='text-heading'>
              Commit Graph Evolution
            </text>

            {/* Single item showing the evolution */}
            <g transform='translate(20, 52)'>
              <rect
                x='0'
                y='0'
                width='620'
                height='274'
                rx='2'
                ry='2'
                className='item-box'
              />
              <text x='15' y='25' className='text-body'>
                /data/docs/team-roadmap
              </text>

              {/* Phase 1: Linear commits by User A */}
              <g transform='translate(40, 30)'>
                <text x='0' y='20' className='text-body' fontWeight='600'>
                  Phase 1: Single User
                </text>
                <text x='480' y='0' className='text-label'>
                  10:00 - 10:30 AM
                </text>

                <rect
                  x='-10'
                  y='50'
                  width='50'
                  height='20'
                  className='user-label'
                  rx='10'
                />
                <text x='16' y='64' className='text-label' textAnchor='middle'>
                  User A
                </text>

                {/* Commit chain */}
                <g transform='translate(0, 60)'>
                  <text
                    x='160'
                    y='-15'
                    className='text-body'
                    textAnchor='middle'
                  >
                    Create doc → Add Q1 goals → Update timeline
                  </text>

                  <circle cx='60' cy='0' r='8' className='commit-node' />
                  <text
                    x='60'
                    y='20'
                    className='text-label'
                    textAnchor='middle'
                  >
                    v1
                  </text>

                  <line
                    x1='68'
                    y1='0'
                    x2='152'
                    y2='0'
                    className='commit-edge'
                  />

                  <circle cx='160' cy='0' r='8' className='commit-node' />
                  <text
                    x='160'
                    y='20'
                    className='text-label'
                    textAnchor='middle'
                  >
                    v2
                  </text>

                  <line
                    x1='168'
                    y1='0'
                    x2='252'
                    y2='0'
                    className='commit-edge'
                  />

                  <circle cx='260' cy='0' r='8' className='commit-node' />
                  <text
                    x='260'
                    y='20'
                    className='text-label'
                    textAnchor='middle'
                  >
                    v3
                  </text>
                </g>
              </g>

              {/* Phase 2: Branching occurs */}
              <g transform='translate(40, 150)'>
                <text x='0' y='-4' className='text-body' fontWeight='600'>
                  Phase 2: Concurrent Editing
                </text>
                <text x='480' y='0' className='text-label'>
                  10:45 - 11:15 AM
                </text>

                {/* User labels */}
                <rect
                  x='90'
                  y='15'
                  width='50'
                  height='20'
                  className='user-label'
                  rx='10'
                />
                <text x='116' y='28' className='text-label' textAnchor='middle'>
                  User A
                </text>

                <rect
                  x='90'
                  y='85'
                  width='50'
                  height='20'
                  className='user-label user-b'
                  rx='10'
                />
                <text x='116' y='98' className='text-label' textAnchor='middle'>
                  User B
                </text>

                {/* Branching commit graph */}
                <g transform='translate(0, 60)'>
                  {/* Base commit */}
                  <circle cx='60' cy='0' r='8' className='commit-node' />
                  <text
                    x='60'
                    y='20'
                    className='text-label'
                    textAnchor='middle'
                  >
                    v3
                  </text>

                  {/* Branch to User A */}
                  <line
                    x1='68'
                    y1='-4'
                    x2='192'
                    y2='-40'
                    className='commit-edge'
                  />
                  <circle cx='200' cy='-40' r='8' className='commit-node' />
                  <text
                    x='200'
                    y='-55'
                    className='text-label'
                    textAnchor='middle'
                  >
                    v4a
                  </text>
                  <text x='235' y='-37' className='text-label'>
                    Add Q2 goals
                  </text>

                  {/* Branch to User B */}
                  <line
                    x1='68'
                    y1='4'
                    x2='192'
                    y2='40'
                    className='commit-edge'
                  />
                  <circle cx='200' cy='40' r='8' className='commit-node' />
                  <text
                    x='200'
                    y='60'
                    className='text-label'
                    textAnchor='middle'
                  >
                    v4b
                  </text>
                  <text x='235' y='43' className='text-label'>
                    Update budget
                  </text>

                  {/* Merge */}
                  <line
                    x1='208'
                    y1='-40'
                    x2='332'
                    y2='0'
                    className='commit-edge'
                  />
                  <line
                    x1='208'
                    y1='40'
                    x2='332'
                    y2='0'
                    className='commit-edge'
                  />

                  <text x='300' y='-15' className='text-body'>
                    Automatic merge
                  </text>

                  <circle cx='340' cy='0' r='8' className='merge-node' />
                  <text
                    x='340'
                    y='20'
                    className='text-label'
                    textAnchor='middle'
                  >
                    v5
                  </text>

                  {/* Continue after merge */}
                  <line
                    x1='348'
                    y1='0'
                    x2='432'
                    y2='0'
                    className='commit-edge'
                  />
                  <circle cx='440' cy='0' r='8' className='commit-node' />
                  <text
                    x='440'
                    y='20'
                    className='text-label'
                    textAnchor='middle'
                  >
                    v6
                  </text>
                  <text x='460' y='4' className='text-label'>Fix typos</text>
                </g>
              </g>
            </g>
          </g>

          {/* Caption */}
          <g transform='translate(30, 400)'>
            <rect
              x='0'
              y='0'
              width='660'
              height='60'
              rx='4'
              ry='4'
              className='caption-box'
            />
            <text x='20' y='25' className='text-icon-small'>🔄</text>
            <text x='45' y='25' className='text-body'>
              <tspan fontWeight='600' fill='var(--ifm-color-primary-darker)'>
                Real-time Collaboration:
              </tspan>
              <tspan dx='5'>
                When users edit concurrently, GoatDB creates branches and merges
              </tspan>
            </text>
            <text x='45' y='45' className='text-body'>
              automatically • Each commit is cryptographically signed •
              Conflicts resolved at field level
            </text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}
