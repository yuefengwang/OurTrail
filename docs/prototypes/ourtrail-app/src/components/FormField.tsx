import { Children, cloneElement, isValidElement, useId, type AriaAttributes, type ReactNode } from 'react';

export interface FormFieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  id?: string;
}

type ControlProps = AriaAttributes & { id?: string };

export function FormField({ label, error, hint, children, id }: FormFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const controls = Children.map(children, (child) => {
    if (!isValidElement<ControlProps>(child) || !['input', 'select', 'textarea'].includes(String(child.type))) return child;
    const descriptions = [child.props['aria-describedby'], hint && hintId, error && errorId].filter(Boolean).join(' ').split(/\s+/).filter(Boolean);
    return cloneElement(child, {
      id: fieldId,
      'aria-invalid': Boolean(error),
      'aria-describedby': [...new Set(descriptions)].join(' ') || undefined,
    });
  });

  return (
    <div className={`field${error ? ' field--invalid' : ''}`}>
      <label htmlFor={fieldId}>{label}</label>
      {controls}
      {hint && <p className="field-hint small muted" id={hintId}>{hint}</p>}
      {error && <p className="field-error" id={errorId}>{error}</p>}
    </div>
  );
}
