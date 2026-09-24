# Code engine: where should the preview runners live?

Research date: 2026-09-24. Vendor pages were egress-blocked from this environment, so figures come from search excerpts of the vendors' own pricing/docs pages, cross-checked against third-party writeups. Re-confirm on the linked vendor page before committing; where sources disagreed I say so.

## Workload assumptions (used for all cost math)

- One sandbox per client site: 2 vCPU / 2 GB RAM, ~1 GB persisted (repo + ~300 MB `node_modules`).
- Editing: 2 h/day on weekdays, 22 weekdays/month = 44 h. Add ~4 h/month for idle-timeout tails (10-15 min after each session) = **48 billed hours per site per month**.
- 1 / 20 / 100 sites = 48 / 960 / 4,800 sandbox-hours per month.
- Vite dev is mostly idle CPU; where a vendor bills "active CPU" only, I assume 25% CPU busy.

## The options

### 1. E2B (Firecracker sandboxes)

- Setup: sign up, create API key, paste. Build one template (Node + bun) with `e2b template build`. Genuinely "one key".
- First open: template clone in under 1 s. Working copy persists via pause/resume (filesystem + memory; resume ~1 s, pause ~4 s per GiB RAM), still labelled public beta. Sources conflict on whether paused sandboxes are kept indefinitely or deleted after 30 days - assume 30 days.
- Limits: Hobby (free, one-time $100 credit) caps a continuous session at **1 hour**, 20 concurrent; Pro ($150/mo + usage) allows 24 h sessions, 100 concurrent, 20 GB free storage. A 2-hour edit session on Hobby means a mid-session pause, so Pro is realistically required.
- Security: Firecracker microVM per sandbox (own kernel). Outbound network allow/deny lists (`allowOut` / `denyOut`, IPs and CIDRs).
- Pricing: $0.0504/vCPU-h + $0.0162/GiB-h -> 2 vCPU/2 GB = **$0.1332/h**. Storage beyond the free 10/20 GB is unpriced; I assume ~$0.10/GB-mo. Some blogs claim Pro includes 500 sandbox-hours; unverified, so I assume none.
- Cost: 1 site = $150 + 48 x 0.1332 = **~$156**. 20 sites = $150 + $128 = **~$278**. 100 sites = $150 + $639 + ~$8 storage = **~$800**.
- Sources: https://e2b.dev/pricing, https://e2b.dev/docs/billing, https://e2b.dev/docs/sandbox/internet-access

### 2. CodeSandbox SDK (Together AI)

- Setup: sign up, API token, paste. Build a template once; sites fork from it in ~2 s.
- First open: memory-snapshot resume 0.5-2 s. Hibernated snapshots are kept **7 days**; after that the sandbox cold-boots and re-runs setup, and the docs recommend persisting to Git rather than relying on long-lived VM snapshots. A client away for >7 days pays the ~4 min install again unless we snapshot after install.
- Limits: Free/Build: 400 credits (~40 Nano hours), 10 concurrent VMs, "SDK lite". Scale: **$170/mo** (one aggregator said $119; I use $170), 160 Nano-hours included, 250 concurrent, full SDK. Nearest size is Nano (2 vCPU / 4 GB) at 10 credits/h = $0.15/h; Pico (1 vCPU / 2 GB, $0.075/h) is thin for install + Vite.
- Security: Firecracker microVMs. I found no per-sandbox egress allowlist in the SDK docs; assume open egress.
- Together AI also lists the same product at $0.0446/vCPU-h + $0.0149/GiB-h ($0.119/h for 2/2); the credit model is what the SDK docs describe.
- Cost (Nano, $0.15/h): 1 site = ~48 h, mostly inside the free 40 h -> **~$1-7** (but SDK lite limits are undocumented). 20 sites = $170 + (960 - 160) x 0.15 = **~$290**. 100 sites = $170 + (4,800 - 160) x 0.15 = **~$866**.
- Sources: https://codesandbox.io/docs/sdk/pricing, https://codesandbox.io/docs/sdk/persistence, https://codesandbox.io/pricing, https://docs.together.ai/docs/together-code-sandbox

