import React from 'react';
import { Box, Text } from '@radix-ui/themes';

interface MetricViewProps {
  keyName: string;
  value: number;
  unit?: string;
}

export function MetricView({ keyName, value, unit }: MetricViewProps) {
  return (
    <Box p="3" className="bg-gray-2 border border-gray-6 rounded-2">
      <Text color="gray" mr="2">{keyName}:</Text>
      <Text weight="medium">{value}</Text>
      {unit ? <Text color="gray" ml="1">{unit}</Text> : null}
    </Box>
  );
}


