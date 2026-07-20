import { HashRouter, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { CurrencyProvider } from "./context/CurrencyContext";
import { DataProvider } from "./context/DataContext";
import SignIn from "./pages/SignIn";
import Dashboard from "./pages/Dashboard";
import Invoices from "./pages/Invoices";
import Customers from "./pages/Customers";
import Expenses from "./pages/Expenses";
import Vendors from "./pages/Vendors";
import Accounts from "./pages/Accounts";
import Transactions from "./pages/Transactions";
import Reports from "./pages/Reports";

function AuthGate() {
  const { user } = useAuth();

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
      </Route>
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <CurrencyProvider>
        <DataProvider>
          <HashRouter>
            <AuthGate />
          </HashRouter>
        </DataProvider>
      </CurrencyProvider>
    </AuthProvider>
  );
}

export default App;
