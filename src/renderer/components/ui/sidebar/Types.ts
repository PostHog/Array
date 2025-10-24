export interface TreeNode {
  label: string;
  children?: TreeNode[];
  icon?: React.ReactNode;
  forceSeparator?: boolean;
  action?: () => void;
  isActive?: boolean;
  hoverAction?: () => void;
  hoverIcon?: React.ReactNode;
  showHoverIconAlways?: boolean;
  tooltip?: string;
}

export interface TreeLine {
  prefix: string;
  connector: string;
  label: string;
  nodeId: string;
  hasChildren: boolean;
  icon?: React.ReactNode;
  action?: () => void;
  isActive?: boolean;
  hoverAction?: () => void;
  hoverIcon?: React.ReactNode;
  showHoverIconAlways?: boolean;
  tooltip?: string;
}
