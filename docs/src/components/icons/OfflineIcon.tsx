import React from 'react';

export default function OfflineIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        cx="24"
        cy="24"
        r="8"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M10 10 L38 38"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M14 24 C14 24 16 20 24 20 C32 20 34 24 34 24"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
      <path
        d="M18 30 C18 30 20 28 24 28 C28 28 30 30 30 30"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
    </svg>
  );
}