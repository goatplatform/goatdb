import React from 'react';
import Diagram from '../Diagram';

export default function SyncProtocol() {
  return (
    <Diagram>
      <svg width="720" height="440" viewBox="0 0 720 440" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>{`
            .peer-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-primary); 
              stroke-width: 2.5; 
            }
            [data-theme='dark'] .peer-box { 
              fill: var(--ifm-background-surface-color); 
              stroke: var(--ifm-color-primary-light);
            }
            .commit-box { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-emphasis-500); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .commit-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-600);
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
            .sync-arrow { 
              stroke: var(--ifm-color-primary-dark); 
              stroke-width: 1.5; 
              fill: none; 
              stroke-dasharray: 6 3; 
              marker-end: url(#arrowhead); 
            }
            [data-theme='dark'] .sync-arrow { 
              stroke: var(--ifm-color-primary); 
            }
            .commit-arrow { 
              stroke: var(--ifm-color-emphasis-600); 
              stroke-width: 1.5; 
              fill: none; 
              marker-end: url(#arrowhead-small); 
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
          `}</style>
          <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
            <polygon points="0 0, 10 4, 0 8" className="arrow-marker-primary" />
          </marker>
          <marker id="arrowhead-small" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" className="arrow-marker-secondary" />
          </marker>
          <style>{`
            .arrow-marker-primary { fill: var(--ifm-color-primary-dark); }
            [data-theme='dark'] .arrow-marker-primary { fill: var(--ifm-color-primary); }
            .arrow-marker-secondary { fill: var(--ifm-color-emphasis-600); }
            [data-theme='dark'] .arrow-marker-secondary { fill: var(--ifm-color-emphasis-700); }
          `}</style>
        </defs>
        
        <g transform="translate(0, 0)">
          {/* Peer A */}
          <g transform="translate(0, 0)">
            <rect x="0" y="0" width="320" height="340" rx="4" ry="4" className="peer-box"/>
            <text x="20" y="30" className="text-icon-small">💻</text>
            <text x="45" y="30" className="text-heading">Peer A</text>
            
            <g transform="translate(20, 60)">
              <rect x="0" y="0" width="280" height="40" rx="2" ry="2" className="commit-box"/>
              <text x="20" y="25" className="text-body">Commit 1 (Full Snapshot)</text>
              
              <rect x="0" y="80" width="280" height="40" rx="2" ry="2" className="commit-box"/>
              <text x="20" y="105" className="text-body">Commit 2 (Delta)</text>
              
              <rect x="0" y="160" width="280" height="40" rx="2" ry="2" className="commit-box"/>
              <text x="20" y="185" className="text-body">Commit 3 (Delta)</text>
              
              {/* Arrows between commits */}
              <line x1="140" y1="40" x2="140" y2="80" className="commit-arrow"/>
              <line x1="140" y1="120" x2="140" y2="160" className="commit-arrow"/>
            </g>
          </g>
          
          {/* Peer B */}
          <g transform="translate(400, 0)">
            <rect x="0" y="0" width="320" height="340" rx="4" ry="4" className="peer-box"/>
            <text x="20" y="30" className="text-icon-small">💻</text>
            <text x="45" y="30" className="text-heading">Peer B</text>
            
            <g transform="translate(20, 60)">
              <rect x="0" y="0" width="280" height="40" rx="2" ry="2" className="commit-box"/>
              <text x="20" y="25" className="text-body">Commit 1 (Full Snapshot)</text>
              
              <rect x="0" y="80" width="280" height="40" rx="2" ry="2" className="commit-box"/>
              <text x="20" y="105" className="text-body">Commit 2 (Delta)</text>
              
              {/* Arrow between commits */}
              <line x1="140" y1="40" x2="140" y2="80" className="commit-arrow"/>
            </g>
          </g>
          
          {/* Sync Arrow */}
          <g transform="translate(320, 180)">
            <line x1="0" y1="0" x2="80" y2="0" className="sync-arrow"/>
            <text x="40" y="-10" textAnchor="middle" className="text-body">Delta</text>
            <text x="40" y="20" textAnchor="middle" className="text-body">Sync</text>
          </g>
          
          {/* Bottom caption */}
          <g transform="translate(0, 360)">
            <rect x="0" y="0" width="720" height="60" rx="4" ry="4" className="caption-box"/>
            <text x="20" y="25" className="text-icon-small">⚡</text>
            <text x="45" y="25" className="text-body">
              <tspan fontWeight="600" fill="var(--ifm-color-primary-darker)">Stateless Sync:</tspan>
              <tspan dx="5">Delta compression • Transport agnostic • Automatic conflict resolution</tspan>
            </text>
            <text x="45" y="45" className="text-body">Only missing commits transfer • No persistent state • Works over any channel</text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}