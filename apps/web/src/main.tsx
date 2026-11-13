import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import AuthGate from "./auth/AuthGate";
import AuthProvider from "./auth/AuthProvider";
import { routes } from "./router";
import { theme } from "./theme";

const router = createBrowserRouter(routes);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A CRM is read-heavy and its data changes slowly. Refetching every list
      // on every window focus is a lot of traffic for almost no freshness.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications position="top-right" />
        {/* Inside QueryClientProvider because signing out clears the query
            cache; outside the router so the login screen answers every URL. */}
        <AuthProvider>
          <AuthGate>
            <RouterProvider router={router} />
          </AuthGate>
        </AuthProvider>
      </MantineProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
