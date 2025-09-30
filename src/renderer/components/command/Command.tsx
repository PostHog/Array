import { MagnifyingGlassIcon } from "@radix-ui/react-icons";
import { Flex } from "@radix-ui/themes";
import { Command as CmdkCommand } from "cmdk";
import React from "react";

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
      className={`overflow-hidden rounded-2 border border-gray-6 bg-gray-1 shadow-6 ${className || ""}`}
      {...props}
    />
  );
});

CommandRoot.displayName = "CommandRoot";

interface CommandInputProps
  extends React.ComponentProps<typeof CmdkCommand.Input> {
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
      <Flex align="center" className="border-gray-6 border-b" px="3">
        <MagnifyingGlassIcon className="mr-2 h-4 w-4 text-gray-9" />
        <CmdkCommand.Input
          ref={ref}
          autoFocus={autoFocus}
          className={`w-full bg-transparent py-3 text-sm outline-none placeholder:text-gray-9 focus:outline-none ${className || ""}`}
          {...props}
        />
      </Flex>
    );
  }

  return (
    <CmdkCommand.Input
      ref={ref}
      autoFocus={autoFocus}
      className={`w-full border-gray-6 border-b bg-transparent px-3 py-3 text-sm outline-none placeholder:text-gray-9 focus:outline-none ${className || ""}`}
      {...props}
    />
  );
});

CommandInput.displayName = "CommandInput";

interface CommandListProps
  extends React.ComponentProps<typeof CmdkCommand.List> {
  className?: string;
}

function CommandList({ className, ...props }: CommandListProps) {
  return (
    <CmdkCommand.List
      className={`max-h-[300px] overflow-y-auto p-2 ${className || ""}`}
      {...props}
    />
  );
}

interface CommandItemProps
  extends React.ComponentProps<typeof CmdkCommand.Item> {
  className?: string;
}

function CommandItem({ className, ...props }: CommandItemProps) {
  return (
    <CmdkCommand.Item
      className={`flex cursor-pointer items-center rounded-1 px-3 py-2 text-gray-12 hover:bg-gray-3 aria-selected:bg-accent-3 ${className || ""}`}
      {...props}
    />
  );
}

interface CommandGroupProps
  extends React.ComponentProps<typeof CmdkCommand.Group> {
  className?: string;
  heading?: string;
}

function CommandGroup({
  className,
  heading,
  children,
  ...props
}: CommandGroupProps) {
  return (
    <CmdkCommand.Group className={className} {...props}>
      {heading && (
        <Flex
          px="3"
          py="2"
          className="font-medium text-gray-9 text-xs uppercase tracking-wide"
        >
          {heading}
        </Flex>
      )}
      {children}
    </CmdkCommand.Group>
  );
}

interface CommandEmptyProps
  extends React.ComponentProps<typeof CmdkCommand.Empty> {
  className?: string;
}

function CommandEmpty({ className, ...props }: CommandEmptyProps) {
  return (
    <CmdkCommand.Empty
      className={`px-3 py-6 text-center text-gray-9 text-sm ${className || ""}`}
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
