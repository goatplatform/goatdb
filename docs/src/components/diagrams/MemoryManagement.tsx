import React from 'react';
import Diagram from '../Diagram';

export default function MemoryManagement() {
  return (
    <Diagram>
      <svg width="720" height="640" viewBox="0 0 720 640" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>{`
            .section-cloud { 
              fill: #f0f7ff; 
              stroke: #4a90e2; 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .section-cloud { 
              fill: var(--ifm-background-surface-color);
              stroke: var(--ifm-color-info-light);
            }
            .section-ram { 
              fill: #f5f3ff; 
              stroke: var(--ifm-color-primary-dark); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .section-ram { 
              fill: var(--ifm-background-surface-color);
              stroke: var(--ifm-color-primary-light);
            }
            .section-disk { 
              fill: #f8f9fa; 
              stroke: #6c757d; 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .section-disk { 
              fill: var(--ifm-background-surface-color);
              stroke: var(--ifm-color-emphasis-600);
            }
            .repo-active { 
              fill: var(--ifm-color-primary-lighter); 
              stroke: var(--ifm-color-primary-dark); 
              stroke-width: 2.5; 
            }
            [data-theme='dark'] .repo-active { 
              fill: var(--ifm-color-primary-darkest); 
              stroke: var(--ifm-color-primary);
              opacity: 0.9;
            }
            .repo-inactive { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 1.5; 
              opacity: 0.7;
            }
            [data-theme='dark'] .repo-inactive { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-500);
              opacity: 0.6;
            }
            .sync-arrow { 
              stroke: var(--ifm-color-primary-dark); 
              stroke-width: 1.5; 
              fill: none; 
              marker-end: url(#arrowhead); 
            }
            [data-theme='dark'] .sync-arrow { 
              stroke: var(--ifm-color-primary); 
            }
            .text-heading { 
              font-size: 15px; 
              font-weight: 600; 
              fill: var(--ifm-font-color-base); 
            }
            .text-body { 
              font-size: 12px; 
              font-weight: 500;
              fill: var(--ifm-font-color-base); 
            }
            .text-icon-small { font-size: 20px; }
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
            <polygon points="0 0, 10 4, 0 8" className="arrow-marker" />
          </marker>
          <style>{`
            .arrow-marker { fill: var(--ifm-color-primary-dark); }
            [data-theme='dark'] .arrow-marker { fill: var(--ifm-color-primary); }
          `}</style>
        </defs>
        
        <g transform="translate(0, 0)">
          {/* Cloud Section */}
          <g transform="translate(0, 0)">
            <rect x="0" y="0" width="720" height="140" rx="8" ry="8" className="section-cloud"/>
            <text x="20" y="30" className="text-icon-small">☁️</text>
            <text x="45" y="30" className="text-heading">Remote Server</text>
            
            <g transform="translate(220, 50)">
              <rect x="0" y="0" width="80" height="60" rx="4" ry="4" className="repo-active"/>
              <text x="40" y="35" textAnchor="middle" className="text-body">repo1</text>
              
              <rect x="120" y="0" width="80" height="60" rx="4" ry="4" className="repo-active"/>
              <text x="160" y="35" textAnchor="middle" className="text-body">repo2</text>
              
              <rect x="240" y="0" width="80" height="60" rx="4" ry="4" className="repo-active"/>
              <text x="280" y="35" textAnchor="middle" className="text-body">repo3</text>
            </g>
          </g>
          
          {/* RAM Section */}
          <g transform="translate(0, 200)">
            <rect x="0" y="0" width="720" height="140" rx="8" ry="8" className="section-ram"/>
            <text x="20" y="30" className="text-icon-small">🧠</text>
            <text x="45" y="30" className="text-heading">Local RAM</text>
            
            <g transform="translate(220, 50)">
              <rect x="0" y="0" width="80" height="60" rx="4" ry="4" className="repo-active"/>
              <text x="40" y="35" textAnchor="middle" className="text-body">repo1</text>
              
              <rect x="120" y="0" width="80" height="60" rx="4" ry="4" className="repo-active"/>
              <text x="160" y="35" textAnchor="middle" className="text-body">repo2</text>
              
              <rect x="240" y="0" width="80" height="60" rx="4" ry="4" className="repo-active"/>
              <text x="280" y="35" textAnchor="middle" className="text-body">repo3</text>
            </g>
          </g>
          
          {/* Disk Section */}
          <g transform="translate(0, 400)">
            <rect x="0" y="0" width="720" height="140" rx="8" ry="8" className="section-disk"/>
            <text x="20" y="30" className="text-icon-small">💾</text>
            <text x="45" y="30" className="text-heading">Local Disk</text>
            
            <g transform="translate(90, 50)">
              <rect x="0" y="0" width="70" height="50" rx="4" ry="4" className="repo-inactive"/>
              <text x="35" y="30" textAnchor="middle" className="text-body">repo1</text>
              
              <rect x="85" y="0" width="70" height="50" rx="4" ry="4" className="repo-inactive"/>
              <text x="120" y="30" textAnchor="middle" className="text-body">repo2</text>
              
              <rect x="170" y="0" width="70" height="50" rx="4" ry="4" className="repo-inactive"/>
              <text x="205" y="30" textAnchor="middle" className="text-body">repo3</text>
              
              <rect x="255" y="0" width="70" height="50" rx="4" ry="4" className="repo-inactive"/>
              <text x="290" y="30" textAnchor="middle" className="text-body">repo4</text>
              
              <rect x="340" y="0" width="70" height="50" rx="4" ry="4" className="repo-inactive"/>
              <text x="375" y="30" textAnchor="middle" className="text-body">repo5</text>
              
              <rect x="425" y="0" width="70" height="50" rx="4" ry="4" className="repo-inactive"/>
              <text x="460" y="30" textAnchor="middle" className="text-body">repo6</text>
              
              <rect x="510" y="0" width="70" height="50" rx="4" ry="4" className="repo-inactive"/>
              <text x="545" y="30" textAnchor="middle" className="text-body">repo7</text>
            </g>
          </g>
          
          {/* Sync Arrows - Cloud to RAM */}
          <g>
            <line x1="260" y1="142" x2="260" y2="198" className="sync-arrow"/>
            <line x1="280" y1="198" x2="280" y2="142" className="sync-arrow"/>
          </g>
          
          <g>
            <line x1="380" y1="142" x2="380" y2="198" className="sync-arrow"/>
            <line x1="400" y1="198" x2="400" y2="142" className="sync-arrow"/>
          </g>
          
          <g>
            <line x1="500" y1="142" x2="500" y2="198" className="sync-arrow"/>
            <line x1="520" y1="198" x2="520" y2="142" className="sync-arrow"/>
          </g>
          
          {/* Sync Arrows - RAM to Disk */}
          <g>
            <line x1="260" y1="342" x2="260" y2="398" className="sync-arrow"/>
            <line x1="280" y1="398" x2="280" y2="342" className="sync-arrow"/>
          </g>
          
          <g>
            <line x1="380" y1="342" x2="380" y2="398" className="sync-arrow"/>
            <line x1="400" y1="398" x2="400" y2="342" className="sync-arrow"/>
          </g>
          
          <g>
            <line x1="500" y1="342" x2="500" y2="398" className="sync-arrow"/>
            <line x1="520" y1="398" x2="520" y2="342" className="sync-arrow"/>
          </g>
          
          {/* Caption */}
          <g transform="translate(30, 560)">
            <rect x="0" y="0" width="660" height="60" rx="4" ry="4" className="caption-box"/>
            <text x="20" y="25" className="text-icon-small">💾</text>
            <text x="45" y="25" className="text-body">
              <tspan fontWeight="600" fill="var(--ifm-color-primary-darker)">Explicit Control:</tspan>
              <tspan dx="5">Load only what you need • Active repos in RAM</tspan>
            </text>
            <text x="45" y="45" className="text-body">Two-way sync: RAM ↔ Disk and RAM ↔ Remote</text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}