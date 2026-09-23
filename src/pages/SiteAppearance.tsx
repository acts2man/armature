/**
 * /sites/:siteId/appearance — the site's look, WordPress "Appearance" style:
 *   - Globals: the same colours, fonts, text styles and buttons editor as the editor's
 *     Globals panel, on a full page with a live preview strip; Save publishes the kit.
 *   - Header and Footer: coded today, or built in the editor (content/layouts/_header.json,
 *     _footer.json); build one, edit it in context around a real page, or go back to coded.
 *   - Menus: the navigation menus the Nav Menu widget shows (stored in the site kit).
 */
import { useMemo, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { SiteSettingsPanel } from "@/builder/SiteSettingsPanel.tsx";
import { createElement, setPath } from "@/builder/store.ts";
import { widgetDefinition } from "@/builder/widgets/registry.ts";
import "@/builder/widgets/library.ts";
import { IconArrowDown, IconArrowUp, IconLayout, IconPalette, IconPencil, IconPlus, IconTrash } from "@/components/icons.tsx";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, EmptyState, Field, Input, LinkButton, Modal, Notice, PageHeader, Panel, Pill, Select, Skeleton, SrOnly, TabBar, Toggle, tabClass } from "@/components/ui.tsx";
import { useKitPublish } from "@/hooks/useKitPublish.ts";
import { useSiteContent } from "@/hooks/useSiteContent.ts";
import { addItem, addMenu, flattenItems, indentItem, moveItem, outdentItem, removeItem, removeMenu, renameMenu, updateItem } from "@/lib/menus.ts";
import { isHostingOnly } from "@/lib/services.ts";
import { writeNewPageHandoff } from "@/visual/pages.ts";
import { kitCss } from "@kit/css.ts";
import { defaultSiteKit } from "@kit/defaults.ts";
import { chromeSlug, type ChromePart, type LayoutDoc, type Menu, type SiteKit } from "@kit/types.ts";
import { px } from "@kit/values.ts";
import type { ContentGetResponse } from "@shared/publishTypes.ts";
import { SHARED_SLUG } from "@shared/schema.ts";
import { deepEqual } from "@shared/contentFile.ts";

export function SiteAppearance() {
  const { site } = useSite();
  const root = `/sites/${site.id}/appearance`;
  if (isHostingOnly(site)) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Appearance" meta={<Pill tone="grey">Hosting only</Pill>} />
        <EmptyState title="Nothing to style yet" icon={<IconPalette size={18} />}>
          Connect the site's repository and its colours, fonts, header, footer and menus can be edited here.
        </EmptyState>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Appearance" description="How the whole site looks: its colours and fonts, its header and footer, and its menus." />
      <div className="border-b border-line">
        <TabBar label="Appearance">
          <NavLink to={root} end className={tabClass} data-testid="appearance-tab-globals">
            Globals
          </NavLink>
          <NavLink to={`${root}/header`} className={tabClass} data-testid="appearance-tab-header">
            Header
          </NavLink>
          <NavLink to={`${root}/footer`} className={tabClass} data-testid="appearance-tab-footer">
            Footer
          </NavLink>
          <NavLink to={`${root}/menus`} className={tabClass} data-testid="appearance-tab-menus">
            Menus
          </NavLink>
        </TabBar>
      </div>
      <Outlet />
    </div>
  );
}

