import React from 'react';
import { Kbd } from '@radix-ui/themes';

interface KeyHintProps {
  keys: string[];
  className?: string;
}

export function KeyHint({ keys, className }: KeyHintProps) {
  return (
    <div className={`flex gap-1 ${className || ''}`}>
      {keys.map((key, index) => (
        <Kbd key={index} size="1" className="text-gray-9">
          {key}
        </Kbd>
      ))}
    </div>
  );
}