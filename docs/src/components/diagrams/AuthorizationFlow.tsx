import React from 'react';
import Diagram from '../Diagram';

export default function AuthorizationFlow() {
  return (
    <Diagram>
      <svg width="800" height="420" viewBox="0 0 800 420" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>{`
            .input-stream { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .input-stream { 
              fill: var(--ifm-background-surface-color); 
              stroke: var(--ifm-color-emphasis-500);
            }
            .operation-box { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-emphasis-300); 
              stroke-width: 1; 
            }
            [data-theme='dark'] .operation-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-400);
            }
            .pipeline-outer { 
              fill: var(--ifm-color-primary-lightest); 
              stroke: var(--ifm-color-primary); 
              stroke-width: 2.5; 
            }
            [data-theme='dark'] .pipeline-outer { 
              fill: var(--ifm-color-primary-darkest); 
              stroke: var(--ifm-color-primary-light);
            }
            .pipeline-chamber { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-primary-dark); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .pipeline-chamber { 
              fill: var(--ifm-color-emphasis-1000); 
              stroke: var(--ifm-color-primary);
            }
            .allow-channel { 
              fill: var(--ifm-color-success-lightest); 
              stroke: var(--ifm-color-success); 
              stroke-width: 2; 
            }
            [data-theme='dark'] .allow-channel { 
              fill: var(--ifm-color-success-darkest); 
              stroke: var(--ifm-color-success-light);
            }
            .deny-channel { 
              fill: var(--ifm-color-danger-lightest); 
              stroke: var(--ifm-color-danger); 
              stroke-width: 2; 
            }
            [data-theme='dark'] .deny-channel { 
              fill: var(--ifm-color-danger-darkest); 
              stroke: var(--ifm-color-danger-light);
            }
            .flow-arrow { 
              stroke: var(--ifm-color-emphasis-600); 
              stroke-width: 1.5; 
              fill: none;
              marker-end: url(#arrowhead);
            }
            .flow-arrow-allow { 
              stroke: var(--ifm-color-success); 
              stroke-width: 2; 
              fill: none;
              marker-end: url(#arrowhead-allow);
            }
            .flow-arrow-deny { 
              stroke: var(--ifm-color-danger); 
              stroke-width: 2; 
              fill: none;
              marker-end: url(#arrowhead-deny);
            }
            .text-title { 
              font-size: 16px; 
              font-weight: 600; 
              fill: var(--ifm-color-primary-darker); 
            }
            [data-theme='dark'] .text-title { 
              fill: var(--ifm-color-primary-light); 
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
            .text-small { 
              font-size: 11px; 
              fill: var(--ifm-font-color-base); 
              opacity: 0.8;
            }
            .text-code { 
              font-family: var(--ifm-font-family-monospace); 
              font-size: 11px; 
              fill: var(--ifm-color-emphasis-700); 
            }
            [data-theme='dark'] .text-code { 
              fill: var(--ifm-color-emphasis-300); 
            }
            .text-pipeline { 
              font-size: 13px; 
              font-weight: 500;
              fill: var(--ifm-color-primary-darker); 
            }
            [data-theme='dark'] .text-pipeline { 
              fill: var(--ifm-color-gray-900); 
            }
            .text-allow { 
              fill: var(--ifm-color-success-darker); 
              font-weight: 600; 
            }
            [data-theme='dark'] .text-allow { 
              fill: var(--ifm-color-emphasis-1000); 
            }
            .text-deny { 
              fill: var(--ifm-color-danger-darker); 
              font-weight: 600; 
            }
            [data-theme='dark'] .text-deny { 
              fill: var(--ifm-color-emphasis-1000); 
            }
            .text-icon { font-size: 20px; }
            .text-icon-small { font-size: 16px; }
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
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="var(--ifm-color-emphasis-600)" />
          </marker>
          <marker id="arrowhead-allow" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="var(--ifm-color-success)" />
          </marker>
          <marker id="arrowhead-deny" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="var(--ifm-color-danger)" />
          </marker>
        </defs>

        <text x="400" y="30" textAnchor="middle" className="text-title">GoatDB Authorization Pipeline</text>
        <text x="400" y="50" textAnchor="middle" className="text-body">Every Operation Flows Through Authorization Rules</text>

        {/* Input Stream */}
        <g transform="translate(20, 80)">
          <rect x="0" y="0" width="160" height="250" rx="4" ry="4" className="input-stream"/>
          <text x="80" y="25" textAnchor="middle" className="text-heading">📝 Operations</text>
          
          {/* Operation 1 */}
          <g transform="translate(10, 45)">
            <rect x="0" y="0" width="140" height="60" rx="2" ry="2" className="operation-box"/>
            <text x="10" y="20" className="text-small">Session A</text>
            <text x="10" y="35" className="text-code">READ</text>
            <text x="10" y="50" className="text-code">/public/item1</text>
          </g>
          
          {/* Operation 2 */}
          <g transform="translate(10, 115)">
            <rect x="0" y="0" width="140" height="60" rx="2" ry="2" className="operation-box"/>
            <text x="10" y="20" className="text-small">Session B</text>
            <text x="10" y="35" className="text-code">WRITE</text>
            <text x="10" y="50" className="text-code">/user/xyz/item2</text>
          </g>
          
          {/* Operation 3 */}
          <g transform="translate(10, 185)">
            <rect x="0" y="0" width="140" height="60" rx="2" ry="2" className="operation-box"/>
            <text x="10" y="20" className="text-small">Session C</text>
            <text x="10" y="35" className="text-code">READ</text>
            <text x="10" y="50" className="text-code">/admin/config</text>
          </g>
        </g>

        {/* Flow arrows from input */}
        <path d="M 180 105 L 220 155" className="flow-arrow"/>
        <path d="M 180 175 L 220 175" className="flow-arrow"/>
        <path d="M 180 245 L 220 195" className="flow-arrow"/>

        {/* Authorization Pipeline */}
        <g transform="translate(220, 120)">
          <rect x="0" y="0" width="360" height="120" rx="60" ry="60" className="pipeline-outer"/>
          <text x="180" y="-10" textAnchor="middle" className="text-heading">🛡️ Authorization Pipeline</text>
          
          {/* Chamber 1: Pattern Match */}
          <g transform="translate(20, 20)">
            <rect x="0" y="0" width="100" height="80" rx="40" ry="40" className="pipeline-chamber"/>
            <text x="50" y="35" textAnchor="middle" className="text-icon">🎯</text>
            <text x="50" y="55" textAnchor="middle" className="text-pipeline">Pattern</text>
            <text x="50" y="70" textAnchor="middle" className="text-pipeline">Match</text>
          </g>
          
          {/* Chamber 2: Rule Function */}
          <g transform="translate(130, 20)">
            <rect x="0" y="0" width="100" height="80" rx="40" ry="40" className="pipeline-chamber"/>
            <text x="50" y="35" textAnchor="middle" className="text-icon">⚙️</text>
            <text x="50" y="55" textAnchor="middle" className="text-pipeline">Rule</text>
            <text x="50" y="70" textAnchor="middle" className="text-pipeline">Function</text>
          </g>
          
          {/* Chamber 3: Decision */}
          <g transform="translate(240, 20)">
            <rect x="0" y="0" width="100" height="80" rx="40" ry="40" className="pipeline-chamber"/>
            <text x="50" y="35" textAnchor="middle" className="text-icon">⚡</text>
            <text x="50" y="55" textAnchor="middle" className="text-pipeline">Boolean</text>
            <text x="50" y="70" textAnchor="middle" className="text-pipeline">Decision</text>
          </g>
        </g>

        {/* Output Channels */}
        <g transform="translate(620, 80)">
          {/* Allow Channel */}
          <g transform="translate(0, 0)">
            <rect x="0" y="0" width="160" height="100" rx="4" ry="4" className="allow-channel"/>
            <text x="80" y="30" textAnchor="middle" className="text-icon-small">✅</text>
            <text x="80" y="55" textAnchor="middle" className="text-heading text-allow">Allowed</text>
            <text x="80" y="75" textAnchor="middle" className="text-small">Access granted</text>
          </g>
          
          {/* Deny Channel */}
          <g transform="translate(0, 130)">
            <rect x="0" y="0" width="160" height="100" rx="4" ry="4" className="deny-channel"/>
            <text x="80" y="30" textAnchor="middle" className="text-icon-small">❌</text>
            <text x="80" y="55" textAnchor="middle" className="text-heading text-deny">Denied</text>
            <text x="80" y="75" textAnchor="middle" className="text-small">Access blocked</text>
          </g>
        </g>

        {/* Flow arrows to output */}
        <path d="M 580 160 Q 600 140 620 130" className="flow-arrow-allow"/>
        <path d="M 580 200 Q 590 240 620 260" className="flow-arrow-deny"/>

        {/* Caption */}
        <g transform="translate(20, 350)">
          <rect x="0" y="0" width="760" height="50" rx="4" ry="4" className="caption-box"/>
          <text x="20" y="30" className="text-icon-small">🔐</text>
          <text x="45" y="30" className="text-body">
            <tspan fontWeight="600" fill="var(--ifm-color-primary-darker)">Authorization Pipeline:</tspan>
            <tspan dx="5">Pattern matching → Rule execution → Boolean decision • Applied to every operation</tspan>
          </text>
        </g>
      </svg>
    </Diagram>
  );
}