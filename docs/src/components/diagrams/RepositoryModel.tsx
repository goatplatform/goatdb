import React from 'react';
import Diagram from '../Diagram';

export default function RepositoryModel() {
  return (
    <Diagram>
      <svg width="720" height="320" viewBox="0 0 720 320" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>{`
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
          `}</style>
        </defs>
        
        <g transform="translate(0, 0)">
          <rect width="720" height="320" rx="8" ry="8" className="bg-section"/>
          
          {/* Repository A */}
          <g transform="translate(30, 30)">
            <rect x="0" y="0" width="300" height="200" rx="4" ry="4" className="repo-box"/>
            <text x="20" y="30" className="text-icon-small">📁</text>
            <text x="45" y="30" className="text-heading">users</text>
            
            <g transform="translate(20, 50)">
              <rect x="0" y="0" width="260" height="35" rx="2" ry="2" className="item-box"/>
              <text x="15" y="23" className="text-body">Item 1: /data/users/jane-123</text>
              
              <rect x="0" y="45" width="260" height="35" rx="2" ry="2" className="item-box"/>
              <text x="15" y="68" className="text-body">Item 2: /data/users/john-456</text>
              
              <rect x="0" y="90" width="260" height="35" rx="2" ry="2" className="item-box"/>
              <text x="15" y="113" className="text-body">Item 3: /data/users/sam-789</text>
            </g>
          </g>
          
          {/* Repository B */}
          <g transform="translate(390, 30)">
            <rect x="0" y="0" width="300" height="200" rx="4" ry="4" className="repo-box"/>
            <text x="20" y="30" className="text-icon-small">📁</text>
            <text x="45" y="30" className="text-heading">projects</text>
            
            <g transform="translate(20, 50)">
              <rect x="0" y="0" width="260" height="35" rx="2" ry="2" className="item-box"/>
              <text x="15" y="23" className="text-body">Item 1: /data/projects/goat-db</text>
              
              <rect x="0" y="45" width="260" height="35" rx="2" ry="2" className="item-box"/>
              <text x="15" y="68" className="text-body">Item 2: /data/projects/web-app</text>
            </g>
          </g>
          
          {/* Caption */}
          <g transform="translate(30, 250)">
            <rect x="0" y="0" width="660" height="60" rx="4" ry="4" className="caption-box"/>
            <text x="20" y="25" className="text-icon-small">⚡</text>
            <text x="45" y="25" className="text-body">
              <tspan fontWeight="600" fill="var(--ifm-color-primary-darker)">Repository Isolation:</tspan>
              <tspan dx="5">Natural boundaries for data</tspan>
            </text>
            <text x="45" y="45" className="text-body">Item-level commit graphs • Fine-grained access control</text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}