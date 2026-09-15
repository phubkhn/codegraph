export function getLoan(id: string) {
  return fetch(`/api/loans/${id}`);
}
