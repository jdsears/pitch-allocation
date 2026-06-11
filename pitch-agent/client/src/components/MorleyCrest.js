import React from 'react';

/**
 * Morley Youth FC crest, recreated as an inline SVG so it stays crisp at any
 * size and needs no image asset. Yellow roundel, navy ring, football, and
 * curved "MORLEY YOUTH · F.C." lettering — matching the club badge.
 */
export default function MorleyCrest({ size = 40, title = 'Morley Youth FC' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title}
      style={{ display: 'block', flexShrink: 0 }}
    >
      <title>{title}</title>
      <defs>
        {/* Arc the top text sits on (reads left-to-right over the top) */}
        <path id="crest-arc-top" d="M 20 54 A 31 31 0 0 1 80 54" fill="none" />
        {/* Clip so the football panels never spill past the ball edge */}
        <clipPath id="crest-ball">
          <circle cx="50" cy="50" r="20" />
        </clipPath>
      </defs>

      {/* Navy outer ring + yellow disc */}
      <circle cx="50" cy="50" r="49" fill="#1B3A78" />
      <circle cx="50" cy="50" r="46" fill="#F6C544" />
      <circle cx="50" cy="50" r="45.5" fill="none" stroke="#1B3A78" strokeWidth="1" opacity="0.5" />

      {/* Football */}
      <g clipPath="url(#crest-ball)">
        <circle cx="50" cy="50" r="20" fill="#ffffff" />
        {/* central pentagon */}
        <polygon points="50,43 56.66,47.84 54.11,55.66 45.89,55.66 43.34,47.84" fill="#111111" />
        {/* seams out to the edge */}
        <g stroke="#111111" strokeWidth="1.6" fill="none">
          <line x1="50" y1="43" x2="50" y2="29" />
          <line x1="56.66" y1="47.84" x2="69.97" y2="43.51" />
          <line x1="54.11" y1="55.66" x2="62.34" y2="66.99" />
          <line x1="45.89" y1="55.66" x2="37.66" y2="66.99" />
          <line x1="43.34" y1="47.84" x2="30.03" y2="43.51" />
        </g>
        {/* edge panel hints */}
        <g fill="#111111">
          <path d="M50 29 L44 31 L43 35 L50 34 L57 35 L56 31 Z" />
          <path d="M70 43.5 L67 49 L63 49 L65 43 Z" />
          <path d="M62.3 67 L57 65 L58 60 L63 62 Z" />
          <path d="M37.7 67 L43 65 L42 60 L37 62 Z" />
          <path d="M30 43.5 L33 49 L37 49 L35 43 Z" />
        </g>
        <circle cx="50" cy="50" r="20" fill="none" stroke="#111111" strokeWidth="1.4" />
      </g>

      {/* Curved club name */}
      <text
        fill="#1B3A78"
        fontSize="11"
        fontWeight="800"
        letterSpacing="1.2"
        fontFamily="'Inter', sans-serif"
      >
        <textPath href="#crest-arc-top" startOffset="50%" textAnchor="middle">
          MORLEY YOUTH
        </textPath>
      </text>
      <text
        x="50"
        y="89"
        fill="#1B3A78"
        fontSize="10"
        fontWeight="800"
        letterSpacing="2"
        textAnchor="middle"
        fontFamily="'Inter', sans-serif"
      >
        F.C.
      </text>
    </svg>
  );
}
