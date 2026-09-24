/**
 * The kit's version. Kept in its own file so the renderer can read it without
 * pulling in every widget through index.ts (which would import back into the
 * renderer, so the wire runs the other way).
 *
 * ArmaturePage stamps this string on `<html data-armature-kit="...">` at render
 * time, so Armature can tell what kit version is actually live on a site (not
 * only what is in the repo).
 */
export const KIT_VERSION = "2.8.0";
