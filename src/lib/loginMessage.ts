/**
 * The ready-to-send message an agency copies to a client after "Create client
 * login". Worded for the client: it names the agency's portal, never Armature.
 */
export function loginDetailsMessage(input: {
  portalName: string;
  signInUrl: string;
  email: string;
  temporaryPassword: string;
}): string {
  return (
    `Here is your login for ${input.portalName}: ${input.signInUrl}, email: ${input.email}, temporary password: ${input.temporaryPassword}. ` +
    "You'll be asked to choose your own password the first time you sign in."
  );
}
