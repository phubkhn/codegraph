export function getLoan(id: string) {
  return fetch(`/api/loans/${id}`);
}

export function createLoan(payload: unknown) {
  return fetch("/api/loans", { method: "POST", body: JSON.stringify(payload) });
}
