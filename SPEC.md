# ROLE
You are a senior full-stack engineer and architect. Build a production-quality, WhatsApp-style real-time messaging app called "ChatSphere" with voice and video calling (up to 10 participants per call, Zoom-like). Work agentically: first produce an implementation plan and task list as artifacts, wait for my approval, then build phase by phase. After each phase, run the app/tests and verify before moving on.

# TECH STACK (do not substitute without asking)
- Monorepo: pnpm workspaces + Turborepo
- Frontend (web/PWA): Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui, Zustand, TanStack Query
- Backend: NestJS (TypeScript), REST + WebSocket gateway (Socket.IO)
- Database: PostgreSQL with Prisma ORM
- Cache / presence / pub-sub: Redis
- Calls: LiveKit (self-hosted SFU via Docker) + livekit-client (frontend) + livekit-server-sdk (backend token generation). No mesh WebRTC.
- File/media storage: MinIO (S3-compatible) locally, with an abstraction so S3/Cloudflare R2 can be swapped in
- Auth: JWT (access + refresh tokens), phone/email OTP login (mock OTP provider in dev), bcrypt for any passwords
- Push notifications: Web Push (VAPID) with a service worker
- Validation: Zod (shared schemas in packages/shared)
- Testing: Vitest/Jest for unit, Playwright for e2e smoke tests
- DevOps: Docker Compose for the full local stack (postgres, redis, minio, livekit, api, web), .env.example, GitHub Actions CI

# CORE FEATURES

## 1. Auth & Profile
- Sign up / login with phone number or email + OTP
- Profile: name, avatar, about/status text, last seen, online presence
- Privacy settings: who can see last seen / avatar

## 2. Messaging
- 1:1 chats and group chats (up to 256 members, admin roles)
- Real-time delivery via Socket.IO with delivery states: sent, delivered, read (ticks)
- Typing indicators, online/offline presence
- Message types: text, emoji, image, video, audio/voice note, document, location, contact
- Reply, forward, edit (within 15 min), delete for me / delete for everyone
- Message reactions (emoji)
- Message search (Postgres full-text search)
- Starred messages, pinned chats, archived chats, mute chats
- Unread badge counts, infinite scroll pagination (cursor-based)
- Offline queue: messages typed offline are sent on reconnect
- Media upload with progress, thumbnails/compression, presigned URLs

## 3. Voice & Video Calls (LiveKit)
- 1:1 voice call and video call
- Group calls with up to 10 participants (enforce max 10 on the server when issuing tokens)
- Start a call from any chat; participants get an incoming call screen (accept / decline) via socket event + push notification
- In-call controls: mute/unmute mic, camera on/off, switch camera, speaker select, leave call
- Screen sharing
- Dynamic grid layout (1-10 tiles), active-speaker highlighting, pin a participant
- Adaptive bitrate / simulcast enabled, network quality indicator
- Join via meeting link / room code (Zoom-style scheduled or instant meetings)
- Host controls: mute participant, remove participant, end call for all
- In-call chat sidebar and raise-hand / reaction emojis
- Call history (missed, incoming, outgoing) with duration
- Backend generates short-lived LiveKit access tokens only for authenticated users who are members of that chat/meeting
- Handle LiveKit webhooks to track participant joined/left and call duration

## 4. Extras
- Status/Stories (24h expiry, using a BullMQ cron/queue job)
- Dark/light theme
- End-to-end encryption: design the architecture for it (document the approach with Signal-protocol-style keys), implement transport encryption now, and leave clear extension points for E2EE later
- Responsive UI: desktop two-pane layout like WhatsApp Web, mobile-first single-pane on small screens, installable PWA

# ARCHITECTURE REQUIREMENTS
- Clean modular structure: apps/web, apps/api, packages/shared (types, zod schemas), packages/config
- NestJS modules: auth, users, chats, messages, media, calls, notifications, presence, status
- Prisma schema covering: User, Device, Chat, ChatMember, Message, MessageReceipt, Reaction, Attachment, Call, CallParticipant, Status, PushSubscription
- Socket.IO with Redis adapter so it scales horizontally
- Rate limiting, helmet, CORS config, input validation on every endpoint, and proper error handling
- Structured logging (pino)
- OpenAPI/Swagger docs auto-generated for the API

# UI/UX
- Pixel-close to the WhatsApp Web feel (chat list on the left, conversation on the right) but with an original visual identity/branding (not a copy of WhatsApp assets)
- Smooth animations, skeleton loaders, empty states, toasts
- Accessible (keyboard nav, ARIA labels, contrast)

# DELIVERY PHASES (build in this order, verify each one)
Phase 0: Plan + monorepo scaffold + Docker Compose (postgres, redis, minio, livekit) running
Phase 1: Auth + profiles + database schema
Phase 2: 1:1 real-time chat with receipts, presence, typing
Phase 3: Group chats + media/voice notes + reactions/replies/search
Phase 4: LiveKit integration: 1:1 voice/video calls, incoming call flow
Phase 5: Group calls (up to 10), screen share, host controls, meeting links
Phase 6: Push notifications, status/stories, call history, PWA
Phase 7: Tests, security hardening, README, deployment guide

# VERIFICATION (use the Antigravity browser agent)
- After Phases 2, 4 and 5, launch the app in the browser with two or more simulated users and record a walkthrough artifact proving: messages deliver in real time, a call connects, and a 10-participant call renders a correct grid
- Add a script that simulates 10 LiveKit participants joining one room for load testing
- Run lint, type-check, and tests before declaring any phase complete

# OUTPUT EXPECTATIONS
- Working code, not pseudo-code; no placeholder "TODO" logic in core paths
- A README with: architecture diagram (Mermaid), setup steps (`docker compose up`), env variables, and how to run tests
- Commit-style summaries at the end of each phase
- Ask me before making any decision that changes the stack or scope

Start now with Phase 0: present the implementation plan and task list for my approval.