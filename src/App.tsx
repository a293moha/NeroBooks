import { HashRouter, Route, Routes } from "react-router-dom";
import { Auth0Provider } from "@auth0/auth0-react";
import Layout from "./components/Layout";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { CurrencyProvider } from "./context/CurrencyContext";
import { DataProvider } from "./context/DataContext";
import { TeamProvider } from "./context/TeamContext";
import SignIn from "./pages/SignIn";
import Dashboard from "./pages/Dashboard";
import Invoices from "./pages/Invoices";
import Customers from "./pages/Customers";
import Expenses from "./pages/Expenses";
import Vendors from "./pages/Vendors";
import Accounts from "./pages/Accounts";
import Transactions from "./pages/Transactions";
import Reports from "./pages/Reports";
import Team from "./pages/Team";
import Billing from "./pages/Billing";
import Admin from "./pages/Admin";

function AuthGate() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <div className="app-loading">Loading…</div>;
  if (!user) return <SignIn />;

  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="customers" element={<Customers />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="vendors" element={<Vendors />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="reports" element={<Reports />} />
        <Route path="team" element={<Team />} />
        <Route path="billing" element={<Billing />} />
        {user.isPlatformAdmin && <Route path="admin" element={<Admin />} />}
      </Route>
    </Routes>
  );
}

function App() {
  // Computed at runtime, not hardcoded: this app is served from more than
  // one origin/base path at once (a custom domain at "/", GitHub Pages at
  // "/NeroBooks/"), and Auth0 needs to redirect back to whichever one the
  // user actually started from. import.meta.env.BASE_URL already carries
  // the right path for either target (see vite.config.ts).
  const redirectUri = `${window.location.origin}${import.meta.env.BASE_URL}`;

  return (
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: redirectUri,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      }}
    >
      <AuthProvider>
        <CurrencyProvider>
          <DataProvider>
            <TeamProvider>
              <HashRouter>
                <AuthGate />
              </HashRouter>
            </TeamProvider>
          </DataProvider>
        </CurrencyProvider>
      </AuthProvider>
    </Auth0Provider>
  );
}

export default App;
