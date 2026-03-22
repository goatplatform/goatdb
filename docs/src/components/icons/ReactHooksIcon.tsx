import React from 'react';

// Pixel-art React hooks icon: atom orbits + hook symbol
// viewBox 0 0 48 48, center (24,24)

export default function ReactHooksIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      {/* Atom nucleus */}
      <circle cx='24' cy='24' r='3' fill='currentColor' />
      {/* Orbit 1 — horizontal ellipse */}
      <ellipse
        cx='24'
        cy='24'
        rx='14'
        ry='5'
        stroke='currentColor'
        strokeWidth='1.5'
      />
      {/* Orbit 2 — rotated 60° */}
      <ellipse
        cx='24'
        cy='24'
        rx='14'
        ry='5'
        stroke='currentColor'
        strokeWidth='1.5'
        transform='rotate(60 24 24)'
      />
      {/* Orbit 3 — rotated 120° */}
      <ellipse
        cx='24'
        cy='24'
        rx='14'
        ry='5'
        stroke='currentColor'
        strokeWidth='1.5'
        transform='rotate(120 24 24)'
      />
    </svg>
  );
}
