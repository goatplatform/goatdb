import React from 'react';
import Diagram from '../Diagram';

export default function KeyGeneration() {
  return (
    <Diagram>
      <svg width="720" height="400" viewBox="0 0 720 400" xmlns="http://www.w3.org/2000/svg">
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
            .key-box { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 2; 
            }
            [data-theme='dark'] .key-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-500);
            }
            .private-key .key-box {
              stroke: var(--ifm-color-danger);
              fill: var(--ifm-color-danger-lightest);
            }
            [data-theme='dark'] .private-key .key-box {
              stroke: var(--ifm-color-danger-light);
              fill: var(--ifm-color-danger-darkest);
            }
            .public-key .key-box {
              stroke: var(--ifm-color-success);
              fill: var(--ifm-color-success-lightest);
            }
            [data-theme='dark'] .public-key .key-box {
              stroke: var(--ifm-color-success-light);
              fill: var(--ifm-color-success-darkest);
            }
            .session-box .key-box {
              stroke: var(--ifm-color-primary);
              fill: var(--ifm-color-primary-lightest);
            }
            [data-theme='dark'] .session-box .key-box {
              stroke: var(--ifm-color-primary-light);
              fill: var(--ifm-color-primary-darkest);
            }
            .session-info-box { 
              fill: var(--ifm-background-color); 
              stroke: var(--ifm-color-emphasis-400); 
              stroke-width: 1.5; 
            }
            [data-theme='dark'] .session-info-box { 
              fill: var(--ifm-color-emphasis-100); 
              stroke: var(--ifm-color-emphasis-500);
            }
            .share-arrow {
              stroke: var(--ifm-color-primary);
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
            [data-theme='dark'] .private-key .text-code {
              fill: var(--ifm-color-emphasis-1000);
            }
            [data-theme='dark'] .private-key .text-body {
              fill: var(--ifm-color-emphasis-1000);
            }
            [data-theme='dark'] .public-key .text-code {
              fill: var(--ifm-color-gray-900);
            }
            .text-danger { 
              fill: var(--ifm-color-danger); 
            }
            .text-success { 
              fill: var(--ifm-color-success-darker); 
            }
            [data-theme='dark'] .public-key .text-success {
              fill: var(--ifm-color-gray-900);
            }
            [data-theme='dark'] .public-key .text-small {
              fill: var(--ifm-color-gray-900);
            }
            .text-primary { 
              fill: var(--ifm-color-primary-darker); 
            }
            [data-theme='dark'] .text-primary { 
              fill: var(--ifm-color-primary-light); 
            }
            [data-theme='dark'] .session-box .text-primary {
              fill: var(--ifm-color-gray-900);
            }
            [data-theme='dark'] .session-box .text-heading {
              fill: var(--ifm-color-gray-900);
            }
            [data-theme='dark'] .session-box .text-small {
              fill: var(--ifm-color-gray-900);
            }
            [data-theme='dark'] .session-info-box .text-body {
              fill: var(--ifm-color-gray-900);
            }
            [data-theme='dark'] .session-info-box .text-small {
              fill: var(--ifm-color-gray-900);
            }
            .text-icon { font-size: 24px; }
            .text-icon-small { font-size: 18px; }
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
            <polygon points="0 0, 10 3.5, 0 7" fill="var(--ifm-color-primary)"/>
          </marker>
        </defs>
        
        <g transform="translate(0, 0)">
          {/* Peer Machine */}
          <g transform="translate(20, 30)">
            <rect x="0" y="0" width="240" height="240" rx="8" ry="8" className="machine-box"/>
            <text x="120" y="30" className="text-icon" textAnchor="middle">💻</text>
            <text x="120" y="55" className="text-heading" textAnchor="middle">Peer Machine</text>
            
            <g transform="translate(40, 80)" className="private-key">
              <rect x="0" y="0" width="160" height="80" rx="4" ry="4" className="key-box"/>
              <text x="15" y="25" className="text-icon-small">🔑</text>
              <text x="40" y="25" className="text-code text-danger">Private Key</text>
              <text x="80" y="45" className="text-body" textAnchor="middle">ECDSA P-384</text>
              <text x="80" y="65" className="text-body" textAnchor="middle">Stored locally</text>
            </g>
            
            <text x="120" y="190" className="text-body" textAnchor="middle">Never leaves</text>
            <text x="120" y="210" className="text-body" textAnchor="middle">the machine</text>
          </g>
          
          {/* Share arrow */}
          <g transform="translate(260, 155)">
            <path d="M 10 0 L 70 0" className="share-arrow"/>
            <text x="40" y="-12" className="text-small" textAnchor="middle">Shares</text>
          </g>
          
          {/* GoatDB Network */}
          <g transform="translate(340, 30)">
            <rect x="0" y="0" width="360" height="280" rx="8" ry="8" className="network-box"/>
            <text x="180" y="30" className="text-icon" textAnchor="middle">🌐</text>
            <text x="180" y="55" className="text-heading" textAnchor="middle">GoatDB Network</text>
            
            {/* Public Key */}
            <g transform="translate(20, 80)" className="public-key">
              <rect x="0" y="0" width="150" height="60" rx="4" ry="4" className="key-box"/>
              <text x="15" y="25" className="text-icon-small">🔑</text>
              <text x="40" y="25" className="text-code text-success">Public Key</text>
              <text x="75" y="45" className="text-small" textAnchor="middle">Stored by network</text>
            </g>
            
            {/* Session */}
            <g transform="translate(190, 80)" className="session-box">
              <rect x="0" y="0" width="150" height="60" rx="4" ry="4" className="key-box"/>
              <text x="15" y="25" className="text-icon-small">🛡️</text>
              <text x="40" y="25" className="text-heading text-primary">Session</text>
              <text x="75" y="45" className="text-small" textAnchor="middle">30 day expiration</text>
            </g>
            
            {/* Session Types */}
            <g transform="translate(20, 165)">
              <rect x="0" y="0" width="320" height="95" rx="4" ry="4" className="session-info-box"/>
              <text x="20" y="25" className="text-icon-small">👤</text>
              <text x="45" y="25" className="text-body">
                <tspan fontWeight="500">Identified Session:</tspan>
              </text>
              <text x="55" y="43" className="text-small">Tied to User ID & Peer Machine</text>
              
              <text x="20" y="68" className="text-icon-small" opacity="0.6">❓</text>
              <text x="45" y="68" className="text-body">
                <tspan fontWeight="500">Anonymous Session:</tspan>
              </text>
              <text x="55" y="86" className="text-small">Tied only to Peer Machine</text>
            </g>
          </g>
          
          {/* Caption */}
          <g transform="translate(30, 330)">
            <rect x="0" y="0" width="660" height="60" rx="4" ry="4" className="caption-box"/>
            <text x="20" y="25" className="text-icon-small">🔐</text>
            <text x="45" y="25" className="text-body">
              <tspan fontWeight="600" fill="var(--ifm-color-primary-darker)">Key Generation:</tspan>
              <tspan dx="5">ECDSA P-384 keypair • Private key never leaves device</tspan>
            </text>
            <text x="45" y="45" className="text-body">Auto-rotation via expiration • Manual revocation available</text>
          </g>
        </g>
      </svg>
    </Diagram>
  );
}