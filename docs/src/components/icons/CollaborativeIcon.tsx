import React from 'react';

export default function CollaborativeIcon(
  { className }: { className?: string },
) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <rect
        x='8'
        y='12'
        width='32'
        height='24'
        rx='2'
        stroke='currentColor'
        strokeWidth='2'
        fill='none'
      />
      <path
        d='M14 20 L26 20'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M14 24 L34 24'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M14 28 L30 28'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M28 18 L28 22'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        style={{ animation: 'blink 1s infinite' }}
      />
      <path
        d='M32 26 L32 30'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        style={{ animation: 'blink 1s infinite', animationDelay: '0.5s' }}
      />
    </svg>
  );
}
