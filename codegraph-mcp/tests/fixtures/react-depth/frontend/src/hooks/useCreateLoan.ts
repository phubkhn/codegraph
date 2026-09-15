import { createLoan } from "../api/loanApi";

export function useCreateLoan() {
  return (payload: unknown) => createLoan(payload);
}
