import React from 'react';

export default function SingleTenantIcon(
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
        y='8'
        width='12'
        height='12'
        rx='2'
        stroke='currentColor'
        strokeWidth='2'
        fill='none'
      />
      <rect
        x='28'
        y='8'
        width='12'
        height='12'
        rx='2'
        stroke='currentColor'
        strokeWidth='2'
        fill='none'
      />
      <rect
        x='8'
        y='28'
        width='12'
        height='12'
        rx='2'
        stroke='currentColor'
        strokeWidth='2'
        fill='none'
      />
      <rect
        x='28'
        y='28'
        width='12'
        height='12'
        rx='2'
        stroke='currentColor'
        strokeWidth='2'
        fill='none'
      />
      <circle
        cx='14'
        cy='14'
        r='2'
        fill='currentColor'
      />
    </svg>
  );
}
