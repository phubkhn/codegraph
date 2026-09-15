import { useLoan } from "../hooks/useLoan";
import { LoanForm } from "../components/LoanForm";

export function LoanPage({ id }: { id: string }) {
  const loan = useLoan(id);
  return <LoanForm loan={loan} />;
}
