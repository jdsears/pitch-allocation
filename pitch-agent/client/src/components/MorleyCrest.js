import React from 'react';
import crest from '../assets/morley-crest.png';

/**
 * Morley Youth FC crest — the official club badge. Rendered from the supplied
 * PNG so it matches the real club identity exactly. `size` keeps the same API
 * as before so existing call sites don't change.
 */
export default function MorleyCrest({ size = 40, title = 'Morley Youth FC' }) {
  return (
    <img
      src={crest}
      width={size}
      height={size}
      alt={title}
      title={title}
      style={{ display: 'block', flexShrink: 0, objectFit: 'contain' }}
    />
  );
}
