import { Route } from "react-router-dom";
import { LoanNewPage } from "./pages/LoanNewPage";

export function App() {
  return <Route path="/loans/new" element={<LoanNewPage />} />;
}
