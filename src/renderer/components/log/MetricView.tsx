import React from 'react';
import { Box, Text, Code } from '@radix-ui/themes';

interface MetricViewProps {
  keyName: string;
  value: number;
  unit?: string;
}

export function MetricView({ keyName, value, unit }: MetricViewProps) {
  return (
    <Box p="3" className="bg-gray-2 border border-gray-6 rounded-2">
      <Code size="2" color="gray" variant="ghost">{keyName}:</Code>
      <Code size="2" weight="medium" variant="ghost" className="ml-2">{value}</Code>
      {unit ? <Code size="2" color="gray" variant="ghost" className="ml-1">{unit}</Code> : null}
    </Box>
  );
}


