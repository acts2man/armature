/**
 * Per-device values. A responsive wrapper is `{ desktop, tablet?, mobile? }` and is
 * recognised by its `desktop` key (no other value object in the model uses that key).
 * Tablet inherits desktop and mobile inherits tablet, the way Elementor does it.
 */
import type { Device, MaybeResponsive, Responsive } from "./types.ts";

export const DEVICES: readonly Device[] = ["desktop", "tablet", "mobile"];

export function isResponsive<T>(value: MaybeResponsive<T> | undefined): value is Responsive<T> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && "desktop" in (value as object);
}

/** The value in force on a device, following the inheritance chain. */
export function resolve<T>(value: MaybeResponsive<T> | undefined, device: Device): T | undefined {
  if (value === undefined) return undefined;
  if (!isResponsive<T>(value)) return value;
  if (device === "mobile" && value.mobile !== undefined) return value.mobile;
  if ((device === "mobile" || device === "tablet") && value.tablet !== undefined) return value.tablet;
  return value.desktop;
}

/** The value set at exactly this device, with no inheritance (undefined when it inherits). */
export function own<T>(value: MaybeResponsive<T> | undefined, device: Device): T | undefined {
  if (value === undefined) return undefined;
  if (!isResponsive<T>(value)) return device === "desktop" ? value : undefined;
  return value[device];
}

export const hasOverride = <T>(value: MaybeResponsive<T> | undefined, device: Device): boolean =>
  device !== "desktop" && isResponsive<T>(value) && value[device] !== undefined;

/**
 * Set the value for one device and return the new (immutable) value. Setting the desktop
 * value on a plain value keeps it plain; clearing every override collapses the wrapper.
 * `next === undefined` clears that device.
 */
export function setAt<T>(value: MaybeResponsive<T> | undefined, device: Device, next: T | undefined): MaybeResponsive<T> | undefined {
  const current: Responsive<T> | undefined = value === undefined ? undefined : isResponsive<T>(value) ? { ...value } : { desktop: value };
  if (device === "desktop") {
    if (next === undefined) {
      if (!current || (current.tablet === undefined && current.mobile === undefined)) return undefined;
      // Keep the overrides; the desktop value falls back to the tablet one.
      return { ...current, desktop: (current.tablet ?? current.mobile) as T };
    }
    if (!current || (current.tablet === undefined && current.mobile === undefined)) return next;
    return { ...current, desktop: next };
  }
  if (next === undefined) {
    if (!current) return undefined;
    const out: Responsive<T> = { ...current };
    delete out[device];
    return out.tablet === undefined && out.mobile === undefined ? out.desktop : out;
  }
  const base: Responsive<T> = current ?? { desktop: next };
  return { ...base, [device]: next };
}

/** Every device with its resolved value, for generating one rule per breakpoint. */
export function perDevice<T>(value: MaybeResponsive<T> | undefined): { device: Device; value: T }[] {
  const out: { device: Device; value: T }[] = [];
  for (const device of DEVICES) {
    const v = own(value, device);
    if (v !== undefined) out.push({ device, value: v });
  }
  return out;
}
