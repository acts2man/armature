/**
 * The Form widget. Fields come from the layout; entries go to the dashboard's
 * form-submit function (configured with createArmatureKit({ forms })), which checks them
 * against the form as published, so nothing here is trusted. A hidden honeypot field and
 * the time the form was open help keep bots out. In the editor the form never sends.
 */
import { useId, useState, type FormEvent } from "react";
import { safeHref } from "../sanitize.ts";
import type { FormField, FormProps } from "../types.ts";
import { parseKitRef } from "../values.ts";
import { getKitRuntime } from "../renderer.tsx";
import { registerWidget, type WidgetContext } from "../widgets.tsx";

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; message: string } | { kind: "error"; message: string; fields: Record<string, string> };

function Field({ field, error, showLabel, idBase }: { field: FormField; error?: string; showLabel: boolean; idBase: string }) {
  const id = `${idBase}-${field.id}`;
  const describedBy = [field.help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  const common = { id, name: field.name, required: field.required, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy, className: "ae-form-input" };
  const label = (
    <label htmlFor={id} className={showLabel ? "ae-form-label" : "ae-sr-only"}>
      {field.label}
      {field.required ? <span className="ae-form-required" aria-hidden="true"> *</span> : null}
    </label>
  );
  const options = (field.options ?? []).map((option) => option.trim()).filter(Boolean);
  let control;
  switch (field.type) {
    case "textarea":
      control = <textarea {...common} rows={5} placeholder={field.placeholder} maxLength={5000} />;
      break;
    case "select":
      control = (
        <select {...common} defaultValue="">
          <option value="" disabled={field.required}>
            {field.placeholder || "Choose…"}
          </option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
      break;
    case "radio":
      return (
        <fieldset className={`ae-form-field ae-form-w${field.width ?? 100}`} aria-describedby={describedBy}>
          <legend className={showLabel ? "ae-form-label" : "ae-sr-only"}>
            {field.label}
            {field.required ? <span className="ae-form-required" aria-hidden="true"> *</span> : null}
          </legend>
          {options.map((option, index) => (
            <label key={option} className="ae-form-choice">
              <input type="radio" name={field.name} value={option} required={field.required && index === 0} /> {option}
            </label>
          ))}
          {field.help ? <p id={`${id}-help`} className="ae-form-help">{field.help}</p> : null}
          {error ? <p id={`${id}-error`} className="ae-form-error">{error}</p> : null}
        </fieldset>
      );
    case "checkbox":
    case "consent":
      return (
        <div className={`ae-form-field ae-form-w${field.width ?? 100}`}>
          <label className="ae-form-choice" htmlFor={id}>
            <input type="checkbox" id={id} name={field.name} required={field.required} aria-invalid={error ? true : undefined} aria-describedby={describedBy} /> {field.label}
            {field.required ? <span className="ae-form-required" aria-hidden="true"> *</span> : null}
          </label>
          {field.help ? <p id={`${id}-help`} className="ae-form-help">{field.help}</p> : null}
          {error ? <p id={`${id}-error`} className="ae-form-error">{error}</p> : null}
        </div>
      );
    default:
      control = <input {...common} type={field.type} placeholder={field.placeholder} maxLength={500} autoComplete={field.type === "email" ? "email" : field.type === "tel" ? "tel" : field.name.includes("name") ? "name" : undefined} />;
  }
  return (
    <div className={`ae-form-field ae-form-w${field.width ?? 100}`}>
      {label}
      {control}
      {field.help ? <p id={`${id}-help`} className="ae-form-help">{field.help}</p> : null}
      {error ? <p id={`${id}-error`} className="ae-form-error">{error}</p> : null}
    </div>
  );
}

function FormView({ props, common, elementId, page, editMode }: { props: FormProps; common: WidgetContext["common"]; elementId: string; page: string; editMode: boolean }) {
  const idBase = useId();
  const [startedAt] = useState(() => Date.now());
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const fields = Array.isArray(props.fields) ? props.fields : [];
  const forms = getKitRuntime().forms;
  const preset = parseKitRef(props.buttonPreset ?? "kit:button.primary")?.name ?? "primary";

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editMode || !forms || status.kind === "sending") return;
    const data = new FormData(event.currentTarget);
    const values: Record<string, string | boolean> = {};
    for (const field of fields) values[field.name] = field.type === "checkbox" || field.type === "consent" ? data.get(field.name) === "on" : String(data.get(field.name) ?? "");
    setStatus({ kind: "sending" });
    try {
      const response = await fetch(forms.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: forms.siteId, page, element_id: elementId, values, trap: String(data.get("ae_website") ?? ""), started_at: startedAt }),
      });
      const result = (await response.json()) as { ok?: boolean; message?: string; redirect?: string; fieldErrors?: Record<string, string> };
      if (result.ok) {
        const redirect = safeHref(result.redirect);
        if (redirect && typeof window !== "undefined") window.location.assign(redirect);
        setStatus({ kind: "sent", message: result.message || props.success || "Thanks, we got it." });
        return;
      }
      setStatus({ kind: "error", message: result.message || "The form could not be sent. Please try again.", fields: result.fieldErrors ?? {} });
    } catch {
      setStatus({ kind: "error", message: "The form could not be sent. Check your connection and try again.", fields: {} });
    }
  };

  if (status.kind === "sent") {
    return (
      <div {...common} className={`${common.className} ae-form ae-form-sent`} role="status">
        <p>{status.message}</p>
      </div>
    );
  }
  const fieldErrors = status.kind === "error" ? status.fields : {};
  return (
    <form {...common} className={`${common.className} ae-form`} onSubmit={onSubmit} noValidate={false} aria-label={props.name || "Form"}>
      {/* People never see this field; bots fill it in. */}
      <div className="ae-form-trap" aria-hidden="true">
        <label>
          Leave this empty
          <input type="text" name="ae_website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="ae-form-fields">
        {fields.map((field) => (
          <Field key={field.id} field={field} error={fieldErrors[field.name]} showLabel={props.labels !== false} idBase={idBase} />
        ))}
      </div>
      {status.kind === "error" ? (
        <p className="ae-form-message ae-form-message-error" role="alert">
          {status.message}
        </p>
      ) : null}
      {editMode ? <p className="ae-form-message">Forms send from the live site.</p> : !forms ? <p className="ae-form-message">This form is not connected yet.</p> : null}
      <button type="submit" className={`ae-btn ae-btn-${preset} ae-btn-md ae-form-submit`} disabled={status.kind === "sending"} aria-busy={status.kind === "sending" || undefined}>
        <span className="ae-btn-text">{status.kind === "sending" ? "Sending…" : props.submitText || "Send"}</span>
      </button>
    </form>
  );
}

const Form = ({ element, common, editMode, page }: WidgetContext) => <FormView props={element.props as FormProps} common={common} elementId={element.id} page={page} editMode={editMode} />;

registerWidget("form", Form);
