import { getLoan } from "../api/loanApi";

export function useLoan(id: string) {
  const data = getLoan(id);
  return data;
}
