import React from 'react';

export default function ConflictResolutionIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M8 12 L24 12 L24 36 L8 36 Z"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M24 12 L40 12 L40 36 L24 36 Z"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M16 20 L16 28"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M32 20 L32 28"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M20 24 L28 24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}