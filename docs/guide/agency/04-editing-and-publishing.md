# Editing and publishing

Everything anyone changes goes into a **draft** first. Drafts are saved in the
browser and in Supabase every two seconds; the same person opening the site on
another device gets their draft back. Only a **Publish** commits the draft to
GitHub.

## Draft vs publish

- Every edit — text, style, drag-and-drop, new pages, media alt text, site kit
  values — sits in the draft until someone clicks Publish.
- One draft per site per person.
- Leaving the page with unsaved work asks for confirmation.

## What a publish does

- **One commit** to the site's repository, on the branch the site is connected
  to. The commit message lists which pages changed.
- Anything that could take a page down (a broken value, a link the validator
  refuses) is either fixed automatically or blocks the publish with a clear
  message.
- **sitemap.xml and robots.txt** are rewritten in the same commit whenever the
  set of pages or the site URL changes.
- The publish appears in Publish history with the commit link and a summary.

## Then Netlify rebuilds

Netlify sees the new commit and starts a build. Two things follow from this:

- The live site is normally up to date about **two minutes** after a publish.
- **Netlify counts each publish against its build credits** on credit-based
  plans. Bunch small edits into one publish where you can.

## Conflicts

If someone else published something on the same page while your draft was open,
Armature merges what it can element by element. When both sides changed the same
value, the publish dialog names the element and asks whether to keep your
version or theirs — everything else in your draft is kept either way.
