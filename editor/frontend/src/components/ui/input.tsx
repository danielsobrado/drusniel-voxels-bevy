import * as React from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "flex h-8 w-full rounded-md border border-editor-border bg-editor-panel2 px-2.5 text-sm text-editor-fg placeholder:text-editor-fg-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-cyan/70",
        className,
      )}
      {...props}
    />
  );
}
