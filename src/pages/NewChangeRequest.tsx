/**
 * File a change request for a site: a title, what should change, and optional
 * screenshots. Images are resized in the browser before they are uploaded to the
 * private attachments bucket, one folder per request.
 */
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { IconArrowLeft, IconSend, IconUpload, IconX } from "@/components/icons.tsx";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, Field, Input, LinkButton, Notice, PageHeader, Panel, Textarea } from "@/components/ui.tsx";
import { prepareImage, type PreparedImage } from "@/lib/resizeImage.ts";
import { supabase } from "@/lib/supabase.ts";
import { ATTACHMENTS_BUCKET } from "@/lib/types.ts";

const TITLE_MAX = 200;
const DETAILS_MAX = 10000;

type PickedImage = { id: string; name: string; prepared: PreparedImage };
type SubmitInput = { title: string; details: string; images: PickedImage[] };
type SubmitResult = { requestId: string; uploadErrors: string[] };

function extensionFor(type: string): string {
  if (type === "image/png") return "png";
  if (type === "image/jpeg") return "jpg";
  return "webp";
}

async function submitRequest(siteId: string, userId: string, input: SubmitInput): Promise<SubmitResult> {
  const { data, error } = await supabase.from("change_requests").insert({ site_id: siteId, created_by: userId, title: input.title, details: input.details }).select("id").single();
  if (error) throw new Error(error.message);
  const requestId = (data as { id: string }).id;

  const uploadErrors: string[] = [];
  for (const [index, image] of input.images.entries()) {
    const file = image.prepared.file;
    const path = `${siteId}/${requestId}/${Date.now()}-${index}.${extensionFor(file.type)}`;
    const upload = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (upload.error) {
      uploadErrors.push(`${image.name}: ${upload.error.message}`);
      continue;
    }
    const record = await supabase.from("change_request_attachments").insert({ request_id: requestId, storage_path: path });
    if (record.error) uploadErrors.push(`${image.name}: uploaded, but could not be recorded: ${record.error.message}`);
  }
  return { requestId, uploadErrors };
}

function revokePreviews(images: PickedImage[]) {
  for (const image of images) URL.revokeObjectURL(image.prepared.previewUrl);
}

