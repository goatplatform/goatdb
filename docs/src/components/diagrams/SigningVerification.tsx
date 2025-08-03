import React from 'react';
import Diagram from '../Diagram';

export default function SigningVerification() {
  return (
    <Diagram>
      <svg width="720" height="490" viewBox="0 0 720 490" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>{`
            .machine-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 1.5; 
              stroke-dasharray: 6 3; 
            }
            [data-theme='dark'] .machine-box { 
              fill: var(--ifm-background-surface-color); 
              stroke: var(--ifm-color-emphasis-500);
              opacity: 0.5;
            }
            .network-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 1.5; 
              stroke-dasharray: 6 3; 
            }
            [data-theme='dark'] .network-box { 
              fill: var(--ifm-background-surface-color); 
              stroke: var(--ifm-color-emphasis-500);
              opacity: 0.9;
            }
            .operation-box { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 2; 
            }
            [data-theme='dark'] .operation-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-500);
            }
            .private-key-box .operation-box {
              stroke: var(--ifm-color-danger);
              fill: var(--ifm-color-danger-lightest);
            }
            [data-theme='dark'] .private-key-box .operation-box {
              stroke: var(--ifm-color-danger-light);
              fill: var(--ifm-color-danger-darkest);
            }
            .public-key-box .operation-box {
              stroke: var(--ifm-color-success);
              fill: var(--ifm-color-success-lightest);
            }
            [data-theme='dark'] .public-key-box .operation-box {
              stroke: var(--ifm-color-success-light);
              fill: var(--ifm-color-success-darkest);
            }
            .signed-commit-box .operation-box {
              stroke: var(--ifm-color-primary);
              fill: var(--ifm-color-primary-lightest);
            }
            [data-theme='dark'] .signed-commit-box .operation-box {
              stroke: var(--ifm-color-primary-light);
              fill: var(--ifm-color-primary-darkest);
            }
            .send-arrow {
              stroke: var(--ifm-color-primary);
              stroke-width: 2;
              fill: none;
              marker-end: url(#arrowhead2);
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
              font-size: 12px; 
              font-weight: 500;
            }
            [data-theme='dark'] .private-key-box .text-code { 
              fill: var(--ifm-color-emphasis-1000); 
            }
            [data-theme='dark'] .public-key-box .text-code { 
              fill: var(--ifm-color-gray-900); 
            }
            [data-theme='dark'] .public-key-box .text-small { 
              fill: var(--ifm-color-gray-900); 
            }
            .text-danger { 
              fill: var(--ifm-color-danger); 
            }
            .text-success { 
              fill: var(--ifm-color-success-darker); 
            }
            [data-theme='dark'] .text-success { 
              fill: var(--ifm-color-success-light); 
            }
            .text-primary { 
              fill: var(--ifm-color-primary-darker); 
            }
            [data-theme='dark'] .text-primary { 
              fill: var(--ifm-color-primary-light); 
            }
            [data-theme='dark'] .signed-commit-box .text-primary { 
              fill: var(--ifm-color-gray-900); 
            }
            [data-theme='dark'] .signed-commit-box .text-heading { 
              fill: var(--ifm-color-gray-900); 
            }
            .text-operator {
              font-size: 24px;
              font-weight: 300;
              fill: var(--ifm-color-emphasis-600);
            }
            .text-icon { font-size: 20px; }
            .text-icon-small { font-size: 16px; }
            .text-icon-large { font-size: 24px; }
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
          <marker id="arrowhead2" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="var(--ifm-color-primary)"/>
          </marker>
        </defs>
        
        <g transform="translate(0, 0)">
          {/* On Peer Machine */}
          <g transform="translate(20, 30)">
            <rect x="0" y="0" width="280" height="380" rx="8" ry="8" className="machine-box"/>
            <text x="140" y="30" className="text-icon-large" textAnchor="middle">💻</text>
            <text x="140" y="55" className="text-heading" textAnchor="middle">On Peer Machine</text>
            
            {/* Operation */}
            <g transform="translate(65, 80)">
              <rect x="0" y="0" width="150" height="60" rx="4" ry="4" className="operation-box"/>
              <text x="15" y="25" className="text-icon">📄</text>
              <text x="40" y="25" className="text-heading">Operation</text>
              <text x="75" y="45" className="text-body" textAnchor="middle">(e.g., write)</text>
            </g>
            
            <text x="140" y="160" className="text-operator" textAnchor="middle">+</text>
            
            {/* Private Key */}
            <g transform="translate(65, 175)" className="private-key-box">
              <rect x="0" y="0" width="150" height="50" rx="4" ry="4" className="operation-box"/>
              <text x="15" y="25" className="text-icon-small">🔑</text>
              <text x="40" y="25" className="text-code text-danger">Private Key</text>
            </g>
            
            <text x="140" y="245" className="text-operator" textAnchor="middle">=</text>
            
            {/* Signed Commit */}
            <g transform="translate(65, 260)" className="signed-commit-box">
              <rect x="0" y="0" width="150" height="60" rx="4" ry="4" className="operation-box"/>
              <text x="15" y="30" className="text-icon-small">✍️</text>
              <text x="75" y="25" className="text-heading text-primary" textAnchor="middle">Signed</text>
              <text x="75" y="45" className="text-heading text-primary" textAnchor="middle">Commit</text>
            </g>
            
            <text x="140" y="340" className="text-body" textAnchor="middle">Signed using session's</text>
            <text x="140" y="360" className="text-body" textAnchor="middle">private key</text>
          </g>
          
          {/* Send arrow */}
          <g transform="translate(300, 235)">
            <path d="M 10 0 L 70 0" className="send-arrow"/>
            <text x="40" y="-12" className="text-small" textAnchor="middle">Sent</text>
          </g>
          
          {/* In GoatDB Network */}
          <g transform="translate(380, 30)">
            <rect x="0" y="0" width="320" height="380" rx="8" ry="8" className="network-box"/>
            <text x="160" y="30" className="text-icon-large" textAnchor="middle">🌐</text>
            <text x="160" y="55" className="text-heading" textAnchor="middle">In GoatDB Network (Peers)</text>
            
            {/* Signed Commit */}
            <g transform="translate(85, 80)" className="signed-commit-box">
              <rect x="0" y="0" width="150" height="60" rx="4" ry="4" className="operation-box"/>
              <text x="15" y="30" className="text-icon-small">✍️</text>
              <text x="75" y="25" className="text-heading text-primary" textAnchor="middle">Signed</text>
              <text x="75" y="45" className="text-heading text-primary" textAnchor="middle">Commit</text>
            </g>
            
            <text x="160" y="160" className="text-operator" textAnchor="middle">+</text>
            
            {/* Public Key */}
            <g transform="translate(85, 180)" className="public-key-box">
              <rect x="0" y="0" width="150" height="60" rx="4" ry="4" className="operation-box"/>
              <text x="15" y="25" className="text-icon-small">🔑</text>
              <text x="40" y="25" className="text-code text-success">Public Key</text>
              <text x="75" y="45" className="text-small" textAnchor="middle">(From session)</text>
            </g>
            
            {/* Verification Result */}
            <g transform="translate(160, 265)" textAnchor="middle">
              <text y="4" className="text-icon-large text-success">✅</text>
              <text y="25" className="text-heading text-success">Verification Successful</text>
              <text y="45" className="text-body">• Content Integrity Confirmed</text>
              <text y="61" className="text-body">• Creator Identity Proven</text>
            </g>
            
            <text x="160" y="346" className="text-body" textAnchor="middle">Peers verify signature</text>
            <text x="160" y="364" className="text-body" textAnchor="middle">using public key</text>
          </g>
          
          {/* Caption */}
          <g transform="translate(30, 420)">
            <rect x="0" y="0" width="660" height="60" rx="4" ry="4" className="caption-box"/>
            <text x="20" y="25" className="text-icon-small">🔏</text>
            <text x="45" y="25" className="text-body">
              <tspan fontWeight="600" fill="var(--ifm-color-primary-darker)">Cryptographic Signing:</tspan>
              <tspan dx="5">Every commit signed with private key</tspan>
            </text>
            <text x="45" y="45" className="text-body">Dual verification: Content integrity + Creator identity</text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}