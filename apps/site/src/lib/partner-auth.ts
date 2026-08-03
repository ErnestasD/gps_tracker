import { useSyncExternalStore } from "react";

/** In-memory only — no cookie, no localStorage. Token is lost on reload by design. */
let token: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setPartnerToken(t: string | null) {
  token = t;
  emit();
}

export function getPartnerToken() {
  return token;
}

export function usePartnerToken(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => token,
    () => null,
  );
}
