"use client";

import React from "react";
import ActionGuardProvider from "../../components/ActionGuardProvider";
import ThemeProvider from "../../components/ThemeProvider";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ActionGuardProvider>{children}</ActionGuardProvider>
    </ThemeProvider>
  );
}
