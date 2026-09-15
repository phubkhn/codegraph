export function getLoan(id: string) {
  return fetch(`/api/loans/${id}`);
}

export function createLoan(payload: unknown) {
  return fetch("/api/loans", { method: "POST", body: JSON.stringify(payload) });
}

const API_BASE_URL = "https://api.example.com";

export function deleteLoan(id: string) {
  return fetch(`${API_BASE_URL}/api/loans/${id}`, { method: "DELETE" });
}
