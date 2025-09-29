import React from 'react';
import { Flex, Code } from '@radix-ui/themes';
import artText from '@shared/art.txt?raw';

interface AsciiArtProps {
  scale?: number;
  opacity?: number;
}

export function AsciiArt({ scale = 0.6, opacity = 0.2 }: AsciiArtProps) {
  return (
    <Flex align="center" justify="center" height="100%" width="100%" style={{ overflow: 'hidden' }}>
      <Code
        size="1"
        variant="ghost"
        style={{
          whiteSpace: 'pre',
          fontFamily: 'monospace',
          lineHeight: '1',
          color: 'var(--accent-9)',
          opacity,
          fontSize: '0.6rem',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          transform: `scale(${scale})`,
          transformOrigin: 'center center'
        }}
      >
        {artText}
      </Code>
    </Flex>
  );
}