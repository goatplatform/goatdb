import React from 'react';
import Diagram from '../Diagram';

export default function RepositoryStructure() {
  return (
    <Diagram>
      <svg width="720" height="420" viewBox="0 0 720 420" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>{`
            .file-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-primary); 
              stroke-width: 2.5; 
            }
            [data-theme='dark'] .file-box { 
              fill: var(--ifm-background-surface-color); 
              stroke: var(--ifm-color-primary-light);
            }
            .commit-line { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .commit-line { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-500);
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
            .arrow-append {
              stroke: var(--ifm-color-success);
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
            .text-code { 
              font-family: var(--ifm-font-family-monospace); 
              font-size: 10px; 
              fill: var(--ifm-color-primary-darker); 
              font-weight: 500;
            }
            .text-code-result { 
              font-family: var(--ifm-font-family-monospace); 
              font-size: 10px; 
              fill: var(--ifm-color-primary-darker); 
              font-weight: 500;
            }
            [data-theme='dark'] .text-code-result {
              fill: var(--ifm-color-gray-900);
            }
            [data-theme='dark'] .text-code { 
              fill: var(--ifm-color-primary-light); 
            }
            .text-small { 
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
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="var(--ifm-color-success)"/>
          </marker>
        </defs>
        
        <g transform="translate(0, 0)">
          <rect width="720" height="420" rx="8" ry="8" className="bg-section"/>
          
          {/* Repository File */}
          <g transform="translate(160, 30)">
            <rect x="0" y="0" width="400" height="280" rx="4" ry="4" className="file-box"/>
            <text x="20" y="30" className="text-icon-small">📄</text>
            <text x="45" y="30" className="text-heading">users.jsonl</text>
            
            {/* Existing commits */}
            <g transform="translate(20, 50)">
              <rect x="0" y="0" width="360" height="30" rx="2" ry="2" className="commit-line"/>
              <text x="10" y="20" className="text-code">{`{"id":"abc123","key":"/data/users/jane", ... }`}</text>
              
              <rect x="0" y="40" width="360" height="30" rx="2" ry="2" className="commit-line"/>
              <text x="10" y="60" className="text-code">{`{"id":"def456","key":"/data/users/john", ... }`}</text>
              
              <rect x="0" y="80" width="360" height="30" rx="2" ry="2" className="commit-line"/>
              <text x="10" y="100" className="text-code">{`{"id":"ghi789","key":"/data/users/alice", ... }`}</text>
              
              <rect x="0" y="120" width="360" height="30" rx="2" ry="2" className="commit-line"/>
              <text x="10" y="140" className="text-code">{`{"id":"jkl012","key":"/data/users/bob", ... }`}</text>
            </g>
            
            {/* Append arrow */}
            <path d="M 200 210 L 200 250" className="arrow-append"/>
            
            {/* New commit being appended */}
            <g transform="translate(20, 264)">
              <rect x="0" y="0" width="360" height="30" rx="2" ry="2" className="new-commit"/>
              <text x="10" y="20" className="text-code-result">{`{"id":"mno345","key":"/data/users/carol", ... }`}</text>
            </g>
          </g>
          
          {/* Key features */}
          <g transform="translate(30, 70)">
            <text x="0" y="0" className="text-body" fontWeight="600">Append-Only</text>
            <text x="0" y="20" className="text-small">• Sequential writes</text>
            <text x="0" y="40" className="text-small">• SSD optimized</text>
            <text x="0" y="60" className="text-small">• Atomic commits</text>
          </g>
          
          <g transform="translate(590, 70)">
            <text x="0" y="0" className="text-body" fontWeight="600">JSON Lines</text>
            <text x="0" y="20" className="text-small">• Human readable</text>
            <text x="0" y="40" className="text-small">• One commit per line</text>
            <text x="0" y="60" className="text-small">• Easy debugging</text>
          </g>
          
          {/* Caption */}
          <g transform="translate(30, 340)">
            <rect x="0" y="0" width="660" height="60" rx="4" ry="4" className="caption-box"/>
            <text x="20" y="25" className="text-icon-small">💾</text>
            <text x="45" y="25" className="text-body">
              <tspan fontWeight="600" fill="var(--ifm-color-primary-darker)">Append-Only Storage:</tspan>
              <tspan dx="5">One .jsonl file per repository • Sequential I/O</tspan>
            </text>
            <text x="45" y="45" className="text-body">Optimized for SSDs • Atomic commits • Human-readable format</text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}