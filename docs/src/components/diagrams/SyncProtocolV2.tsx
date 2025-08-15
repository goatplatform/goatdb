import React from 'react';
import Diagram from '../Diagram';

export default function SyncProtocolV2() {
  return (
    <Diagram>
      <svg width="1440" height="680" viewBox="0 0 1440 680" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <style>{`
            .sync-centralized-container { 
              fill: none; 
              stroke: var(--ifm-color-emphasis-300); 
              stroke-width: 4;
            }
            [data-theme='dark'] .sync-centralized-container { 
              fill: none; 
              stroke: var(--ifm-color-emphasis-400); 
            }
            
            .sync-distributed-container { 
              fill: none; 
              stroke: var(--ifm-color-primary-lighter); 
              stroke-width: 4;
            }
            [data-theme='dark'] .sync-distributed-container { 
              fill: none; 
              stroke: var(--ifm-color-primary-dark); 
            }
            
            .sync-vs-arrow { 
              stroke: var(--ifm-color-warning-dark); 
              stroke-width: 4; 
              fill: none;
              marker-end: url(#vs-marker);
            }
            [data-theme='dark'] .sync-vs-arrow { 
              stroke: var(--ifm-color-warning); 
            }
            
            .sync-server-node {
              fill: var(--ifm-color-emphasis-200);
              stroke: var(--ifm-color-emphasis-500);
              stroke-width: 4;
            }
            [data-theme='dark'] .sync-server-node {
              fill: var(--ifm-color-emphasis-100);
              stroke: var(--ifm-color-emphasis-400);
            }
            
            .sync-client-node {
              fill: var(--ifm-color-primary-lightest);
              stroke: var(--ifm-color-primary);
              stroke-width: 4;
            }
            [data-theme='dark'] .sync-client-node {
              fill: var(--ifm-color-primary-darkest);
              stroke: var(--ifm-color-primary-light);
            }
            
            .sync-text-explanation { 
              font-size: 26px; 
              font-weight: 600; 
              fill: var(--ifm-font-color-base); 
            }
            
            .sync-text-sub { 
              font-size: 30px; 
              fill: var(--ifm-color-emphasis-700); 
            }
            [data-theme='dark'] .sync-text-sub { 
              fill: var(--ifm-color-emphasis-600); 
            }
            
            .sync-coordination-line {
              stroke: var(--ifm-color-emphasis-400);
              stroke-width: 4;
              fill: none;
              stroke-dasharray: 12 8;
            }
            [data-theme='dark'] .sync-coordination-line {
              stroke: var(--ifm-color-emphasis-500);
            }
            
            .sync-direct-line {
              stroke: var(--ifm-color-primary);
              stroke-width: 4;
              fill: none;
            }
            [data-theme='dark'] .sync-direct-line {
              stroke: var(--ifm-color-primary-light);
            }
          `}</style>
          
          <marker id="vs-marker" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto">
            <polygon points="0 0, 10 4, 0 8" fill="var(--ifm-color-warning-dark)" />
          </marker>
          
          <style>{`
            [data-theme='dark'] #vs-marker polygon { fill: var(--ifm-color-warning); }
          `}</style>
        </defs>
        
        {/* Traditional Centralized - Left Side */}
        <g transform="translate(80, 80)">
          <rect x="0" y="0" width="580" height="500" rx="8" className="sync-centralized-container"/>
          <text x="280" y="50" className="sync-text-explanation" textAnchor="middle">Traditional Sync</text>
          
          {/* Single large central server */}
          <g transform="translate(180, 190)">
            <rect x="0" y="14" width="200" height="140" rx="16" className="sync-server-node"/>
            <text x="100" y="92" className="sync-text-sub" textAnchor="middle">Server</text>
          </g>
          
          {/* Multiple clients all connecting only to central server */}
          <g transform="translate(80, 150)">
            <circle cx="0" cy="0" r="20" className="sync-client-node"/>
            <line x1="23" y1="10" x2="105" y2="60" className="sync-coordination-line"/>
          </g>
          
          <g transform="translate(480, 150)">
            <circle cx="0" cy="0" r="20" className="sync-client-node"/>
            <line x1="-20" y1="15" x2="-100" y2="60" className="sync-coordination-line"/>
          </g>
          
          <g transform="translate(80, 420)">
            <circle cx="0" cy="0" r="20" className="sync-client-node"/>
            <line x1="20" y1="-14" x2="100" y2="-80" className="sync-coordination-line"/>
          </g>
          
          <g transform="translate(480, 420)">
            <circle cx="0" cy="0" r="20" className="sync-client-node"/>
            <line x1="-20" y1="-14" x2="-100" y2="-80" className="sync-coordination-line"/>
          </g>
          
          <g transform="translate(280, 110)">
            <circle cx="0" cy="0" r="20" className="sync-client-node"/>
            <line x1="0" y1="22" x2="0" y2="90" className="sync-coordination-line"/>
          </g>
          
          <g transform="translate(280, 460)">
            <circle cx="0" cy="0" r="20" className="sync-client-node"/>
            <line x1="0" y1="-24" x2="0" y2="-112" className="sync-coordination-line"/>
          </g>
          
          <text x="290" y="550" className="sync-text-sub" textAnchor="middle">All clients connect only to server</text>
        </g>
        
        {/* Arrow pointing right with "vs" */}
        <g transform="translate(680, 320)">
          <line x1="0" y1="0" x2="100" y2="0" className="sync-vs-arrow"/>
          <text x="54" y="-20" className="sync-text-explanation" textAnchor="middle">vs</text>
        </g>
        
        {/* GoatDB Peer-to-Peer - Right Side */}
        <g transform="translate(820, 80)">
          <rect x="0" y="0" width="580" height="500" rx="8" className="sync-distributed-container"/>
          <text x="280" y="50" className="sync-text-explanation" textAnchor="middle">GoatDB Sync</text>
          
          {/* Multiple small distributed servers */}
          <g transform="translate(130, 170)">
            <rect x="0" y="0" width="100" height="80" rx="8" className="sync-server-node"/>
            <text x="50" y="48" className="sync-text-sub" textAnchor="middle" fontSize="32">S</text>
          </g>
          
          <g transform="translate(330, 170)">
            <rect x="0" y="0" width="100" height="80" rx="8" className="sync-server-node"/>
            <text x="50" y="48" className="sync-text-sub" textAnchor="middle" fontSize="32">S</text>
          </g>
          
          <g transform="translate(230, 360)">
            <rect x="0" y="0" width="100" height="80" rx="8" className="sync-server-node"/>
            <text x="50" y="48" className="sync-text-sub" textAnchor="middle" fontSize="32">S</text>
          </g>
          
          {/* Client devices - positioned precisely on grid */}
          <g transform="translate(60, 210)">
            <circle cx="0" cy="0" r="20" className="sync-client-node"/>
            <line x1="22" y1="0" x2="70" y2="0" className="sync-coordination-line"/>
          </g>
          
          <g transform="translate(500, 135)">
            <circle cx="0" cy="0" r="20" className="sync-client-node"/>
            <line x1="-22" y1="10" x2="-72" y2="38" className="sync-coordination-line"/>
          </g>
          
          <g transform="translate(60, 400)">
            <circle cx="0" cy="0" r="20" className="sync-client-node"/>
            <line x1="22" y1="0" x2="168" y2="0" className="sync-coordination-line"/>
          </g>
          
          <g transform="translate(500, 400)">
            <circle cx="0" cy="0" r="20" className="sync-client-node"/>
            <line x1="-22" y1="0" x2="-168" y2="0" className="sync-coordination-line"/>
          </g>
          
          <g transform="translate(180, 110)">
            <circle cx="0" cy="0" r="20" className="sync-client-node"/>
            <line x1="0" y1="22" x2="0" y2="60" className="sync-coordination-line"/>
          </g>
          
          {/* Server-to-server connections (p2p backbone) - precise positioning */}
          <line x1="232" y1="210" x2="328" y2="210" className="sync-direct-line"/>
          <line x1="180" y1="252" x2="280" y2="358" className="sync-direct-line"/>
          <line x1="380" y1="252" x2="280" y2="358" className="sync-direct-line"/>
          
          {/* Some direct client-to-client connections - precise positioning */}
          <line x1="73" y1="190" x2="156" y2="115" className="sync-direct-line" strokeDasharray="8 8"/>
          <line x1="500" y1="160" x2="500" y2="380" className="sync-direct-line" strokeDasharray="8 8"/>
          
          <text x="290" y="550" className="sync-text-sub" textAnchor="middle">P2P network with distributed servers</text>
        </g>
        
        {/* Bottom explanation */}
        <g transform="translate(80, 600)">
          <text x="720" y="75" className="sync-text-sub" textAnchor="middle">
            <tspan fontWeight="600" fill="var(--ifm-color-primary-darker)">No centralized coordination:</tspan>
            <tspan dx="5">Every device syncs directly with any other device</tspan>
          </text>
        </g>
      </svg>
    </Diagram>
  );
}