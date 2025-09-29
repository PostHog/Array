import React from 'react';

interface MetricViewProps {
  keyName: string;
  value: number;
  unit?: string;
}

export function MetricView({ keyName, value, unit }: MetricViewProps) {
  return (
    <div className="px-3 py-2 bg-dark-bg border border-dark-border rounded-md text-sm">
      <span className="text-dark-text-muted mr-2">{keyName}:</span>
      <span className="text-dark-text font-medium">{value}</span>
      {unit ? <span className="text-dark-text-muted ml-1">{unit}</span> : null}
    </div>
  );
}


