import React from 'react';

export default function OfflineFirstIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect
        x="12"
        y="8"
        width="24"
        height="32"
        rx="4"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M20 36 L28 36"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M18 12 L30 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M20 24 L28 24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
      <path
        d="M20 28 L28 28"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
    </svg>
  );
}