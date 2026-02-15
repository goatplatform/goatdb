import React from 'react';

export default function VersionHistoryIcon(
  { className }: { className?: string },
) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      <circle cx='24' cy='8' r='3' fill='currentColor' />
      <circle cx='16' cy='20' r='3' fill='currentColor' />
      <circle cx='32' cy='20' r='3' fill='currentColor' />
      <circle cx='12' cy='32' r='3' fill='currentColor' />
      <circle cx='20' cy='32' r='3' fill='currentColor' />
      <circle cx='28' cy='32' r='3' fill='currentColor' />
      <circle cx='36' cy='32' r='3' fill='currentColor' />
      <path
        d='M24 11 L16 17 M24 11 L32 17'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M16 23 L12 29 M16 23 L20 29'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      <path
        d='M32 23 L28 29 M32 23 L36 29'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
    </svg>
  );
}