/** The loaded content, or the loading and failure states, for every tab. */
function useLoaded(): { loaded: ContentGetResponse | null; body: ReactNode | null; refetch: () => void; fetching: boolean } {
  const { site } = useSite();
  const content = useSiteContent(site.id);
  const loaded = content.data && content.data.ok ? content.data : null;
  let body: ReactNode | null = null;
  if (content.isPending) {
    body = (
      <div className="space-y-4" role="status" aria-label="Loading the site's look">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  } else if (!loaded) {
    body = (
      <Notice
        kind="danger"
        title="The site's content could not be loaded"
        action={
          <Button variant="secondary" size="sm" loading={content.isFetching} onClick={() => void content.refetch()}>
            Retry
          </Button>
        }
      >
        {content.isError ? content.error.message : content.data && !content.data.ok ? content.data.message : "The site's content could not be read."}
      </Notice>
    );
  }
  return { loaded, body, refetch: () => void content.refetch(), fetching: content.isFetching };
}

// --- Globals -----------------------------------------------------------------------------------------

const type = (name: string): React.CSSProperties => ({
  fontFamily: `var(--ae-type-${name}-family)`,
  fontSize: `var(--ae-type-${name}-size)`,
  fontWeight: `var(--ae-type-${name}-weight)` as unknown as number,
  lineHeight: `var(--ae-type-${name}-lh)`,
  letterSpacing: `var(--ae-type-${name}-ls)`,
  textTransform: `var(--ae-type-${name}-tt)` as unknown as "none",
  margin: 0,
});

/** A sample of the site in the kit's own CSS: the heading and body styles, a link, the three buttons and the colours. */
function PreviewStrip({ kit }: { kit: SiteKit }) {
  const css = useMemo(() => kitCss(kit), [kit]);
  const button = "inline-flex items-center justify-center text-decoration-none";
  return (
    <div className="ae-root overflow-hidden rounded-card border border-line" style={{ background: "var(--ae-page-background)", color: "var(--ae-color-text)" }} data-testid="globals-preview">
      <style>{css}</style>
      <div className="flex flex-col gap-4 p-6">
        <h1 style={type("h1")}>A headline in your heading font</h1>
        <h2 style={type("h2")}>A second-level heading</h2>
        <p style={type("body")}>
          Body text looks like this. Every paragraph on the site follows it, and{" "}
          <a href="#preview" onClick={(event) => event.preventDefault()} style={{ color: "var(--ae-link-color)" }}>
            links look like this
          </a>
          .
        </p>
        <div className="flex flex-wrap gap-3">
          <span className={`ae-btn ae-btn-primary ${button}`} style={type("button")}>
            Primary button
          </span>
          <span className={`ae-btn ae-btn-secondary ${button}`} style={type("button")}>
            Secondary
          </span>
          <span className={`ae-btn ae-btn-outline ${button}`} style={type("button")}>
            Outline
          </span>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Colours">
          {(["primary", "secondary", "text", "accent"] as const).map((name) => (
            <span key={name} className="inline-flex items-center gap-1.5 rounded-pill border border-black/10 px-2 py-1 text-[12px]" style={{ background: "#fff", color: "#1b2733" }}>
              <span className="h-4 w-4 rounded-full border border-black/10" style={{ background: `var(--ae-color-${name})` }} aria-hidden="true" />
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function GlobalsEditor({ loaded }: { loaded: ContentGetResponse }) {
  const { site, isStaff } = useSite();
  const published = useMemo(() => loaded.siteKit ?? defaultSiteKit(), [loaded.siteKit]);
  const [kit, setKit] = useState<SiteKit>(published);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const publish = useKitPublish(site.id, loaded.commitSha);
  const changed = !deepEqual(kit, published);
  const canEdit = isStaff || loaded.editingLevel !== "content";
  return (
    <div className="flex flex-col gap-5">
      {!canEdit && <Notice kind="info">Your account can change words and pictures; ask your agency to change the site's colours and fonts.</Notice>}
      {publish.isError && (
        <Notice kind="danger" title="The changes could not be published">
          {publish.error.message}
        </Notice>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">Changes show in the preview at once and reach the site when you save.</p>
        <div className="flex gap-2">
          {changed && (
            <Button variant="secondary" onClick={() => setKit(published)} disabled={publish.isPending}>
              Discard changes
            </Button>
          )}
          <Button onClick={() => publish.mutate({ kind: "kit", kit, done: "Site look published." })} disabled={!changed || !canEdit} loading={publish.isPending} data-testid="globals-save">
            Save and publish
          </Button>
        </div>
      </div>
      <div className="grid items-start gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="max-h-[70vh] overflow-hidden rounded-card border border-line bg-panel" data-testid="globals-editor">
          <div className="flex h-full max-h-[70vh] flex-col">
            <SiteSettingsPanel kit={kit} write={(path, value) => setKit((current) => setPath(current, path, value))} device={device} onDevice={setDevice} isStaff={isStaff} />
          </div>
        </div>
        <div className="sticky top-6 flex flex-col gap-3">
          <div className="text-[13px] font-semibold text-text">Preview</div>
          <PreviewStrip kit={kit} />
        </div>
      </div>
    </div>
  );
}

export function AppearanceGlobals() {
  const { loaded, body } = useLoaded();
  if (!loaded) return body;
  return <GlobalsEditor key={loaded.commitSha} loaded={loaded} />;
}

// --- Header and footer --------------------------------------------------------------------------------

const label = (part: ChromePart) => (part === "header" ? "Header" : "Footer");

/** A starting point: a row with the logo and the menu, or a footer with a line of text. */
function starterPart(part: ChromePart): LayoutDoc {
  const slug = chromeSlug(part);
  if (part === "header") {
    const logo = widgetDefinition("site-logo")?.create() ?? createElement("site-logo", { src: "", alt: "", linkHome: true, height: px(48) });
    const menu = widgetDefinition("nav-menu")?.create() ?? createElement("nav-menu", { layout: "horizontal", breakpoint: 767 });
    const row = createElement("container", { tag: "div", layout: "boxed", direction: "row", justify: "space-between", align: "center", gap: { column: px(24), row: px(12) } }, { children: [logo, menu] });
    return { version: 1, pageSlug: slug, path: "/", label: "Header", root: [row] };
  }
  const text = widgetDefinition("text")?.create() ?? createElement("text", {});
  const column = createElement("container", { tag: "div", layout: "boxed", direction: "column", gap: { column: px(20), row: px(12) } }, { children: [text] });
  return { version: 1, pageSlug: slug, path: "/", label: "Footer", root: [column] };
}

function PartEditor({ part, loaded }: { part: ChromePart; loaded: ContentGetResponse }) {
  const { site, isStaff } = useSite();
  const navigate = useNavigate();
  const slug = chromeSlug(part);
  const built = loaded.layouts?.[slug];
  const canBuild = isStaff || loaded.editingLevel === "builder";
  const publish = useKitPublish(site.id, loaded.commitSha);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const firstPage = loaded.schema.pages.find((page) => page.slug !== SHARED_SLUG)?.slug ?? Object.keys(loaded.layouts ?? {}).find((key) => !key.startsWith("_")) ?? "home";
  const editHref = `/sites/${site.id}/visual?page=${encodeURIComponent(firstPage)}&part=${part}`;
  const codedFields = loaded.schema.pages.find((page) => page.slug === SHARED_SLUG)?.sections.find((section) => section.key === part);

  const build = () => {
    const layout = starterPart(part);
    if (!writeNewPageHandoff(site.id, layout)) return;
    navigate(`${editHref}&new=1`);
  };

  return (
    <div className="flex flex-col gap-5">
      {publish.isError && (
        <Notice kind="danger" title="That could not be done">
          {publish.error.message}
        </Notice>
      )}
      <Panel title={`${label(part)}: ${built ? "built in the editor" : "coded into the site"}`} aside={<Pill tone={built ? "blue" : "grey"}>{built ? "Builder" : "Coded"}</Pill>}>
        <div className="flex flex-col gap-4 p-5 text-[14px] leading-relaxed text-text" data-testid={`part-${part}`}>
          {built ? (
            <>
              <p>
                The {part} is a builder part: it shows on every page and edits like any page. Open it in the editor to change its logo, its menu, its colours and its spacing; publish and it goes live with everything else.
              </p>
              <div className="flex flex-wrap gap-2">
                <LinkButton to={editHref} data-testid={`edit-${part}`}>
                  <IconPencil size={16} /> Edit the {part} visually
                </LinkButton>
                {canBuild && (
                  <Button variant="secondary" onClick={() => setConfirmRemove(true)} disabled={publish.isPending} data-testid={`remove-${part}`}>
                    <IconTrash size={16} /> Back to the coded {part}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <p>
                {isStaff
                  ? `The ${part} is still part of the site's code. Build one in the editor and it replaces the coded ${part} on every page as soon as it is published; the coded one stays as the fallback until then.`
                  : `The ${part} is part of the site's code. ${codedFields ? "Its words and pictures edit by clicking them on any page in the editor." : ""} Your agency can make it fully editable.`}
              </p>
              {codedFields && (
                <p className="text-muted">
                  Its words and pictures ({codedFields.fields.map((field) => field.label).join(", ")}) edit today from any page in the editor, or under{" "}
                  <LinkButton to={`/sites/${site.id}/pages/${SHARED_SLUG}`} variant="secondary" size="sm" className="!inline-flex">
                    Edit text
                  </LinkButton>
                  .
                </p>
              )}
              {canBuild && (
                <div>
                  <Button onClick={build} data-testid={`build-${part}`}>
                    <IconLayout size={16} /> Build the {part} in the editor
                  </Button>
                  <p className="mt-2 text-[12px] text-muted">
                    Starts {part === "header" ? "with a Site Logo and a Nav Menu" : "with a line of text"}. Nothing goes live until you publish. The site must render its {part} through the kit's ArmatureChrome part (the agency's job; see the kit's README).
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </Panel>
      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={`Go back to the coded ${part}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={publish.isPending} data-testid={`remove-${part}-confirm`} onClick={() => publish.mutate({ kind: "remove-part", slug, done: `The coded ${part} is back.` }, { onSettled: () => setConfirmRemove(false) })}>
              Remove the built {part}
            </Button>
          </>
        }
      >
        <p className="text-[14px] leading-relaxed text-text">The {part} built in the editor is removed from the site as one commit, and the coded {part} shows again on every page. This cannot be undone from here.</p>
      </Modal>
    </div>
  );
}

export function AppearanceHeader() {
  const { loaded, body } = useLoaded();
  if (!loaded) return body;
  return <PartEditor key={loaded.commitSha} part="header" loaded={loaded} />;
}

export function AppearanceFooter() {
  const { loaded, body } = useLoaded();
  if (!loaded) return body;
  return <PartEditor key={loaded.commitSha} part="footer" loaded={loaded} />;
}

// --- Menus ---------------------------------------------------------------------------------------------

type PageOption = { slug: string; label: string };

function MenusEditor({ loaded }: { loaded: ContentGetResponse }) {
  const { site, isStaff } = useSite();
  const published = useMemo(() => loaded.siteKit ?? defaultSiteKit(), [loaded.siteKit]);
  const [menus, setMenus] = useState<Menu[]>(published.menus ?? []);
  const [current, setCurrent] = useState<string | null>(menus[0]?.id ?? null);
  const [naming, setNaming] = useState<null | { mode: "new" | "rename"; name: string }>(null);
  const [adding, setAdding] = useState<{ kind: "page" | "url"; page: string; label: string; href: string; parent: string | null } | null>(null);
  const publish = useKitPublish(site.id, loaded.commitSha);
  const canEdit = isStaff || loaded.editingLevel !== "content";
  const changed = !deepEqual(menus, published.menus ?? []);
  const menu = menus.find((entry) => entry.id === current) ?? menus[0] ?? null;
  const pages: PageOption[] = useMemo(
    () => [
      ...loaded.schema.pages.filter((page) => page.slug !== SHARED_SLUG).map((page) => ({ slug: page.slug, label: page.label })),
      ...Object.values(loaded.layouts ?? {})
        .filter((layout) => !layout.pageSlug.startsWith("_") && !loaded.schema.pages.some((page) => page.slug === layout.pageSlug))
        .map((layout) => ({ slug: layout.pageSlug, label: layout.label ?? layout.pageSlug })),
    ],
    [loaded],
  );
  const pageLabel = (slug: string | undefined) => pages.find((page) => page.slug === slug)?.label ?? slug ?? "";

  return (
    <div className="flex flex-col gap-5">
      {!canEdit && <Notice kind="info">Your account can change words and pictures; ask your agency to change the site's menus.</Notice>}
      {publish.isError && (
        <Notice kind="danger" title="The menus could not be published">
          {publish.error.message}
        </Notice>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {menus.length > 0 && (
            <label className="flex items-center gap-2 text-[13px] text-muted">
              <span>Menu</span>
              <Select value={menu?.id ?? ""} onChange={(event) => setCurrent(event.target.value)} className="h-10 w-56" data-testid="menu-select">
                {menus.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {canEdit && (
            <Button variant="secondary" size="sm" onClick={() => setNaming({ mode: "new", name: "" })} data-testid="menu-new">
              <IconPlus size={15} /> New menu
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {changed && (
            <Button variant="secondary" onClick={() => setMenus(published.menus ?? [])} disabled={publish.isPending}>
              Discard changes
            </Button>
          )}
          <Button onClick={() => publish.mutate({ kind: "kit", kit: { ...published, menus }, done: "Menus published." })} disabled={!changed || !canEdit} loading={publish.isPending} data-testid="menus-save">
            Save and publish
          </Button>
        </div>
      </div>

      {!menu ? (
        <EmptyState title="No menus yet" icon={<IconLayout size={18} />} action={canEdit ? <Button size="sm" onClick={() => setNaming({ mode: "new", name: "" })} data-testid="menu-create">Create a menu</Button> : undefined}>
          A menu is a list of pages and links. The Nav Menu widget in the header shows one; you can have several (a main menu, a footer menu).
        </EmptyState>
      ) : (
        <Panel
          title={
            <span className="inline-flex items-center gap-2">
              {menu.name}
              {canEdit && (
                <button type="button" className="text-[12px] font-semibold text-accent underline-offset-2 hover:underline" onClick={() => setNaming({ mode: "rename", name: menu.name })} data-testid="menu-rename">
                  Rename
                </button>
              )}
            </span>
          }
          aside={
            canEdit ? (
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setAdding({ kind: "page", page: pages[0]?.slug ?? "", label: "", href: "", parent: null })} data-testid="item-add">
                  <IconPlus size={15} /> Add item
                </Button>
                <Button variant="danger" size="sm" onClick={() => { setMenus(removeMenu(menus, menu.id)); setCurrent(null); }} data-testid="menu-delete">
                  Delete menu
                </Button>
              </div>
            ) : undefined
          }
        >
          {menu.items.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-muted">No items yet. Add a page or a link.</p>
          ) : (
            <ul data-testid="menu-items">
              {flattenItems(menu.items).map(({ item, depth }) => {
                const siblings = depth === 0 ? menu.items : (menu.items.find((parent) => parent.children?.some((child) => child.id === item.id))?.children ?? []);
                const at = siblings.findIndex((entry) => entry.id === item.id);
                return (
                  <li key={item.id} className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5 text-[14px] last:border-b-0" style={{ paddingLeft: depth ? 44 : undefined }} data-testid={`menu-item-${item.id}`} data-depth={depth}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-text">{item.label}</span>
                      <span className="block truncate text-[12px] text-muted">{item.kind === "page" ? `Page: ${pageLabel(item.page)}` : item.href}</span>
                    </span>
                    {canEdit && (
                      <span className="flex items-center gap-1">
                        <label className="mr-2 flex items-center gap-1.5 text-[12px] text-muted">
                          <input type="text" value={item.label} onChange={(event) => setMenus(updateItem(menus, menu.id, item.id, { label: event.target.value }))} className="h-8 w-36 rounded-control border border-line px-2 text-[13px]" aria-label={`Label for ${item.label}`} />
                        </label>
                        {item.kind === "url" && <input type="text" value={item.href ?? ""} onChange={(event) => setMenus(updateItem(menus, menu.id, item.id, { href: event.target.value }))} className="h-8 w-44 rounded-control border border-line px-2 font-mono text-[12px]" aria-label={`Address for ${item.label}`} />}
                        {item.kind === "page" && (
                          <Select value={item.page ?? ""} onChange={(event) => setMenus(updateItem(menus, menu.id, item.id, { page: event.target.value }))} className="h-8 w-40 text-[12px]" aria-label={`Page for ${item.label}`}>
                            {pages.map((page) => (
                              <option key={page.slug} value={page.slug}>
                                {page.label}
                              </option>
                            ))}
                          </Select>
                        )}
                        <Toggle checked={!!item.newTab} onChange={(next) => setMenus(updateItem(menus, menu.id, item.id, { newTab: next }))} label="New tab" />
                        <Button variant="secondary" size="sm" disabled={at <= 0} onClick={() => setMenus(moveItem(menus, menu.id, item.id, -1))} aria-label={`Move ${item.label} up`}>
                          <IconArrowUp size={14} />
                        </Button>
                        <Button variant="secondary" size="sm" disabled={at >= siblings.length - 1} onClick={() => setMenus(moveItem(menus, menu.id, item.id, 1))} aria-label={`Move ${item.label} down`}>
                          <IconArrowDown size={14} />
                        </Button>
                        {depth === 0 ? (
                          <Button variant="secondary" size="sm" disabled={at === 0} onClick={() => setMenus(indentItem(menus, menu.id, item.id))} data-testid={`indent-${item.id}`}>
                            Under previous
                            <SrOnly> (make {item.label} a dropdown entry)</SrOnly>
                          </Button>
                        ) : (
                          <Button variant="secondary" size="sm" onClick={() => setMenus(outdentItem(menus, menu.id, item.id))} data-testid={`outdent-${item.id}`}>
                            Out
                            <SrOnly> (lift {item.label} out of the dropdown)</SrOnly>
                          </Button>
                        )}
                        <Button variant="danger" size="sm" onClick={() => setMenus(removeItem(menus, menu.id, item.id))} aria-label={`Remove ${item.label}`} data-testid={`remove-${item.id}`}>
                          <IconTrash size={14} />
                        </Button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      <Modal
        open={naming !== null}
        onClose={() => setNaming(null)}
        title={naming?.mode === "rename" ? "Rename the menu" : "New menu"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNaming(null)}>
              Cancel
            </Button>
            <Button
              disabled={!naming?.name.trim()}
              data-testid="menu-name-save"
              onClick={() => {
                if (!naming) return;
                if (naming.mode === "rename" && menu) setMenus(renameMenu(menus, menu.id, naming.name));
                else {
                  const created = addMenu(menus, naming.name);
                  setMenus(created.menus);
                  setCurrent(created.id);
                }
                setNaming(null);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <Field label="Name" htmlFor="menu-name" hint="For your own reference, for example “Main menu” or “Footer links”.">
          <Input id="menu-name" value={naming?.name ?? ""} onChange={(event) => setNaming((current) => ({ mode: current?.mode ?? "new", name: event.target.value }))} autoFocus data-testid="menu-name" />
        </Field>
      </Modal>

      <Modal
        open={adding !== null}
        onClose={() => setAdding(null)}
        title="Add a menu item"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(null)}>
              Cancel
            </Button>
            <Button
              disabled={!adding || (adding.kind === "page" ? !adding.page : !/^(https?:\/\/|\/|mailto:|tel:)/i.test(adding.href.trim()))}
              data-testid="item-save"
              onClick={() => {
                if (!adding || !menu) return;
                const item = adding.kind === "page" ? { label: adding.label || pageLabel(adding.page), kind: "page" as const, page: adding.page } : { label: adding.label || adding.href, kind: "url" as const, href: adding.href.trim() };
                setMenus(addItem(menus, menu.id, item, adding.parent).menus);
                setAdding(null);
              }}
            >
              Add
            </Button>
          </>
        }
      >
        {adding && (
          <div className="flex flex-col gap-4">
            <Field label="Kind" htmlFor="item-kind">
              <Select id="item-kind" value={adding.kind} onChange={(event) => setAdding({ ...adding, kind: event.target.value as "page" | "url" })} data-testid="item-kind">
                <option value="page">A page of this site</option>
                <option value="url">A web address</option>
              </Select>
            </Field>
            {adding.kind === "page" ? (
              <Field label="Page" htmlFor="item-page">
                <Select id="item-page" value={adding.page} onChange={(event) => setAdding({ ...adding, page: event.target.value })} data-testid="item-page">
                  {pages.map((page) => (
                    <option key={page.slug} value={page.slug}>
                      {page.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Address" htmlFor="item-href" hint="https://…, /a-page/, mailto: or tel:">
                <Input id="item-href" value={adding.href} onChange={(event) => setAdding({ ...adding, href: event.target.value })} className="font-mono" data-testid="item-href" />
              </Field>
            )}
            <Field label="Label" htmlFor="item-label" hint="Leave empty to use the page's name.">
              <Input id="item-label" value={adding.label} onChange={(event) => setAdding({ ...adding, label: event.target.value })} data-testid="item-label" />
            </Field>
            {menu && menu.items.length > 0 && (
              <Field label="Under" htmlFor="item-parent" hint="Put it in a dropdown under another item, or at the top level.">
                <Select id="item-parent" value={adding.parent ?? ""} onChange={(event) => setAdding({ ...adding, parent: event.target.value || null })} data-testid="item-parent">
                  <option value="">Top level</option>
                  {menu.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export function AppearanceMenus() {
  const { loaded, body } = useLoaded();
  if (!loaded) return body;
  return <MenusEditor key={loaded.commitSha} loaded={loaded} />;
}
