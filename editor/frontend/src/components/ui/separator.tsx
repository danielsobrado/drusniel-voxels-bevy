import * as React from "react";
import { cn } from "@/lib/cn";

export function Separator({ className, ...props }: React.HTMLAttributes<HTMLHRElement>) {
  return (
    <hr
      className={cn("h-px w-full border-0 bg-editor-border", className)}
      {...props}
    />
  );
}
