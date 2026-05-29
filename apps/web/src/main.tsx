import "reflect-metadata";
import "@posthog/ui/styles/globals.css";
import { boot } from "@posthog/di/contribution";
import { ServiceProvider } from "@posthog/di/react";
import App from "@posthog/ui/shell/App";
import React from "react";
import ReactDOM from "react-dom/client";
import { Providers } from "./Providers";
import { container } from "./web-container";

void boot(container);

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ServiceProvider container={container}>
      <Providers>
        <App />
      </Providers>
    </ServiceProvider>
  </React.StrictMode>,
);
