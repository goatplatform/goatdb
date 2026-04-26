import React from 'react';

export default function OfflineIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      {/* Outer circle */}
      <circle cx='24' cy='24' r='16' stroke='currentColor' strokeWidth='2' />
      {/* Equator */}
      <line
        x1='8'
        y1='24'
        x2='40'
        y2='24'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      {/* Left meridian arc */}
      <path
        d='M24 8 C16 12 16 36 24 40'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        fill='none'
      />
      {/* Right meridian arc */}
      <path
        d='M24 8 C32 12 32 36 24 40'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        fill='none'
      />
    </svg>
  );
}
