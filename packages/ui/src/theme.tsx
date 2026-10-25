"use client";
import { createContext, useContext, type HTMLAttributes } from "react";

const SourceContext = createContext<string | undefined>(undefined);
export function useSourceTheme() {
  return useContext(SourceContext);
}
export function SourceThemeProvider({
  sourceId,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { sourceId?: string }) {
  return (
    <SourceContext.Provider value={sourceId}>
      <div {...props} data-ft-source={sourceId}>
        {children}
      </div>
    </SourceContext.Provider>
  );
}
