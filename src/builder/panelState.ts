/** Per-user memory of whether the builder's left panel is collapsed. */
const STORAGE_KEY = "armature:builder:panel-collapsed";

export function readPanelCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writePanelCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // storage unavailable: the state simply resets next time
  }
}
