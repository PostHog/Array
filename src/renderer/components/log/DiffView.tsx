import React from 'react';
import { Box, Flex, Text } from '@radix-ui/themes';

interface DiffViewProps {
  file: string;
  patch?: string;
  added?: number;
  removed?: number;
}

function getFileParts(path: string): { dir: string; base: string } {
  if (!path) return { dir: '', base: '' };
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (idx === -1) return { dir: '', base: path };
  return { dir: path.slice(0, idx + 1), base: path.slice(idx + 1) };
}

export function DiffView({ file, patch, added, removed }: DiffViewProps) {
  const { dir, base } = getFileParts(file);
  const lines = (patch || '').split(/\r?\n/);

  return (
    <Box className="border border-gray-6 rounded-3 overflow-hidden">
      <Flex align="center" justify="between" p="3" className="bg-gray-2">
        <Box>
          <Text color="gray">{dir}</Text>
          <Text weight="medium">{base}</Text>
        </Box>
        <Box>
          {typeof added === 'number' && typeof removed === 'number' ? (
            <Text size="1" color="gray">+{added} / -{removed}</Text>
          ) : null}
        </Box>
      </Flex>
      <Box p="3" className="bg-gray-1 font-mono text-sm whitespace-pre overflow-x-auto">
        {lines.map((line, i) => {
          let color: string | undefined = undefined;
          if (line.startsWith('+++') || line.startsWith('---')) color = 'gray';
          else if (line.startsWith('@@')) color = 'blue';
          else if (line.startsWith('+')) color = 'green';
          else if (line.startsWith('-')) color = 'red';
          else if (line.startsWith('diff ') || line.startsWith('index ')) color = 'gray';
          return (
            <Text key={i} color={color}>{line || '\u00A0'}</Text>
          );
        })}
      </Box>
    </Box>
  );
}


