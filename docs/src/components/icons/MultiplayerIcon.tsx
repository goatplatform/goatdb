import React from 'react';

export default function MultiplayerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <rect
        x='8'
        y='16'
        width='32'
        height='16'
        rx='8'
        stroke='currentColor'
        strokeWidth='2'
        fill='none'
      />
      <circle
        cx='16'
        cy='24'
        r='4'
        stroke='currentColor'
        strokeWidth='2'
        fill='none'
      />
      <circle
        cx='32'
        cy='24'
        r='4'
        stroke='currentColor'
        strokeWidth='2'
        fill='none'
      />
      <path
        d='M20 20 L20 28'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M24 20 L24 28'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M28 20 L28 28'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
    </svg>
  );
}
