/**
 * File a change request for a site: a title, what should change, and optional
 * screenshots. Images are resized in the browser before they are uploaded to the
 * private attachments bucket, one folder per request.
 */
import { useMutation } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { useAuth } from "@/auth/AuthProvider.tsx";
import { useSite } from "@/components/SiteLayout.tsx";
import { Button, Card, Field, Input, LinkButton, Notice, PageHeader, Textarea } from "@/components/ui.tsx";
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
  const { data, error } = await supabase
    .from("change_requests")
    .insert({ site_id: siteId, created_by: userId, title: input.title, details: input.details })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const requestId = (data as { id: string }).id;

  const uploadErrors: string[] = [];
  for (const [index, image] of input.images.entries()) {
    const file = image.prepared.file;
    const path = `${siteId}/${requestId}/${Date.now()}-${index}.${extensionFor(file.type)}`;
    const upload = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upload.error) {
      uploadErrors.push(`${image.name}: ${upload.error.message}`);
      continue;
    }
    const record = await supabase.from("change_request_attachments").insert({ request_id: requestId, storage_path: path });
    if (record.error) uploadErrors.push(`${image.name}: uploaded, but could not be recorded: ${record.error.message}`);
  }
  return { requestId, uploadErrors };
}

function Thumbnail({ image, onRemove }: { image: PickedImage; onRemove: () => void }) {
  return (
    <li className="relative">
      <img
        src={image.prepared.previewUrl}
        alt={image.name}
        className="aspect-square w-full rounded-lg border border-line object-cover"
      />
      <p className="mt-1 truncate text-xs text-muted" title={image.name}>
        {image.name} · {Math.max(1, Math.round(image.prepared.bytes / 1024))} KB
      </p>
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-panel/90 text-text hover:bg-panel"
        aria-label={`Remove ${image.name}`}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </li>
  );
}

export function NewChangeRequest() {
  const { site } = useSite();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [images, setImages] = useState<PickedImage[]>([]);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: SubmitInput) => {
      if (!user) throw new Error("You are signed out. Sign in again and try once more.");
      return submitRequest(site.id, user.id, input);
    },
    onSuccess: (result) => {
      if (result.uploadErrors.length === 0) {
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

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
  const busy = mutation.isPending || preparing;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Request a change"
        description={`Tell the agency what should change on ${site.name}. They will see it straight away.`}
      />

      {partial && (
        <Notice
          kind="warning"
          title="The request was sent, but some screenshots did not upload"
          action={<LinkButton to={`/sites/${site.id}/requests/${partial.requestId}`}>Open the request</LinkButton>}
        >
          {partial.uploadErrors.join("\n")}
        </Notice>
      )}

      <form onSubmit={onSubmit} noValidate>
        <Card className="space-y-5">
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

          <Field
            label="Details"
            htmlFor="request-details"
            hint="What should change, and where? Links to the page help."
          >
            <Textarea
              id="request-details"
              maxLength={DETAILS_MAX}
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              rows={6}
              disabled={busy}
            />
          </Field>

          <Field
            label="Screenshots"
            htmlFor="request-screenshots"
            hint="Optional. PNG, JPEG or WebP. Images are resized in your browser before upload."
          >
            <input
              id="request-screenshots"
              type="file"
              multiple
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => void onPickFiles(event)}
              disabled={busy}
              className="block w-full min-h-11 rounded-lg border border-line bg-panel px-3 py-2 text-[15px] text-text file:mr-3 file:min-h-8 file:rounded-md file:border-0 file:bg-ground file:px-3 file:text-sm file:font-medium file:text-text disabled:bg-ground disabled:text-muted"
            />
          </Field>

          {preparing && <p className="text-sm text-muted">Preparing images…</p>}

          {fileErrors.length > 0 && (
            <Notice kind="danger" title="Some files could not be used">
              {fileErrors.join("\n")}
            </Notice>
          )}

          {images.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Chosen screenshots">
              {images.map((image) => (
                <Thumbnail key={image.id} image={image} onRemove={() => removeImage(image.id)} />
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
            <Button type="submit" loading={mutation.isPending} disabled={preparing}>
              Send request
            </Button>
            <Link
              to={`/sites/${site.id}/requests`}
              className="inline-flex min-h-11 items-center text-sm text-muted underline-offset-2 hover:underline"
            >
              Cancel
            </Link>
          </div>
        </Card>
      </form>
    </div>
  );
}
