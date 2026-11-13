import type { RouteObject } from "react-router";
import RootLayout from "./routes/RootLayout";
import ErrorPage from "./routes/ErrorPage";
import NotFound from "./routes/NotFound";
import Dashboard from "./routes/Dashboard";
import Contacts from "./contacts/Contacts";
import ContactDetail from "./contacts/ContactDetail";
import Listings from "./listings/Listings";
import Users from "./admin/Users";

// The route table, kept out of main.tsx's DOM bootstrap so it can be exercised
// in tests (an unknown URL must resolve to NotFound) without mounting the app.
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <RootLayout />,
    // Any render or loader error in a child bubbles up to here rather than
    // blanking the page.
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "contacts", element: <Contacts /> },
      { path: "contacts/:contactId", element: <ContactDetail /> },
      { path: "listings", element: <Listings /> },
      // Reachable by URL for anyone signed in; the page itself turns away a
      // non-admin, and the API refuses them regardless.
      { path: "admin/users", element: <Users /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];
