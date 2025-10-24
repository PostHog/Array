import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import React from "react";
import "./collapsible.css";

export const Collapsible = CollapsiblePrimitive.Root;

export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;

export const CollapsibleContent = React.forwardRef<
  React.ElementRef<typeof CollapsiblePrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof CollapsiblePrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <CollapsiblePrimitive.Content
    ref={ref}
    className={`collapsible-content ${className || ""}`}
    {...props}
  >
    {children}
  </CollapsiblePrimitive.Content>
));

CollapsibleContent.displayName = "CollapsibleContent";
