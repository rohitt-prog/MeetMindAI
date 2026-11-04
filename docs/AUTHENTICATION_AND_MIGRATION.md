# MeetMind AI — Authentication, Ownership & Migration Guide

## 1. Overview

MeetMind AI implements multi-user isolation and access control via **Firebase Authentication** on the client and cryptographic **Firebase Admin SDK** token verification on the FastAPI backend. Every meeting persisted in Cloud Firestore is strictly bound to its creator's Firebase UID (`owner_uid`).

The system supports two primary sign-in mechanisms:
1. **Email / Password Authentication**: Standard user registration and sign-in.
2. **Instant Demo Account Access**: Frictionless evaluation mode using native Firebase Anonymous Authentication (`signInAnonymously`) or dedicated demo credentials, issuing genuine Google-signed ID tokens so all backend security controls remain fully enforced.

---

## 2. Authentication Architecture & Flow

```
┌─────────────────────────────────┐
│        React Frontend           │
│  (AuthContext & apiService)     │
└───────┬─────────────────┬───────┘
        │                 │
 1. Email/Password        │ 1. Instant Demo Access
    signInWithEmail...    │    signInAnonymously()
        ▼                 ▼
┌─────────────────────────────────┐
│     Firebase Authentication     │
│   (Google Identity Platform)    │
└───────────────┬─────────────────┘
                │
                │ 2. Issues Cryptographic ID Token (JWT)
                ▼
┌─────────────────────────────────┐
│        React Frontend           │
│  (Persists in IndexedDB via SDK)│
└───────────────┬─────────────────┘
                │
                │ 3. API Request with Header:
                │    Authorization: Bearer <ID_TOKEN>
                ▼
┌─────────────────────────────────┐
│     FastAPI Backend             │
│   (RequestSizeLimit & Security) │
└───────────────┬─────────────────┘
                │
                │ 4. Intercepted by get_current_user Dependency
                ▼
┌─────────────────────────────────┐
│     Firebase Admin SDK          │
│   auth.verify_id_token()        ├──────► Cryptographically verifies JWT signature
└───────────────┬─────────────────┘
                │
                │ 5. Extracts caller UID & metadata into AuthenticatedUser
                ▼
┌─────────────────────────────────┐
│     require_rate_limit          │
│   (Atomic Redis Lua Script)     ├──────► Enforces sliding-window quota keyed by UID
└───────────────┬─────────────────┘
                │
                │ 6. Injected into Route Controllers
                ▼
┌─────────────────────────────────┐
│     Firestore Service           │
│   (owner_uid Isolation)         ├──────► Queries: .where(owner_uid == current_user.uid)
│                                 │        Mutations: doc.owner_uid == current_user.uid
└─────────────────────────────────┘
```

### Step-by-Step Lifecycle:
1. **User Sign-In**:
   - *Standard Flow*: The user inputs email and password. `AuthContext.login()` or `register()` invokes `signInWithEmailAndPassword` or `createUserWithEmailAndPassword`.
   - *Instant Demo Flow*: The user clicks *"Explore Demo Account"*. If `VITE_FIREBASE_DEMO_EMAIL` and `VITE_FIREBASE_DEMO_PASSWORD` are configured in `.env`, the client signs in with (and auto-provisions) that account. Otherwise, it invokes `signInAnonymously(auth)`. Firebase returns a genuine anonymous user credential with an assigned `uid`.
2. **Session Persistence & State Restoration**:
   - The Firebase Web SDK automatically maintains session state across browser refreshes via `IndexedDB`.
   - Before making authenticated API calls, `getFirebaseIdToken()` awaits `auth.authStateReady()` to ensure the restored session is active before reading `auth.currentUser`.
3. **Bearer Token Transmission**:
   - `apiService.fetchWithAuth()` retrieves the current ID token (`currentUser.getIdToken()`) and attaches it as `Authorization: Bearer <token>`.
4. **Server-Side Cryptographic Verification**:
   - The FastAPI dependency `get_current_user` in `app/core/auth.py` intercepts the request.
   - It validates the token's cryptographic signature and expiration against Google's public certificates via `firebase_admin.auth.verify_id_token(token, check_revoked=False)`.
   - The backend **never trusts client-supplied UIDs** in bodies or query parameters.
5. **Per-User Quota Enforcement**:
   - `require_rate_limit()` checks the caller's sliding-window quota keyed strictly by `f"{endpoint}:{current_user.uid}"`. Unauthenticated callers cannot consume quotas.
6. **Transparent 401 Retry on Token Expiry**:
   - If an ID token expires in transit (JWTs have a 1-hour lifetime), the backend returns `401 Unauthorized`.
   - `apiService.fetchWithAuth()` catches the 401, invokes `getFirebaseIdToken(forceRefresh=true)` to obtain a fresh token, and retries the request once.
   - If the retry succeeds, the request completes transparently without prompting the user.
7. **Session Expiry & Sign-Out**:
   - If a request fails with 401 after the retry (or if credentials are revoked), `apiService` triggers `onUnauthorized()`.
   - `AuthContext` calls `signOut(auth)`, purges local session storage, resets user state to `null`, and renders an informative `"Your session has expired. Please sign in again."` modal.

---

## 3. Meeting Ownership & Data Isolation

### Document Schema in Cloud Firestore

