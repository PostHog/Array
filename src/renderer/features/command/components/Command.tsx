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
      className={`flex h-full w-full flex-col overflow-hidden ${className || ""}`}
      {...props}
    />
  );
});

CommandRoot.displayName = "CommandRoot";

interface CommandInputProps
  extends React.ComponentProps<typeof CmdkCommand.Input> {
  className?: string;
}

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CmdkCommand.Input>,
  CommandInputProps
>(({ className, ...props }, ref) => {
  return <CmdkCommand.Input ref={ref} className={className} {...props} />;
});

CommandInput.displayName = "CommandInput";

interface CommandListProps
  extends React.ComponentProps<typeof CmdkCommand.List> {
  className?: string;
}

const CommandList = React.forwardRef<
  React.ElementRef<typeof CmdkCommand.List>,
  CommandListProps
>(({ className, ...props }, ref) => {
  return (
    <CmdkCommand.List
      ref={ref}
      className={`overflow-y-auto ${className || ""}`}
      {...props}
    />
  );
});

CommandList.displayName = "CommandList";

interface CommandItemProps
  extends React.ComponentProps<typeof CmdkCommand.Item> {
  className?: string;
}

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CmdkCommand.Item>,
  CommandItemProps
>(({ className, ...props }, ref) => {
  return (
    <CmdkCommand.Item
      ref={ref}
      className={`relative flex cursor-pointer select-none items-center px-3 py-2 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected=true]:bg-accent-3 data-[disabled=true]:opacity-50 ${className || ""}`}
      {...props}
    />
  );
});

CommandItem.displayName = "CommandItem";

interface CommandGroupProps
  extends React.ComponentProps<typeof CmdkCommand.Group> {
  className?: string;
  heading?: string;
}

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CmdkCommand.Group>,
  CommandGroupProps
>(({ className, heading, children, ...props }, ref) => {
  return (
    <CmdkCommand.Group
      ref={ref}
      className={`p-1 ${className || ""}`}
      {...props}
    >
      {heading && (
        <div className="px-2 py-1.5 text-gray-11" style={{ fontSize: "14px" }}>
          {heading}
        </div>
      )}
      {children}
    </CmdkCommand.Group>
  );
});

CommandGroup.displayName = "CommandGroup";

interface CommandEmptyProps
  extends React.ComponentProps<typeof CmdkCommand.Empty> {
  className?: string;
}

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CmdkCommand.Empty>,
  CommandEmptyProps
>(({ className, ...props }, ref) => {
  return (
    <CmdkCommand.Empty
      ref={ref}
      className={`py-6 text-center text-sm ${className || ""}`}
      {...props}
    />
  );
});

CommandEmpty.displayName = "CommandEmpty";

export const Command = {
  Root: CommandRoot,
  Input: CommandInput,
  List: CommandList,
  Item: CommandItem,
  Group: CommandGroup,
  Empty: CommandEmpty,
};
