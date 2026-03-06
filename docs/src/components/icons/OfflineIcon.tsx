import React from 'react';

export default function OfflineIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <circle cx='24' cy='36' r='3' fill='currentColor' />
      <path
        d='M17 32 A8 8 0 0 1 31 32'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M12 29 A14 14 0 0 1 36 29'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M7 26 A20 20 0 0 1 41 26'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <line
        x1='10'
        y1='10'
        x2='38'
        y2='38'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
    </svg>
  );
}
