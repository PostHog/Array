import "@radix-ui/themes/styles.css";
import { ThemeWrapper } from "@components/ThemeWrapper";
import App from "@renderer/App";
import { queryClient } from "@renderer/lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeWrapper>
        <App />
      </ThemeWrapper>
    </QueryClientProvider>
  </React.StrictMode>,
);
