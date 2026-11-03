# MeetMind AI — Authentication & Meeting Ownership Architecture

## Overview
MeetMind AI (v1.1.0) implements multi-user isolation and access control via **Firebase Authentication** on the client and cryptographic **Firebase Admin SDK** token verification on the FastAPI backend. Every meeting persisted in Cloud Firestore is strictly bound to its creator's Firebase UID.

---

## 1. Authentication Flow

```
┌─────────────────┐       1. Email/Password Login       ┌───────────────────────┐
│                 ├────────────────────────────────────►│                       │
│  React Frontend │                                     │  Firebase Auth (Web)  │
│  (AuthContext)  │◄────────────────────────────────────┤                       │
└────────┬────────┘       2. Cryptographic ID Token     └───────────────────────┘
         │                   (JWT valid for 1 hr)
         │
         │ 3. API Requests with Header:
         │    Authorization: Bearer <ID_TOKEN>
         ▼
┌─────────────────────────┐
│                         │
│  FastAPI Backend        │
│  (app/core/auth.py)     │
│                         │
└────────┬────────────────┘
         │
         │ 4. Verify Signature & Claims via Firebase Admin SDK
         ▼
┌─────────────────────────┐
│  Firebase Admin SDK     │
│  auth.verify_id_token() ├──────► Extracts UID & Token Metadata
└────────┬────────────────┘
         │
         │ 5. Validated UID injected into route dependency
         ▼
┌─────────────────────────┐
│                         │
│  Firestore Service      │
│  (owner_uid validation) │──────► Queries filtered by: owner_uid == current_user.uid
│                         │        Mutations verified: doc.owner_uid == current_user.uid
└─────────────────────────┘
```

1. **User Sign-In:** The user signs in or registers via the frontend modal using Email and Password through the official Firebase Web SDK (`firebase/auth`).
2. **Session Persistence:** Firebase manages secure session storage via `browserLocalPersistence`. Refreshes occur automatically in the background.
3. **Bearer Token Injection:** Before each API request, `apiService` extracts the current ID token (`user.getIdToken()`) and attaches it as `Authorization: Bearer <token>`.
4. **Server-Side Cryptographic Verification:**
   - The FastAPI dependency `get_current_user` in `app/core/auth.py` intercepts the request.
   - It verifies the JWT signature and expiration against Google's public certificates via `firebase_admin.auth.verify_id_token(token)`.
   - The backend **never trusts client-supplied UIDs** in bodies or parameters.
5. **Token Expiration Handling:** Expired or invalid tokens return `HTTP 401 Unauthorized` with a `WWW-Authenticate: Bearer` challenge. The frontend detects the 401 response and prompts the user to renew their session.

---

## 2. Meeting Ownership & Data Isolation

### Document Schema
Every newly created meeting document stored in Cloud Firestore contains an `owner_uid` attribute:

```json
{
  "meeting_id": "m_1730650000_a1b2c3d4",
  "owner_uid": "firebase_user_uid_here",
  "title": "Q4 Strategy & Planning",
  "transcript": "...",
  "created_at": "2026-11-04T02:00:00Z",
  "updated_at": "2026-11-04T02:00:00Z",
  "analysis": { ... },
  "answers_history": [ ... ]
}
```

### Access Control Enforcement
- **Listing Meetings (`GET /api/meetings`):**
  - Firestore query executes: `.where(filter=FieldFilter("owner_uid", "==", current_user.uid))`.
  - Results are sorted by `updated_at` descending in-memory to prevent missing composite index errors.
  - A user can only see records they created.
- **Retrieving Meeting Details (`GET /api/meetings/{id}`):**
  - Verifies that `doc.owner_uid == current_user.uid`.
  - If the meeting belongs to another user (or is an unowned legacy meeting), the server returns **`HTTP 404 Not Found`**, strictly preventing existence disclosure or ID enumeration.
- **Deleting Meetings (`DELETE /api/meetings/{id}`):**
  - Deletion is only permitted if `doc.owner_uid == current_user.uid`. Any attempt by another user returns `404 Not Found`.
- **Clarification Updates (`POST /api/meetings/clarify`):**
  - Updating stored meetings with new answers requires ownership of the referenced `meeting_id`.
- **PDF Report Generation (`GET /api/meetings/{id}/export/pdf`):**
  - Verifies ownership before compiling and streaming the PDF report.

---

## 3. Handling Legacy (Ownerless) Meeting Records

Meetings created before Phase 11 do not have an `owner_uid` field.

### Safety & Isolation Policy
1. **Quarantine:** Legacy records are **not** assigned to the first user who logs in.
2. **Access Denial:** Any authenticated request for an ownerless record returns `404 Not Found`.
3. **Exclusion from Lists:** Legacy records are excluded from user meeting lists.
4. **Non-Destructive Preservation:** Legacy records are preserved untouched in Firestore.

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

## 4. Configuration & Environment Variables

### Backend Configuration (`backend/.env`)
```bash
# Google Gemini Configuration
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash

# Firebase Admin Configuration (Authentication & Firestore)
FIREBASE_PROJECT_ID=meetmindai-9eac4
FIREBASE_CREDENTIALS_PATH=serviceAccountKey.json
FIRESTORE_COLLECTION_MEETINGS=meetings
FIREBASE_AUTH_ENABLED=true
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
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

---

## 5. Firebase Console Setup Steps

1. In the **[Firebase Console](https://console.firebase.google.com)**, navigate to **Build > Authentication**.
2. Click **Get Started** (if not already enabled).
3. Under the **Sign-in method** tab, enable **Email/Password**.
4. In **Project Settings > General > Your Apps**, create a **Web App** (e.g. `MeetMind Web Client`) and copy the configuration variables into `frontend/.env`.
5. Under **Service accounts**, generate a private key (`serviceAccountKey.json`) and place it in the `backend/` directory (ensure permissions are `chmod 600`).

