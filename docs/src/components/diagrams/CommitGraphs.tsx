import React from 'react';
import Diagram from '../Diagram';

export default function CommitGraphs() {
  return (
    <Diagram>
      <svg width="720" height="480" viewBox="0 0 720 480" xmlns="http://www.w3.org/2000/svg">
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
          `}</style>
          <marker id="arrowhead2" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="var(--ifm-color-primary)"/>
          </marker>
        </defs>
        
        <g transform="translate(0, 0)">
          <rect width="720" height="480" rx="8" ry="8" className="bg-section"/>
          
          {/* Repository Container */}
          <g transform="translate(30, 30)">
            <rect x="0" y="0" width="660" height="350" rx="4" ry="4" className="repo-box"/>
            <text x="20" y="30" className="text-icon-small">📁</text>
            <text x="45" y="30" className="text-heading">Repository: users</text>
            
            {/* Item 1 with its commit graph */}
            <g transform="translate(20, 60)">
              <rect x="0" y="0" width="300" height="120" rx="2" ry="2" className="item-box"/>
              <text x="15" y="25" className="text-body">/data/users/jane</text>
              
              {/* Commit graph for jane */}
              <g transform="translate(30, 40)">
                <circle cx="30" cy="30" r="8" className="commit-node"/>
                <text x="30" y="55" className="text-label" textAnchor="middle">v1</text>
                
                <line x1="38" y1="30" x2="62" y2="30" className="commit-edge"/>
                
                <circle cx="70" cy="30" r="8" className="commit-node"/>
                <text x="70" y="55" className="text-label" textAnchor="middle">v2</text>
                
                <line x1="78" y1="30" x2="102" y2="30" className="commit-edge"/>
                
                <circle cx="110" cy="30" r="8" className="commit-node"/>
                <text x="110" y="55" className="text-label" textAnchor="middle">v3</text>
                
                <line x1="118" y1="30" x2="142" y2="30" className="commit-edge"/>
                
                <circle cx="150" cy="30" r="8" className="commit-node"/>
                <text x="150" y="55" className="text-label" textAnchor="middle">v4</text>
              </g>
            </g>
            
            {/* Item 2 with its commit graph - shows merge */}
            <g transform="translate(340, 60)">
              <rect x="0" y="0" width="300" height="120" rx="2" ry="2" className="item-box"/>
              <text x="15" y="25" className="text-body">/data/users/john</text>
              
              {/* Commit graph for john showing merge */}
              <g transform="translate(30, 40)">
                <circle cx="30" cy="30" r="8" className="commit-node"/>
                <text x="30" y="55" className="text-label" textAnchor="middle">v1</text>
                
                {/* Branch 1 */}
                <line x1="38" y1="26" x2="62" y2="15" className="commit-edge"/>
                <circle cx="70" cy="15" r="8" className="commit-node"/>
                <text x="70" y="-5" className="text-label" textAnchor="middle">v2a</text>
                
                {/* Branch 2 */}
                <line x1="38" y1="34" x2="62" y2="45" className="commit-edge"/>
                <circle cx="70" cy="45" r="8" className="commit-node"/>
                <text x="70" y="70" className="text-label" textAnchor="middle">v2b</text>
                
                {/* Merge */}
                <line x1="78" y1="15" x2="102" y2="30" className="commit-edge"/>
                <line x1="78" y1="45" x2="102" y2="30" className="commit-edge"/>
                
                <circle cx="110" cy="30" r="8" className="merge-node"/>
                <text x="110" y="55" className="text-label" textAnchor="middle">merge</text>
                
                <line x1="118" y1="30" x2="142" y2="30" className="commit-edge"/>
                
                <circle cx="150" cy="30" r="8" className="commit-node"/>
                <text x="150" y="55" className="text-label" textAnchor="middle">v3</text>
              </g>
            </g>
            
            {/* Item 3 with its commit graph */}
            <g transform="translate(20, 200)">
              <rect x="0" y="0" width="300" height="120" rx="2" ry="2" className="item-box"/>
              <text x="15" y="25" className="text-body">/data/users/alice</text>
              
              {/* Commit graph for alice */}
              <g transform="translate(30, 40)">
                <circle cx="30" cy="30" r="8" className="commit-node"/>
                <text x="30" y="55" className="text-label" textAnchor="middle">v1</text>
                
                <line x1="38" y1="30" x2="62" y2="30" className="commit-edge"/>
                
                <circle cx="70" cy="30" r="8" className="commit-node"/>
                <text x="70" y="55" className="text-label" textAnchor="middle">v2</text>
              </g>
            </g>
            
            {/* Item 4 - new item */}
            <g transform="translate(340, 200)">
              <rect x="0" y="0" width="300" height="120" rx="2" ry="2" className="item-box"/>
              <text x="15" y="25" className="text-body">/data/users/bob</text>
              
              {/* Single commit for new item */}
              <g transform="translate(30, 40)">
                <circle cx="30" cy="30" r="8" className="commit-node"/>
                <text x="30" y="55" className="text-label" textAnchor="middle">v1</text>
                
                <text x="50" y="34" className="text-label">(new item)</text>
              </g>
            </g>
          </g>
          
          {/* Caption */}
          <g transform="translate(30, 400)">
            <rect x="0" y="0" width="660" height="60" rx="4" ry="4" className="caption-box"/>
            <text x="20" y="25" className="text-icon-small">🌳</text>
            <text x="45" y="25" className="text-body">
              <tspan fontWeight="600" fill="var(--ifm-color-primary-darker)">Independent Histories:</tspan>
              <tspan dx="5">Each item has its own commit graph</tspan>
            </text>
            <text x="45" y="45" className="text-body">Automatic conflict resolution • Parallel evolution</text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}