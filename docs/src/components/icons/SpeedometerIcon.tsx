import React from 'react';

// Geometry: center (24, 30), radius 14
//   270° arc clockwise from 135° to 45° — both endpoints at y=39.9, symmetric.
//   Gap is the 90° centered at the bottom (90° = 6 o'clock in SVG).
//
//   Endpoint formula: (cx + r·cosθ, cy + r·sinθ)  [SVG: 0°=right, 90°=down]
//     Min  (135°): outer (14.1, 39.9) → 24 + 14·cos135 = 14.1, 30 + 14·sin135 = 39.9
//     Mid  (270°): outer (24,   16  ) → 24 + 14·cos270 = 24,   30 + 14·sin270 = 16
//     Max   (45°): outer (33.9, 39.9) → 24 + 14·cos45  = 33.9, 30 + 14·sin45  = 39.9
//
//   Inner tick radius = 10:
//     Min inner:  (24 + 10·cos135, 30 + 10·sin135) = (16.9, 37.1)
//     Mid inner:  (24,             30 + 10·sin270) = (24,   20  )
//     Max inner:  (24 + 10·cos45,  30 + 10·sin45)  = (31.1, 37.1)
//
//   Needle at max (45°), r=11: (24 + 11·cos45, 30 + 11·sin45) = (31.8, 37.8)

export default function SpeedometerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox='0 0 48 48'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
    >
      {/* Gauge arc — 270° clockwise from lower-left (135°) to lower-right (45°) */}
      <path
        d='M14.1 39.9 A14 14 0 1 1 33.9 39.9'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      {/* Tick at min (135°) */}
      <line
        x1='14.1'
        y1='39.9'
        x2='16.9'
        y2='37.1'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      {/* Tick at mid (270° = top) */}
      <line
        x1='24'
        y1='16'
        x2='24'
        y2='20'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      {/* Tick at max (45°) */}
      <line
        x1='33.9'
        y1='39.9'
        x2='31.1'
        y2='37.1'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      {/* Needle pegged at max (45°) */}
      <line
        x1='24'
        y1='30'
        x2='31.8'
        y2='37.8'
        stroke='currentColor'
        strokeWidth='2'
        strokeLinecap='round'
      />
      {/* Pivot dot */}
      <circle cx='24' cy='30' r='2.5' fill='currentColor' />
    </svg>
  );
}
