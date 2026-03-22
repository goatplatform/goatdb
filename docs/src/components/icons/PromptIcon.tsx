import React from 'react';

export default function PromptIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      {/* Chevron > */}
      <path
        d='M13 17 L23 24 L13 31'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      {/* Blinking cursor _ */}
      <path
        d='M27 31 L36 31'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        style={{ animation: 'blink 1s infinite' }}
      />
    </svg>
  );
}
