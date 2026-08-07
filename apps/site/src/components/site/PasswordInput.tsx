import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * A password field with a reveal toggle, in the site's own input shape.
 *
 * Not decoration: the commonest reason a correct password is rejected is a typo nobody can see, and
 * on a phone keyboard that is most of the time. The button carries an aria-label that flips with the
 * state, so a screen reader announces which way it goes rather than just "button", and it stays in
 * the tab order — after the field, before submit, which is where someone checking a typo reaches.
 */
export function PasswordInput({
  className = "",
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <span className="relative block">
      <input
        {...rest}
        type={shown ? "text" : "password"}
        className={`h-11 w-full rounded pl-3 pr-11 bg-[rgba(10,20,40,0.6)] border border-[var(--hairline)] text-ink text-sm outline-none focus:border-[color:var(--brand-blue)] ${className}`}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={t(shown ? "cta.hidePassword" : "cta.showPassword")}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground cursor-pointer"
      >
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </span>
  );
}
