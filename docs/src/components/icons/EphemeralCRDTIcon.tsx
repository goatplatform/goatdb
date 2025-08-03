import React from 'react';

export default function EphemeralCRDTIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M24 8 L16 20 L20 20 L16 32 L28 16 L24 16 L32 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle
        cx="24"
        cy="36"
        r="4"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeDasharray="1 2"
      />
    </svg>
  );
}