import React from 'react';

export default function DeployIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <rect
        x='16'
        y='32'
        width='16'
        height='8'
        rx='2'
        stroke='currentColor'
        strokeWidth='2'
        fill='none'
      />
      <path
        d='M24 8 L24 28'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M16 16 L24 8 L32 16'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
        fill='none'
      />
    </svg>
  );
}
