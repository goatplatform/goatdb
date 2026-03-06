import React from 'react';

export default function AgentIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      {/* Central node */}
      <circle cx='24' cy='24' r='6' stroke='currentColor' strokeWidth='2' />
      <circle cx='24' cy='24' r='2' fill='currentColor' />

      {/* Satellite nodes */}
      <circle cx='10' cy='12' r='4' stroke='currentColor' strokeWidth='2' />
      <circle cx='38' cy='12' r='4' stroke='currentColor' strokeWidth='2' />
      <circle cx='24' cy='40' r='4' stroke='currentColor' strokeWidth='2' />

      {/* Connection lines */}
      <line
        x1='14'
        y1='15'
        x2='19'
        y2='20'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeDasharray='3 2'
      />
      <line
        x1='34'
        y1='15'
        x2='29'
        y2='20'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeDasharray='3 2'
      />
      <line
        x1='24'
        y1='30'
        x2='24'
        y2='36'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeDasharray='3 2'
      />
    </svg>
  );
}
