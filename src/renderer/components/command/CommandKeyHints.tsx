import React from 'react';
import { Flex, Text } from '@radix-ui/themes';
import { KeyHint } from './KeyHint';

export function CommandKeyHints() {
  return (
    <Flex align="center" justify="center" gap="4" px="3" py="2" className="border-t border-gray-6 bg-gray-2">
      <Flex align="center" gap="1">
        <KeyHint keys={['↑', '↓']} />
        <Text size="1" color="gray">navigate</Text>
      </Flex>
      <Flex align="center" gap="1">
        <KeyHint keys={['↵']} />
        <Text size="1" color="gray">select</Text>
      </Flex>
      <Flex align="center" gap="1">
        <KeyHint keys={['esc']} />
        <Text size="1" color="gray">close</Text>
      </Flex>
    </Flex>
  );
}