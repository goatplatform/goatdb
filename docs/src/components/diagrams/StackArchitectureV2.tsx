import React from 'react';
import Diagram from '../Diagram';

export default function StackArchitectureV2() {
  return (
    <Diagram>
      <svg width="720" height="380" viewBox="0 0 720 380" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>{`
            .section-bg { 
              fill: none; 
              stroke: var(--ifm-color-emphasis-300); 
              stroke-width: 1; 
              stroke-dasharray: 4 2;
            }
            [data-theme='dark'] .section-bg { 
              fill: none;
              stroke: var(--ifm-color-emphasis-400);
            }
            
            .traditional-component { 
              fill: none; 
              stroke: var(--ifm-color-danger-dark); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .traditional-component { 
              fill: none; 
              stroke: var(--ifm-color-danger);
            }
            
            .goatdb-component { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-success); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .goatdb-component { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-success-light);
            }
            
            .unified-box {
              fill: none;
              stroke: var(--ifm-color-success-dark);
              stroke-width: 2;
            }
            [data-theme='dark'] .unified-box {
              fill: none;
              stroke: var(--ifm-color-success);
            }
            
            .mini-component {
              fill: none;
              stroke: var(--ifm-color-emphasis-600);
              stroke-width: 1;
            }
            [data-theme='dark'] .mini-component {
              fill: none;
              stroke: var(--ifm-color-emphasis-500);
            }
            
            .connection-line {
              stroke: var(--ifm-color-emphasis-500);
              stroke-width: 1.5;
              fill: none;
            }
            [data-theme='dark'] .connection-line {
              stroke: var(--ifm-color-emphasis-500);
            }
            
            .deploy-indicator {
              fill: var(--ifm-color-warning-lighter);
              stroke: var(--ifm-color-warning-dark);
              stroke-width: 2;
            }
            [data-theme='dark'] .deploy-indicator {
              fill: var(--ifm-color-warning-darker);
              stroke: var(--ifm-color-warning);
            }
            
            .deploy-text {
              font-size: 16px;
              font-weight: 700;
              fill: var(--ifm-color-emphasis-900);
            }
            [data-theme='dark'] .deploy-text {
              fill: var(--ifm-color-emphasis-100);
            }
            
            .text-title { 
              font-size: 15px; 
              font-weight: 600; 
              fill: var(--ifm-font-color-base); 
            }
            
            .text-component { 
              font-size: 13px; 
              fill: var(--ifm-font-color-base);
              opacity: 0.9;
            }
            
            .text-label { 
              font-size: 11px; 
              fill: var(--ifm-font-color-base);
              opacity: 0.8;
            }
            
            .text-white {
              fill: white;
            }
            
            .complexity-indicator {
              fill: var(--ifm-color-emphasis-100);
              stroke: var(--ifm-color-emphasis-400);
              stroke-width: 1;
            }
            [data-theme='dark'] .complexity-indicator {
              fill: var(--ifm-background-surface-color);
              stroke: var(--ifm-color-emphasis-500);
            }
            
            .complexity-high {
              fill: var(--ifm-color-danger);
              font-size: 12px;
            }
            [data-theme='dark'] .complexity-high {
              fill: var(--ifm-color-danger-light);
            }
            
            .complexity-low {
              fill: var(--ifm-color-success);
              font-size: 12px;
            }
            [data-theme='dark'] .complexity-low {
              fill: var(--ifm-color-success-light);
            }
            
            .icon-circle {
              fill: var(--ifm-color-emphasis-100);
              stroke: none;
            }
            [data-theme='dark'] .icon-circle {
              fill: var(--ifm-color-emphasis-200);
              stroke: none;
            }
            
            .benefit-card {
              fill: var(--ifm-background-color);
              stroke: var(--ifm-color-emphasis-400);
              stroke-width: 1;
            }
            [data-theme='dark'] .benefit-card {
              fill: var(--ifm-color-emphasis-100);
              stroke: var(--ifm-color-emphasis-500);
            }
          `}</style>
          
          <marker id="arrow" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto">
            <polygon points="0 0, 6 2.5, 0 5" fill="var(--ifm-color-emphasis-600)"/>
          </marker>
        </defs>
        
        {/* Traditional Architecture Side */}
        <g transform="translate(20, 20)">
          <rect x="0" y="0" width="330" height="335" rx="8" className="section-bg"/>
          
          <text x="165" y="35" className="text-title" textAnchor="middle">
            Traditional Architecture
          </text>
          
          {/* Components - 80px spacing grid */}
          <g transform="translate(30, 60)">
            {/* Client */}
            <g transform="translate(0, 0)">
              <rect x="0" y="0" width="270" height="60" rx="4" className="traditional-component"/>
              {/* Client icon - simplified monitor */}
              <g transform="translate(21, 18)">
                <rect x="0" y="0" width="28" height="20" rx="2" stroke="var(--ifm-color-emphasis-700)" strokeWidth="1.5" fill="none"/>
                <rect x="3" y="3" width="22" height="14" stroke="var(--ifm-color-emphasis-600)" strokeWidth="1" fill="none"/>
              </g>
              <text x="75" y="35" className="text-component">Client Application</text>
              
              {/* Deploy indicator */}
              <circle cx="235" cy="30" r="16" className="deploy-indicator"/>
              <text x="235" y="36" className="deploy-text" textAnchor="middle">1</text>
            </g>
            
            {/* Connection arrow */}
            <line x1="135" y1="61" x2="135" y2="78" className="connection-line" markerEnd="url(#arrow)"/>
            <text x="150" y="75" className="text-label">HTTP/REST</text>
            
            {/* Server */}
            <g transform="translate(0, 80)">
              <rect x="0" y="0" width="270" height="60" rx="4" className="traditional-component"/>              {/* Server icon - simplified rack */}
              <g transform="translate(21, 20)">
                <line x1="0" y1="0" x2="28" y2="0" stroke="var(--ifm-color-emphasis-700)" strokeWidth="1.5"/>
                <line x1="0" y1="10" x2="28" y2="10" stroke="var(--ifm-color-emphasis-700)" strokeWidth="1.5"/>
                <line x1="0" y1="20" x2="28" y2="20" stroke="var(--ifm-color-emphasis-700)" strokeWidth="1.5"/>
                <circle cx="5" cy="0" r="2.5" fill="var(--ifm-color-emphasis-600)"/>
                <circle cx="5" cy="10" r="2.5" fill="var(--ifm-color-emphasis-600)"/>
                <circle cx="5" cy="20" r="2.5" fill="var(--ifm-color-emphasis-600)"/>
              </g>
              <text x="75" y="35" className="text-component">API Server</text>
              
              {/* Deploy indicator */}
              <circle cx="235" cy="30" r="16" className="deploy-indicator"/>
              <text x="235" y="36" className="deploy-text" textAnchor="middle">2</text>
            </g>
            
            {/* Connection arrow */}
            <line x1="135" y1="141" x2="135" y2="158" className="connection-line" markerEnd="url(#arrow)"/>
            <text x="150" y="155" className="text-label">SQL/TCP</text>
            
            {/* Database */}
            <g transform="translate(0, 160)">
              <rect x="0" y="0" width="270" height="60" rx="4" className="traditional-component"/>
              {/* Database icon - simplified layers */}
              <g transform="translate(21, 18)">
                <rect x="0" y="0" width="28" height="6" stroke="var(--ifm-color-emphasis-700)" strokeWidth="1.5" fill="none"/>
                <rect x="0" y="8" width="28" height="6" stroke="var(--ifm-color-emphasis-700)" strokeWidth="1.5" fill="none"/>
                <rect x="0" y="16" width="28" height="6" stroke="var(--ifm-color-emphasis-700)" strokeWidth="1.5" fill="none"/>
              </g>
              <text x="75" y="35" className="text-component">Database Server</text>
              
              {/* Deploy indicator */}
              <circle cx="235" cy="30" r="16" className="deploy-indicator"/>
              <text x="235" y="36" className="deploy-text" textAnchor="middle">3</text>
            </g>
          </g>
          
          {/* Complexity indicator */}
          <g transform="translate(30, 310)">
            <rect x="0" y="0" width="270" height="45" rx="4" className="complexity-indicator"/>
            <text x="10" y="20" className="complexity-high">⚠️ High Complexity</text>
            <text x="28" y="35" className="text-label">3 deployments • Config • Latency</text>
          </g>
        </g>
        
        {/* GoatDB Architecture Side */}
        <g transform="translate(370, 20)">
          <rect x="0" y="0" width="330" height="335" rx="8" className="section-bg"/>
          
          <text x="165" y="35" className="text-title" textAnchor="middle">
            GoatDB Architecture
          </text>
          
          {/* Single Executable */}
          <g transform="translate(30, 60)">
            <rect x="0" y="0" width="270" height="120" rx="8" className="unified-box"/>
            
            <text x="135" y="30" className="text-component" textAnchor="middle" fontSize="16">
              Single Executable
            </text>
            
            {/* Mini components inside */}
            <g transform="translate(15, 50)">
              <rect x="0" y="0" width="75" height="50" rx="4" className="mini-component"/>
              {/* Mini client icon */}
              <g transform="translate(25, 12)">
                <rect x="0" y="0" width="20" height="14" rx="1" stroke="var(--ifm-color-emphasis-600)" strokeWidth="1" fill="none"/>
                <rect x="3" y="3" width="14" height="8" stroke="var(--ifm-color-emphasis-500)" strokeWidth="1" fill="none"/>
              </g>
              <text x="37" y="40" className="text-label" textAnchor="middle">Client</text>
              
              <rect x="85" y="0" width="75" height="50" rx="4" className="mini-component"/>
              {/* Mini server icon */}
              <g transform="translate(110, 14)">
                <line x1="0" y1="0" x2="20" y2="0" stroke="var(--ifm-color-emphasis-600)" strokeWidth="1"/>
                <line x1="0" y1="6" x2="20" y2="6" stroke="var(--ifm-color-emphasis-600)" strokeWidth="1"/>
                <line x1="0" y1="12" x2="20" y2="12" stroke="var(--ifm-color-emphasis-600)" strokeWidth="1"/>
                <circle cx="3" cy="0" r="1.5" fill="var(--ifm-color-emphasis-600)"/>
                <circle cx="3" cy="6" r="1.5" fill="var(--ifm-color-emphasis-600)"/>
                <circle cx="3" cy="12" r="1.5" fill="var(--ifm-color-emphasis-600)"/>
              </g>
              <text x="122" y="40" className="text-label" textAnchor="middle">Server</text>
              
              <rect x="170" y="0" width="75" height="50" rx="4" className="mini-component"/>
              {/* Mini database icon */}
              <g transform="translate(195, 12)">
                <rect x="0" y="0" width="20" height="5" stroke="var(--ifm-color-emphasis-600)" strokeWidth="1" fill="none"/>
                <rect x="0" y="6" width="20" height="5" stroke="var(--ifm-color-emphasis-600)" strokeWidth="1" fill="none"/>
                <rect x="0" y="12" width="20" height="5" stroke="var(--ifm-color-emphasis-600)" strokeWidth="1" fill="none"/>
              </g>
              <text x="207" y="40" className="text-label" textAnchor="middle">Database</text>
            </g>
            
            {/* Single deploy indicator */}
            <g transform="translate(205, -28)">
              <circle cx="30" cy="30" r="20" className="deploy-indicator"/>
              <text x="30" y="35" className="deploy-text" textAnchor="middle" fontSize="18">1</text>
            </g>
          </g>
          
          {/* Benefits visualization */}
          <g transform="translate(30, 200)">
            <rect x="0" y="0" width="62" height="40" rx="4" className="benefit-card"/>
            <text x="31" y="20" className="text-label" textAnchor="middle">Zero</text>
            <text x="31" y="32" className="text-label" textAnchor="middle">Config</text>
            
            <rect x="69" y="0" width="62" height="40" rx="4" className="benefit-card"/>
            <text x="100" y="20" className="text-label" textAnchor="middle">Low</text>
            <text x="100" y="32" className="text-label" textAnchor="middle">Latency</text>
            
            <rect x="138" y="0" width="62" height="40" rx="4" className="benefit-card"/>
            <text x="169" y="20" className="text-label" textAnchor="middle">Self</text>
            <text x="169" y="32" className="text-label" textAnchor="middle">Contained</text>
            
            <rect x="207" y="0" width="63" height="40" rx="4" className="benefit-card"/>
            <text x="238" y="20" className="text-label" textAnchor="middle">Run</text>
            <text x="238" y="32" className="text-label" textAnchor="middle">Anywhere</text>
          </g>
          
          {/* Complexity indicator */}
          <g transform="translate(30, 310)">
            <rect x="0" y="0" width="270" height="45" rx="4" className="complexity-indicator"/>
            <text x="10" y="20" className="complexity-low">✓ Low Complexity</text>
            <text x="24" y="35" className="text-label">1 deployment • Zero config • Direct</text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}