Every meeting document stored in the `meetings` collection contains an `owner_uid` attribute:

```json
{
  "meeting_id": "m_1730650000_a1b2c3d4",
  "owner_uid": "firebase_user_uid_here",
  "title": "Quarterly Product Review",
  "transcript": "...",
  "created_at": "2026-11-04T10:00:00.000Z",
  "updated_at": "2026-11-04T10:15:30.000Z",
  "analysis": { ... },
  "answers_history": [ ... ]
}
```

### Access Control Rules
- **Listing Meetings (`GET /api/meetings`)**:
  - Executes a Firestore query: `.where(filter=FieldFilter("owner_uid", "==", current_user.uid))`.
  - Results are sorted in memory by `updated_at DESC`, eliminating composite index requirements.
  - A user only receives meeting records matching their own `owner_uid`.
- **Retrieving Meeting Details (`GET /api/meetings/{id}`)**:
  - Verifies that `doc.owner_uid == current_user.uid`.
  - If the meeting belongs to another user (or is an unowned legacy meeting), the server returns **`HTTP 404 Not Found`**, strictly preventing existence disclosure or ID enumeration.
- **Deleting Meetings (`DELETE /api/meetings/{id}`)**:
  - Deletion is only permitted if `doc.owner_uid == current_user.uid`. Any attempt by another user returns `404 Not Found`.
- **Clarification Updates (`POST /api/meetings/clarify`)**:
  - In-place updates via `update_meeting_clarification` require `doc.owner_uid == current_user.uid`.
- **PDF Report Generation (`GET /api/meetings/{id}/export/pdf`)**:
  - Verifies ownership before compiling and streaming the PDF report.

---

## 4. Handling Legacy (Ownerless) Meeting Records

Meetings created prior to multi-user authentication do not contain an `owner_uid` field.

### Safety & Isolation Policy
1. **Quarantine**: Legacy records are **not** assigned to the first user who logs in.
2. **Access Denial**: Any authenticated request for an ownerless record returns `404 Not Found`.
3. **Exclusion from Lists**: Legacy records are excluded from user meeting lists.
4. **Non-Destructive Preservation**: Legacy records are preserved untouched in Firestore.

### Administrative Migration Tool
An administrator can safely audit and migrate legacy records to a designated user UID using the migration CLI tool:

```bash
# 1. Inspect unassigned legacy records without making changes:
python backend/scripts/migrate_legacy_meetings.py --list

# 2. Perform a dry-run migration to preview updates for a target user:
python backend/scripts/migrate_legacy_meetings.py --assign <TARGET_USER_UID> --dry-run

# 3. Apply non-destructive migration:
python backend/scripts/migrate_legacy_meetings.py --assign <TARGET_USER_UID>

# 4. Or migrate a single specific meeting ID:
python backend/scripts/migrate_legacy_meetings.py --meeting-id m_1730650000_a1b2c3d4 --assign <TARGET_USER_UID>
```

---

## 5. Configuration & Environment Variables

### Backend Configuration (`backend/.env`)
```bash
# Google Gemini AI Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash

# Firebase Admin Configuration (Authentication & Firestore)
FIREBASE_PROJECT_ID=meetmindai-9eac4
FIREBASE_CREDENTIALS_PATH=serviceAccountKey.json
FIRESTORE_COLLECTION_MEETINGS=meetings
FIREBASE_AUTH_ENABLED=true

# Security & Distributed Rate Limiting
RATE_LIMIT_ANALYZE=10/minute
RATE_LIMIT_CLARIFY=10/minute
RATE_LIMIT_PDF=20/minute
RATE_LIMIT_REDIS_URL=
RATE_LIMIT_FAIL_CLOSED=
RATE_LIMIT_REDIS_REQUIRED=false
```

### Frontend Configuration (`frontend/.env`)
```bash
# Backend API Base URL
VITE_API_BASE_URL=http://localhost:8000

# Firebase Client Web Configuration (from Firebase Console -> Project Settings -> General)
VITE_FIREBASE_API_KEY=your_firebase_web_api_key
VITE_FIREBASE_AUTH_DOMAIN=meetmindai-9eac4.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=meetmindai-9eac4
VITE_FIREBASE_STORAGE_BUCKET=meetmindai-9eac4.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_firebase_app_id
VITE_FIREBASE_MEASUREMENT_ID=your_measurement_id

# Optional: Dedicated Firebase Demo User Credentials
# If omitted, "Explore Demo Account" uses Firebase Anonymous Authentication.
# VITE_FIREBASE_DEMO_EMAIL=demo@meetmind.ai
# VITE_FIREBASE_DEMO_PASSWORD=your_demo_password_here
```

---

## 6. Firebase Console Setup Steps

1. In the **[Firebase Console](https://console.firebase.google.com)**, navigate to **Build > Authentication**.
2. Click **Get Started** (if not already enabled).
3. Under the **Sign-in method** tab:
   - Enable **Email/Password**.
   - Enable **Anonymous** (required for instant one-click demo access).
4. In **Project Settings > General > Your Apps**, create a **Web App** (e.g. `MeetMind Web Client`) and copy the configuration variables into `frontend/.env`.
5. Under **Project Settings > Service accounts**, generate a private key (`serviceAccountKey.json`) and place it in the `backend/` directory (`chmod 600 serviceAccountKey.json`).
