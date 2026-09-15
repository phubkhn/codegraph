import { createBrowserRouter } from "react-router-dom";
import { LoanNewPage } from "./pages/LoanNewPage";

export const router = createBrowserRouter([
  {
    path: "/loans/create",
    element: <LoanNewPage />,
  },
]);
