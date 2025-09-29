import React from 'react';
import { Flex, Text, Code } from '@radix-ui/themes';
import { KeyHint } from './KeyHint';

export function CommandKeyHints() {
  return (
    <Flex align="center" justify="center" gap="4" px="3" py="2" className="border-t border-gray-6 bg-gray-1">
      <Flex align="center" gap="2">
        <KeyHint keys={['↑', '↓']} />
        <Code size="1" variant="ghost" color="gray">Navigate</Code>
      </Flex>
      <Flex align="center" gap="2">
        <KeyHint keys={['↵']} />
        <Code size="1" variant="ghost" color="gray">Select</Code>
      </Flex>
      <Flex align="center" gap="2">
        <KeyHint keys={['Esc']} />
        <Code size="1" variant="ghost" color="gray">Close</Code>
      </Flex>
    </Flex>
  );
}