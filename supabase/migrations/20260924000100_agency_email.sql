-- Agency email settings for outgoing transactional email (invites, password resets, other
-- notifications). Every field is optional: without them, Armature returns the invite or
-- reset link for the agency to copy, as it does today. When they are set AND the
-- Supabase secret RESEND_API_KEY is present, the edge functions ask Resend to send the
-- email, so the client receives it under the agency's name.
--
-- Nothing depends on Resend: a site with none of these set still works exactly as it
-- did. Email is the optional add-on the spec calls for.
--
-- Only agency owners see or change these fields (RLS below). Owners and staff can send a
-- test email; the sent-at timestamp is written by the email-test function.

alter table public.agencies
  add column if not exists email_from_name text check (email_from_name is null or char_length(email_from_name) between 1 and 120),
  add column if not exists email_from_address text check (email_from_address is null or email_from_address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column if not exists email_reply_to text check (email_reply_to is null or email_reply_to ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column if not exists email_last_test_at timestamptz,
  add column if not exists email_last_test_error text;

comment on column public.agencies.email_from_name is 'The name emails come from (Reply-To sees this).';
comment on column public.agencies.email_from_address is 'The address emails come from. Set together with the Supabase secret RESEND_API_KEY to turn on delivery.';
comment on column public.agencies.email_reply_to is 'Optional Reply-To address: clients answer this rather than the from address.';
comment on column public.agencies.email_last_test_at is 'When the Send test email button was last used successfully.';
comment on column public.agencies.email_last_test_error is 'The last test send failure, if any (cleared on the next success).';

-- RLS is already enabled on public.agencies. The existing policies cover the row; these
-- columns follow along automatically.
