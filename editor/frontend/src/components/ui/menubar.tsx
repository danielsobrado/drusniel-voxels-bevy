import * as React from "react";
import * as MenubarPrimitive from "@radix-ui/react-menubar";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export function Menubar({
  children,
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Root>) {
  return <MenubarPrimitive.Root className={cn("flex h-full", className)} {...props}>{children}</MenubarPrimitive.Root>;
}

export function MenubarMenu({
  children,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Menu>) {
  return <MenubarPrimitive.Menu {...props}>{children}</MenubarPrimitive.Menu>;
}

export function MenubarTrigger({
  children,
  className,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Trigger>) {
  return (
    <MenubarPrimitive.Trigger
      className={cn(
        "h-full px-2 text-xs font-medium text-editor-fg-2 hover:bg-editor-panel2 hover:text-editor-fg focus:outline-none flex items-center gap-1 rounded-sm",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronDown size={11} />
    </MenubarPrimitive.Trigger>
  );
}

export function MenubarContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Content>) {
  return (
    <MenubarPrimitive.Content
      className={cn(
        "bg-editor-panel2 border border-editor-border rounded-md p-1 min-w-40",
        className,
      )}
      {...props}
    >
      {children}
    </MenubarPrimitive.Content>
  );
}

export function MenubarItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof MenubarPrimitive.Item>) {
  return (
    <MenubarPrimitive.Item
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none hover:bg-editor-bg-canvas focus:bg-editor-bg-canvas data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </MenubarPrimitive.Item>
  );
}
