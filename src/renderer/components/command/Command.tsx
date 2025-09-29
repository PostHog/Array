import React from 'react';
import { Command as CmdkCommand } from 'cmdk';
import { MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { Flex } from '@radix-ui/themes';

interface CommandRootProps extends React.ComponentProps<typeof CmdkCommand> {
  className?: string;
}

const CommandRoot = React.forwardRef<
  React.ElementRef<typeof CmdkCommand>,
  CommandRootProps
>(({ className, ...props }, ref) => {
  return (
    <CmdkCommand
      ref={ref}
      className={`bg-gray-1 border border-gray-6 rounded-2 shadow-6 overflow-hidden ${className || ''}`}
      {...props}
    />
  );
});

CommandRoot.displayName = 'CommandRoot';

interface CommandInputProps extends React.ComponentProps<typeof CmdkCommand.Input> {
  className?: string;
  showIcon?: boolean;
  autoFocus?: boolean;
}

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CmdkCommand.Input>,
  CommandInputProps
>(({ className, showIcon = true, autoFocus = false, ...props }, ref) => {
  if (showIcon) {
    return (
      <Flex align="center" className="border-b border-gray-6" px="3">
        <MagnifyingGlassIcon className="w-4 h-4 text-gray-9 mr-2" />
        <CmdkCommand.Input
          ref={ref}
          autoFocus={autoFocus}
          className={`w-full bg-transparent text-sm py-3 outline-none focus:outline-none placeholder:text-gray-9 ${className || ''}`}
          {...props}
        />
      </Flex>
    );
  }

  return (
    <CmdkCommand.Input
      ref={ref}
      autoFocus={autoFocus}
      className={`w-full bg-transparent text-sm py-3 px-3 border-b border-gray-6 outline-none focus:outline-none placeholder:text-gray-9 ${className || ''}`}
      {...props}
    />
  );
});

CommandInput.displayName = 'CommandInput';

interface CommandListProps extends React.ComponentProps<typeof CmdkCommand.List> {
  className?: string;
}

function CommandList({ className, ...props }: CommandListProps) {
  return (
    <CmdkCommand.List
      className={`max-h-[300px] overflow-y-auto p-2 ${className || ''}`}
      {...props}
    />
  );
}

interface CommandItemProps extends React.ComponentProps<typeof CmdkCommand.Item> {
  className?: string;
}

function CommandItem({ className, ...props }: CommandItemProps) {
  return (
    <CmdkCommand.Item
      className={`flex items-center px-3 py-2 rounded-1 cursor-pointer text-gray-12 hover:bg-gray-3 aria-selected:bg-accent-3 ${className || ''}`}
      {...props}
    />
  );
}

interface CommandGroupProps extends React.ComponentProps<typeof CmdkCommand.Group> {
  className?: string;
  heading?: string;
}

function CommandGroup({ className, heading, children, ...props }: CommandGroupProps) {
  return (
    <CmdkCommand.Group className={className} {...props}>
      {heading && (
        <Flex px="3" py="2" className="text-xs font-medium text-gray-9 uppercase tracking-wide">
          {heading}
        </Flex>
      )}
      {children}
    </CmdkCommand.Group>
  );
}

interface CommandEmptyProps extends React.ComponentProps<typeof CmdkCommand.Empty> {
  className?: string;
}

function CommandEmpty({ className, ...props }: CommandEmptyProps) {
  return (
    <CmdkCommand.Empty
      className={`px-3 py-6 text-center text-sm text-gray-9 ${className || ''}`}
      {...props}
    />
  );
}

export const Command = {
  Root: CommandRoot,
  Input: CommandInput,
  List: CommandList,
  Item: CommandItem,
  Group: CommandGroup,
  Empty: CommandEmpty,
};