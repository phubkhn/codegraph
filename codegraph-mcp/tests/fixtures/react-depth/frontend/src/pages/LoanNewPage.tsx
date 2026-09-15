import { LoanForm } from "../components/LoanForm";
import { useCreateLoan } from "../hooks/useCreateLoan";

export function LoanNewPage() {
  const create = useCreateLoan();
  return <LoanForm loan={null} onSubmit={create} />;
}
