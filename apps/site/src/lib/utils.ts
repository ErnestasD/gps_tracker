import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A euro amount in the reader's own convention — "€1.80" in EN, "1,80 €" in
 * PL/DE/LT. The locale files write prices the same way (`{{price}} €` outside EN),
 * so a hardcoded "€1.80" in a card next to "1,80 €" in the prose was the one place
 * the pricing page still read as a translation.
 */
export function eur(amount: number, lang: string | undefined, digits = 0): string {
  return new Intl.NumberFormat(lang ?? "en", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
}
