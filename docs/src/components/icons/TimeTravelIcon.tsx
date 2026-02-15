import React from 'react';

export default function TimeTravelIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <circle
        cx='24'
        cy='24'
        r='16'
        stroke='currentColor'
        strokeWidth='2'
        fill='none'
      />
      <path
        d='M24 14 L24 24 L32 32'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
      {
        /* <path
        d="M8 8 L4 12 L8 16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      /> */
      }
      {
        /* <path
        d="M4 12 L12 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      /> */
      }
    </svg>
  );
}
