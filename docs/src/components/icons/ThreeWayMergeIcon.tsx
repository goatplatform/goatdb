import React from 'react';

export default function ThreeWayMergeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="36" cy="12" r="4" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="24" cy="36" r="4" stroke="currentColor" strokeWidth="2" fill="none" />
      <path
        d="M15 15 L21 30"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M33 15 L27 30"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M24 8 L24 32"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
    </svg>
  );
}