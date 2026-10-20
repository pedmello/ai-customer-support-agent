import { useState } from "react";
export function PasswordField({
  id,
  label,
  value,
  onChange,
  disabled,
  current = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  current?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          minLength={current ? 1 : 12}
          maxLength={128}
          autoComplete={current ? "current-password" : "new-password"}
          disabled={disabled}
          aria-describedby={current ? undefined : "password-policy"}
        />
        <button
          type="button"
          onClick={() => setVisible(!visible)}
          disabled={disabled}
          aria-label={`${visible ? "Ocultar" : "Mostrar"} ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          {visible ? "Ocultar" : "Mostrar"}
        </button>
      </div>
    </>
  );
}
