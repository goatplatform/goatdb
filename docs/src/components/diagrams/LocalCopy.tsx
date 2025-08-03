import React from 'react';
import Diagram from '../Diagram';

export default function LocalCopy() {
  return (
    <Diagram>
      <svg width="720" height="320" viewBox="0 0 720 320" xmlns="http://www.w3.org/2000/svg">
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
            .db-box { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .db-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-500);
            }
            .sync-line {
              stroke: var(--ifm-color-success);
              stroke-width: 2;
              stroke-dasharray: 4 2;
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
          
          {/* Peer 1 */}
          <g transform="translate(80, 40)">
            <rect x="0" y="0" width="200" height="140" rx="4" ry="4" className="peer-box"/>
            <text x="20" y="30" className="text-icon-small">💻</text>
            <text x="45" y="30" className="text-heading">Peer 1</text>
            
            <g transform="translate(20, 50)">
              <rect x="0" y="0" width="160" height="70" rx="2" ry="2" className="db-box"/>
              <text x="80" y="30" className="text-body" textAnchor="middle">Complete</text>
              <text x="80" y="50" className="text-body" textAnchor="middle">replica</text>
            </g>
          </g>
          
          {/* Peer 2 */}
          <g transform="translate(440, 40)">
            <rect x="0" y="0" width="200" height="140" rx="4" ry="4" className="peer-box"/>
            <text x="20" y="30" className="text-icon-small">💻</text>
            <text x="45" y="30" className="text-heading">Peer 2</text>
            
            <g transform="translate(20, 50)">
              <rect x="0" y="0" width="160" height="70" rx="2" ry="2" className="db-box"/>
              <text x="80" y="30" className="text-body" textAnchor="middle">Complete</text>
              <text x="80" y="50" className="text-body" textAnchor="middle">replica</text>
            </g>
          </g>
          
          {/* Sync arrows */}
          <g>
            <path d="M 280 110 L 440 110" className="sync-line" markerEnd="url(#arrowhead)"/>
            <path d="M 440 110 L 280 110" className="sync-line" markerEnd="url(#arrowhead)" transform="translate(0, 10)"/>
            <text x="360" y="105" className="text-body" textAnchor="middle">Sync</text>
          </g>
          
          {/* Arrowhead marker */}
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--ifm-color-success)"/>
            </marker>
          </defs>
          
          {/* Caption */}
          <g transform="translate(30, 220)">
            <rect x="0" y="0" width="660" height="40" rx="4" ry="4" className="caption-box"/>
            <text x="20" y="25" className="text-icon-small">🌐</text>
            <text x="45" y="25" className="text-body">
              <tspan fontWeight="600" fill="var(--ifm-color-primary-darker)">Local-First:</tspan>
              <tspan dx="5">Zero-latency reads • Full offline mode • Instant queries</tspan>
            </text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}