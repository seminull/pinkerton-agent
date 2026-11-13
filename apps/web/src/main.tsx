import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/notifications/styles.css";
import "yet-another-react-lightbox/styles.css";
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
        {/* reducedMotion="user": someone who has asked their device to reduce
            motion gets the fades without the movement, on every animation in
            the app, with no per-component opt-in to forget. */}
        <MotionConfig reducedMotion="user">
          {/* Motion's full `motion.div` bundles every feature it has — drag,
              layout animation, scroll — about 170 kB the app never uses.
              LazyMotion + the slim `m.div` ships only `domAnimation` (fades,
              transforms, variants, stagger), which is everything here. `strict`
              makes an accidental `motion.div` import throw in development
              instead of silently pulling the whole library back in. */}
          <LazyMotion features={domAnimation} strict>
            <AuthProvider>
              <AuthGate>
                <RouterProvider router={router} />
              </AuthGate>
            </AuthProvider>
          </LazyMotion>
        </MotionConfig>
      </MantineProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
