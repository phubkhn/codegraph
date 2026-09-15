export function LoanForm({ loan, onSubmit }: { loan: unknown; onSubmit: () => void }) {
  return <div onClick={onSubmit}>{JSON.stringify(loan)}</div>;
}
