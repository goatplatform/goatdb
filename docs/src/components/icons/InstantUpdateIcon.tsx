import React from 'react';

export default function InstantUpdateIcon(
  { className }: { className?: string },
) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <path
        d='M24 8 L24 16 L16 24 L24 32 L24 40'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
        fill='none'
      />
      <path
        d='M8 24 L16 24'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M32 24 L40 24'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <circle
        cx='24'
        cy='24'
        r='2'
        fill='currentColor'
      />
    </svg>
  );
}
