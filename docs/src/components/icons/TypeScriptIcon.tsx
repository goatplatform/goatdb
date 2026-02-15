import React from 'react';

export default function TypeScriptIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <rect
        x='8'
        y='8'
        width='32'
        height='32'
        rx='4'
        stroke='currentColor'
        strokeWidth='2'
        fill='none'
      />
      <path
        d='M16 20 L24 20 M20 20 L20 32'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      <path
        d='M28 26 L32 26 C33 26 34 27 34 28 C34 29 33 30 32 30 L28 30 C27 30 26 31 26 32 C26 33 27 34 28 34 L34 34'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  );
}