### 3. Daytona

- Setup: sign up ($200 credit, no plan fee), API key, paste. TypeScript SDK; build one base snapshot (Node + bun).
- First open: sub-second create from snapshot. Stop/start keeps the disk, so `node_modules` survives; auto-stop default 15 min (configurable), auto-archive to cold storage after 7 days stopped (slower restore, still no reinstall), auto-delete off by default. No hard session cap found.
- Limits: tiers are set by account verification/top-up, not a subscription. Tier 1 = 10 vCPU / 20 GiB / 30 GiB total across running sandboxes (= 5 concurrent 2-vCPU sandboxes); Tier 2 = 100 vCPU (50 concurrent); Tier 3 = 250 vCPU. Default disk 3 GiB per sandbox.
- Security: per-sandbox firewall (block-all / CIDR allowlist / domain allowlist); on Tier 1-2 an org-level restriction always applies (package registries stay reachable). Isolation is container-based (own filesystem/memory/network, org-scoped credentials); Sysbox/VM options in the docs read as self-host guidance. Weakest boundary of the managed options - not a microVM.
- Pricing: $0.0504/vCPU-h + $0.0162/GiB-h = **$0.1332/h**; storage $0.000108/GiB-h (~$0.078/GiB-mo) beyond 5 GiB free (I assume 3 GiB disk per sandbox, billed while it exists).
- Cost: 1 site = 48 x 0.1332 = **~$6.40** (covered by credits for months). 20 sites = $128 + (60 - 5) x 0.078 = **~$132**. 100 sites = $639 + 295 x 0.078 = **~$662**.
- Sources: https://www.daytona.io/pricing, https://www.daytona.io/docs/en/limits/, https://www.daytona.io/docs/en/network-limits/, https://www.daytona.io/docs/en/isolation/, https://www.daytona.io/docs/en/persistence/

### 4. Other managed options

**Modal Sandboxes.** gVisor isolation, filesystem + memory snapshots, 24 h max lifetime (default 5 min, `idle_timeout` available). Sandbox rate is ~3x the Functions rate: $0.00003942/core-s ($0.142/core-h) + $0.00000672/GiB-s ($0.024/GiB-h); cores are physical (2 vCPU), so 2 vCPU/2 GB is ~$0.19/h -> **$9.10/site/mo**. Starter is free with $30/mo credit; pinning a region costs 1.5-1.75x; volume pricing unpublished. 1 / 20 / 100 sites = **~$0 / ~$153 / ~$883** plus storage. https://modal.com/pricing, https://modal.com/docs/guide/sandbox-resources, https://modal.com/docs/guide/sandbox-snapshots

**Vercel Sandbox.** Firecracker, persists across sessions (24 h/session on Pro, 45 min on Hobby, which is non-commercial). Active CPU $0.128/vCPU-h (idle free), provisioned memory $0.0212/GB-h, snapshots $0.08/GB-mo (15 GB included), $0.15/GB egress, Pro $20/mo. Each vCPU carries 2 GB, so the unit is 2 vCPU/4 GB: 48 x (4 x 0.0212 + 2 x 0.25 x 0.128) = **~$7.15/site**. 1 / 20 / 100 = **~$27 / ~$164 / ~$741**. Solid, but no egress allowlist found and many billable line items. https://vercel.com/docs/sandbox/pricing, https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence

**Cloudflare Sandboxes.** Disk is ephemeral (fresh filesystem after every sleep), so `node_modules` is reinstalled on every open. Not a fit. https://developers.cloudflare.com/containers/pricing/

