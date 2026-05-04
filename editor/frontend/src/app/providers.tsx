import type { ReactNode } from "react";
import { Toaster } from "sonner";

interface ProvidersProps {
  readonly children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <>
      {children}
      <Toaster richColors position="bottom-right" />
    </>
  );
}
