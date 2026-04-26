import React from 'react';

export default function MultiDeviceIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      {/* Laptop (top, dominant) */}
      <rect
        x='13'
        y='4'
        width='22'
        height='15'
        rx='1.5'
        stroke='currentColor'
        strokeWidth='2'
      />
      <path
        d='M10 19 L38 19 L40 23 L8 23 Z'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinejoin='round'
      />

      {/* Dashed connector: laptop → server */}
      <line
        x1='16'
        y1='24'
        x2='10'
        y2='33'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeDasharray='3 2'
        strokeLinecap='round'
      />

      {/* Dashed connector: laptop → phone */}
      <line
        x1='32'
        y1='24'
        x2='39'
        y2='30'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeDasharray='3 2'
        strokeLinecap='round'
      />

      {/* Server rack (bottom-left) */}
      <rect
        x='3'
        y='33'
        width='14'
        height='12'
        rx='1.5'
        stroke='currentColor'
        strokeWidth='2'
      />
      <line
        x1='5'
        y1='37'
        x2='15'
        y2='37'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
      />
      <line
        x1='5'
        y1='40'
        x2='15'
        y2='40'
        stroke='currentColor'
        strokeWidth='1.5'
        strokeLinecap='round'
      />
      <circle cx='14' cy='35' r='1' fill='currentColor' />

      {/* Phone (bottom-right) — portrait to distinguish from server */}
      <rect
        x='34'
        y='30'
        width='10'
        height='15'
        rx='2'
        stroke='currentColor'
        strokeWidth='2'
      />
      <circle cx='39' cy='43' r='1' stroke='currentColor' strokeWidth='1.5' />
    </svg>
  );
}
