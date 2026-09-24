# Email sending (optional)

Armature does not need email to work. Invites and password-reset links come back
for you to copy to the client. If you want messages to go out under your
agency's own name, turn on **Resend**.

## What Resend is

Resend (<https://resend.com>) is a transactional-email service. It has a free
tier that suits most agencies: **3,000 emails a month**, **100 emails a day**,
**one verified domain**. Nothing else is needed to run Armature; only turn it on
when you want the polish of branded email.

## Step by step

1. **Create a Resend account.** Verify your agency's own domain (Resend Domain
   settings). Resend walks you through the DNS records.
2. **Copy your API key.** Resend › API Keys → Create → copy the value.
3. **Add the API key as a Supabase secret.** Supabase dashboard → Edge Functions
   → Secrets → add `RESEND_API_KEY` with the value from step 2. This is a
   Supabase-project-wide secret; nothing per-agency.
4. **Fill in the from-address.** In Armature, **Settings → Email sending**:
   - **From name** — what the recipient sees as the sender.
   - **From address** — any mailbox on the domain you verified in step 1.
   - **Reply-to** (optional) — where a reply goes.
5. **Send a test email.** The button emails your own address using the same code
   an invite would. If it fails, Armature shows the reason plainly.

## What changes once it's on

- **Invites** and **client password resets** are emailed under your agency's
  name (`emailed: true` in the response). The dashboard still shows the link, in
  case a message goes to spam.
- **Form submissions** on client sites can be emailed to your agency and to the
  client's recipients (per-site setup lives in **Site settings › Hosting &
  services**).

## When it's off

Everything still works. The dashboard shows the link with a "copy" button and a
note that says "Email sending isn't set up; copy this link".