function Thumbnail({ image, onRemove, disabled }: { image: PickedImage; onRemove: () => void; disabled: boolean }) {
  return (
    <li className="relative">
      <img src={image.prepared.previewUrl} alt={image.name} className="aspect-square w-full rounded-control border border-line object-cover" />
      <p className="mt-1 truncate text-[12px] text-muted" title={image.name}>
        {image.name} · {Math.max(1, Math.round(image.prepared.bytes / 1024))} KB
      </p>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-control bg-panel/90 text-text shadow-segment hover:bg-panel disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Remove ${image.name}`}
      >
        <IconX size={16} />
      </button>
    </li>
  );
}

export function NewChangeRequest() {
  const { site } = useSite();
  const { user } = useAuth();
  const navigate = useNavigate();

  // The visual editor's "Request a change" bar prefills the form through the query string.
  const [searchParams] = useSearchParams();
  const [title, setTitle] = useState(() => (searchParams.get("title") ?? "").slice(0, TITLE_MAX));
  const [details, setDetails] = useState(() => (searchParams.get("details") ?? "").slice(0, DETAILS_MAX));
  const [images, setImages] = useState<PickedImage[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Mirror `images` into a ref so the unmount cleanup can revoke every preview URL.
  const imagesRef = useRef<PickedImage[]>([]);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(() => () => revokePreviews(imagesRef.current), []);

  const mutation = useMutation({
    mutationFn: (input: SubmitInput) => {
      if (!user) throw new Error("You are signed out. Sign in again and try once more.");
      return submitRequest(site.id, user.id, input);
    },
    onSuccess: (result) => {
      if (result.uploadErrors.length === 0) {
        revokePreviews(imagesRef.current);
        navigate(`/sites/${site.id}/requests/${result.requestId}`);
      }
    },
  });

  async function onPickFiles(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length === 0) return;
    setPreparing(true);
    const added: PickedImage[] = [];
    const problems: string[] = [];
    for (const file of files) {
      try {
        const prepared = await prepareImage(file);
        added.push({ id: crypto.randomUUID(), name: file.name, prepared });
      } catch (error) {
        problems.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    setImages((current) => [...current, ...added]);
    setFileErrors(problems);
    setPreparing(false);
  }

  function removeImage(id: string) {
    setImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) URL.revokeObjectURL(target.prepared.previewUrl);
      return current.filter((image) => image.id !== id);
    });
  }

  /** Clear everything after a partially-uploaded request so a new one can be filed. */
  function startAnother() {
    revokePreviews(images);
    setImages([]);
    setTitle("");
    setDetails("");
    setFileErrors([]);
    setFormError(null);
    mutation.reset();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.data) return; // The request already exists; a second insert would duplicate it.
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("Give the request a title.");
      return;
    }
    if (trimmedTitle.length > TITLE_MAX) {
      setFormError(`The title is ${trimmedTitle.length} characters; the limit is ${TITLE_MAX}.`);
      return;
    }
    if (details.length > DETAILS_MAX) {
      setFormError(`The details are ${details.length} characters; the limit is ${DETAILS_MAX}.`);
      return;
    }
    setFormError(null);
    mutation.mutate({ title: trimmedTitle, details: details.trim(), images });
  }

  const partial = mutation.data && mutation.data.uploadErrors.length > 0 ? mutation.data : null;
  // Once the row exists the form is frozen: re-sending would create a duplicate request.
  const sent = Boolean(mutation.data);
  const busy = mutation.isPending || preparing || sent;

  return (
    <div className="flex flex-col gap-4">
      <Link to={`/sites/${site.id}/requests`} className="inline-flex h-11 items-center gap-2 text-[13px] font-medium text-muted hover:text-text">
        <IconArrowLeft size={16} /> All change requests
      </Link>
      <PageHeader title="Request a change" description={`Tell the agency what should change on ${site.name}. They see it straight away.`} />

      {partial && (
        <Notice
          kind="warning"
          title="The request was sent, but some screenshots did not upload"
          action={
            <>
              <LinkButton to={`/sites/${site.id}/requests/${partial.requestId}`} size="sm">
                Open the request
              </LinkButton>
              <Button variant="secondary" size="sm" onClick={startAnother}>
                Start another request
              </Button>
            </>
          }
        >
          {partial.uploadErrors.join("\n")}
        </Notice>
      )}

      <form onSubmit={onSubmit} noValidate className="max-w-3xl">
        <Panel title="The request">
          <div className="flex flex-col gap-5 p-4 sm:p-5">
            <Field label="Title" htmlFor="request-title" hint={`${title.length}/${TITLE_MAX}`}>
              <Input
                id="request-title"
                required
                maxLength={TITLE_MAX}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Update the opening hours on the Contact page"
                disabled={busy}
              />
            </Field>

            <Field label="Details" htmlFor="request-details" hint="What should change, and where? Links to the page help.">
              <Textarea id="request-details" maxLength={DETAILS_MAX} value={details} onChange={(event) => setDetails(event.target.value)} rows={6} disabled={busy} />
            </Field>

            <Field label="Screenshots" htmlFor="request-screenshots" hint="Optional. PNG, JPEG or WebP. Images are resized in your browser before upload.">
              <label
                htmlFor="request-screenshots"
                className="flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed border-line bg-ground px-4 py-4 text-center text-[13px] text-muted hover:border-muted/60"
              >
                <IconUpload size={20} />
                <span>
                  <span className="font-semibold text-text">Choose images</span> or drop them here
                </span>
                <input
                  id="request-screenshots"
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => void onPickFiles(event)}
                  disabled={busy}
                  className="sr-only"
                />
              </label>
            </Field>

            {preparing && (
              <p className="text-[13px] text-muted" role="status">
                Preparing images…
              </p>
            )}

            {fileErrors.length > 0 && (
              <Notice kind="danger" title="Some files could not be used">
                {fileErrors.join("\n")}
              </Notice>
            )}

            {images.length > 0 && (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Chosen screenshots">
                {images.map((image) => (
                  <Thumbnail key={image.id} image={image} onRemove={() => removeImage(image.id)} disabled={busy} />
                ))}
              </ul>
            )}

            {formError && (
              <Notice kind="danger" title="Check the form">
                {formError}
              </Notice>
            )}
            {mutation.isError && (
              <Notice kind="danger" title="The request could not be sent">
                {mutation.error.message}
              </Notice>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" loading={mutation.isPending} disabled={preparing || sent}>
                <IconSend size={16} /> Send request
              </Button>
              <Link to={`/sites/${site.id}/requests`} className="inline-flex h-11 items-center px-2 text-[14px] font-medium text-muted hover:text-text">
                Cancel
              </Link>
            </div>
          </div>
        </Panel>
      </form>
    </div>
  );
}