**Fly Sprites (Fly's sandbox product, Jan 2026).** Persistent Firecracker microVMs with NVMe disk, checkpoint/restore under 1 s, sleep when idle, no plan or per-sprite fee, one API token + JS SDK. Today: $0.07/CPU-h + $0.04375/GB-h while awake; hot storage $0.000683/GB-h (~$0.50/GB-mo) awake, cold $0.000027/GB-h (~$0.02/GB-mo) asleep. From **1 Oct 2026** CPU drops 45% and RAM 50% (Fly's example: 2 vCPU/4 GB flat-out for 720 h = $118.08, was $226.80), i.e. ~$0.0385/CPU-h and ~$0.022/GB-h. Per site post-October: 48 x (2 x 0.0385 + 2 x 0.022) + ~$0.05 storage = **~$5.90** (pre-October ~$11). 1 / 20 / 100 = **~$6 / ~$118 / ~$590**. Caveats: young product; per-sprite egress allowlist not confirmed. https://fly.io/sprites/, https://fly.io/sprites/checkpoint-restore/, https://fly.io/pricing-update/

### 5. Self-hosted on Railway (one long-running Node service + volume)

- Setup: deploy Armature's runner service from GitHub, attach a volume, set env vars. Click-ops is easy; the hard part is that *we* write and operate the runner: clone, install, spawn N `vite dev` processes, per-site routing, idle reaping, disk cleanup. Hobby ($5) caps volumes at 5 GB per service; Pro ($20) allows up to 1 TB.
- First open: instant if the dev server is still up, ~10 s from the volume, ~4 min on first clone.
- Security: every client site shares one container, filesystem and process tree. A malicious `postinstall` in one client's dependency can read every other client's source and the runner's GitHub token. No documented microVM/gVisor boundary; no egress control. Per-site services via Railway's API are possible, but each needs its own volume and serverless sleep only wakes on HTTP.
- Pricing: usage-billed, $20/vCPU-mo ($0.0278/vCPU-h) + $10/GB-mo ($0.0139/GB-h) on *actual* consumption, volume $0.15/GB-mo, egress $0.05/GB.
- Cost (~1 vCPU + 0.5 GB per site while active, ~0.1 vCPU + 0.5 GB baseline = ~$7/mo): per site 48 x (0.0278 + 0.5 x 0.0139) + 0.15 = ~$1.80. 1 site = $20 + $7 + $1.80 = **~$29** ($14 on Hobby). 20 sites = $20 + $7 + $36 + $3 = **~$66**. 100 sites = $20 + $7 + $180 + $15 = **~$222**, but 10-15 concurrent Vite servers in one container is a single point of failure.
- Sources: https://railway.com/pricing, https://docs.railway.com/pricing/plans, https://docs.railway.com/volumes/reference, https://docs.railway.com/reference/app-sleeping

### 6. Self-hosted on Fly Machines (one machine + volume per site)

- Setup: build a Docker image (Node/bun), write an orchestrator against the Machines API (machine + volume per site, start/stop, autostop via Fly Proxy, per-site routing), plus an always-on control machine. Real devops work: `flyctl`, TOML, private networking, volume placement.
- First open: stopped machine starts in ~1-3 s, then Vite boots from the volume (~10 s). First clone ~4 min unless `node_modules` is baked into a snapshot.
- Security: Firecracker microVM per machine, but no built-in egress allowlist (iptables inside the image).
- Pricing: shared-cpu-2x / 2 GB = $13.94/mo if always on (~$0.0194/h); RAM rises 20% ($5 -> $6/GB) on 1 Oct 2026. Stopped machines pay rootfs at $0.15/GB per 30 days; volumes $0.15/GB-mo provisioned.
- Cost: per site 48 x 0.0194 + 2 GB volume $0.30 + ~1 GB rootfs $0.15 = **~$1.40**. 1 / 20 / 100 sites = **~$7 / ~$33 / ~$145** including a ~$5 control machine. Cheapest by far, paid for in engineering time.
- Sources: https://fly.io/docs/about/pricing/, https://fly.io/pricing-update/

## Comparison

| Option | Setup for Troy | Isolation | Egress control | Working copy persists? | Idle / session limits | Plan fee | 1 site | 20 sites | 100 sites |
|---|---|---|---|---|---|---|---|---|---|
| E2B | Paste key + build 1 template | Firecracker microVM | Yes (allow/deny lists) | Pause/resume (beta); 30-day retention unclear | 1 h session on Hobby, 24 h on Pro; 20/100 concurrent | $150/mo Pro (needed) | ~$156 | ~$278 | ~$800 |
| CodeSandbox SDK | Paste key + build 1 template | Firecracker microVM | Not found | Memory snapshot 7 days, then cold boot + setup | 10 concurrent free, 250 on Scale | $170/mo Scale | ~$1-7 | ~$290 | ~$866 |
| Daytona | Paste key + build 1 snapshot | Container (not microVM) | Yes (block-all / CIDR / domain lists) | Yes; disk kept on stop, archived after 7 days | Auto-stop 15 min default; Tier 1 = 5 concurrent 2-vCPU, Tier 2 = 50 | None ($200 credit) | ~$6 | ~$132 | ~$662 |
| Modal | Paste key | gVisor | Yes (block/allow) | FS + memory snapshots (mem 7 days) | 24 h max lifetime; idle_timeout | None ($30/mo credit) | ~$0 | ~$153 + storage | ~$883 + storage |
| Vercel Sandbox | Paste key (Pro) | Firecracker microVM | Not found | Yes (stop/resume) | 24 h/session on Pro | $20/mo Pro | ~$27 | ~$164 | ~$741 |
| Fly Sprites | Paste token | Firecracker microVM | Not confirmed | Yes; NVMe disk, <1 s restore | Sleeps when idle; no session cap found | None | ~$6 | ~$118 | ~$590 |
| Railway (shared runner) | Click-deploy, but we build the runner | Shared container, none between sites | None | Yes (volume) | We manage it | $5-20/mo | ~$29 | ~$66 | ~$222 |
| Fly Machines (DIY) | Docker + Machines API + orchestrator | Firecracker microVM | DIY in-image | Yes (volume) | We manage it | None | ~$7 | ~$33 | ~$145 |

## Recommendation

**Pick Daytona.** It is the only managed option that hits all three of Troy's constraints at once: no plan fee (the bill scales from ~$6 to ~$660 with the business, and the $200 credit covers the first year at a handful of sites), a real persisted working copy so the second open is ~10 s with no snapshot gymnastics, and a per-sandbox firewall so a client's `npm install` cannot phone home to arbitrary hosts. Setup is sign up, copy the API key, paste it into Armature, and let Armature build one base snapshot with Node and bun. The honest trade-off is isolation: Daytona sandboxes are containers, not microVMs. For our threat model (our own clients' repos; the realistic risk is a bad npm dependency) that boundary plus the egress allowlist plus short-lived per-site GitHub tokens is adequate; it would not be for arbitrary anonymous code. Watch the tiers: Tier 1 allows five sites editing at once, so get bumped to Tier 2 before ~15 clients.

**Runner-up: Fly Sprites.** After the 1 October price cut it is the cheapest managed option at every scale, a true Firecracker microVM with persistent NVMe disk and sub-second restore, and also "paste one token". It is not first only because it is nine months old, the SDK surface is thinner, and I could not confirm per-sprite egress controls. Re-evaluate in early 2027; both are "create from snapshot, run commands, expose a port", so switching is a small adapter change.

E2B is the safe big-name choice if microVM isolation *and* egress lists are both non-negotiable and $150/mo fixed is acceptable from day one. Self-hosting is cheaper on paper (Fly Machines ~$145 at 100 sites) but every dollar saved is bought with orchestration code and on-call that a solo non-devops owner should not take on. I would rule out Railway's shared runner outright: cheapest at 20 sites, but every client's source sits in one container with no boundary between them.
