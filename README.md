# Collaborative Code Review Platform

Assessment API built with TypeScript, Express, PostgreSQL, JWT, and WebSockets. No frontend is required by the brief. Use Postman or another HTTP/WebSocket client to demonstrate the API.

## Setup

Requires Node.js 22+ and PostgreSQL (or Docker Desktop).

```powershell
npm install
```


If using Docker:

```powershell
docker compose up -d
```

If using an existing PostgreSQL installation, create a database named `code_review` and configure your username/password in DATABASE_URL. Then:

```powershell
npm run db:migrate
npm run dev
```

The API runs at `http://localhost:3000`. The migration can be run again safely to create missing tables; future schema changes should use new migrations.

```powershell
npm run build
npm start
npm test
```

Tests use an isolated in-memory PostgreSQL emulator and never touch your configured database. They cover authentication, validation, role restrictions, project isolation, comments, review history, analytics, notifications and membership revocation. Real PostgreSQL and a WebSocket client should also be used for the final demonstration.

## Design and permissions

- Registration selects `submitter` or `reviewer`, as this is an open assessment platform. Profiles cannot change roles later.
- Both roles may create projects. Owners manage projects and assign reviewers. Owners and assigned reviewers can access project resources.
- Both roles can submit code in a project they can access. Only submission authors can edit/delete their code.
- Submitters cannot create, update, or delete comments. Reviewers may comment, but only edit/delete their own comments.
- Reviewers cannot approve or request changes on their own submissions.
- Profiles and notifications are accessible only to their user. Deleting a profile cascades through its owned projects and authored data.
- Passwords are hashed with bcrypt. JWTs expire after one hour. Each protected HTTP request checks that the user still exists.
- Text files are submitted as JSON `code` with an optional `filename`; binary uploads and multipart uploads are not supported. Display pictures are URL fields.
- Project deletion cascades through its submissions, comments, reviews, and associated notifications.

## Endpoints

All routes except health, registration and login require `Authorization: Bearer <token>`. List endpoints support `limit` (1–100, default 50) and `offset` (default 0), except the project member list.

| Method      | Route                                   | Purpose/body                                          |
|-------------|-----------------------------------------|-------------------------------------------------------|
| GET         | `/api/health`                           | Database availability                                 |
| POST        | `/api/auth/register`                    | `name,email,password,role,display_picture?`           |
| POST        | `/api/auth/login`                       | `email,password`; returns token                       |
| GET         | `/api/users/:id`                        | Own profile                                           |
| PATCH       | `/api/users/:id`                        | `name?,email?,display_picture?`                       |
| DELETE      | `/api/users/:id`                        | Delete own account                                    |
| POST        | `/api/projects`                         | `name,description?`                                   |
| GET         | `/api/projects`                         | Accessible projects                                   |
| GET         | `/api/projects/:id`                     | Project details                                       |
| PATCH       | `/api/projects/:id`                     | Owner: `name?,description?`                           |
| DELETE      | `/api/projects/:id`                     | Owner: delete project                                 |
| GET         | `/api/projects/:id/members`             | Assigned reviewers                                    |
| POST        | `/api/projects/:id/members`             | Owner: `userId` of reviewer                           |
| DELETE      | `/api/projects/:id/members/:userId`     | Owner: remove reviewer                                | 
| POST        | `/api/submissions`                      | `projectId,title,code,filename?,language?`            |
| GET         | `/api/projects/:id/submissions`         | Project submissions                                   |
| GET         | `/api/submissions/:id`                  | Code and status                                       |
| PATCH       | `/api/submissions/:id`                  | Author: `code,title?`, while pending/changes requested|
| PATCH       | `/api/submissions/:id/status`           | `status,feedback?`                                    |
| DELETE      | `/api/submissions/:id`                  | Author: delete submission                             |
| GET         | `/api/submissions/:id/comments`         | General and inline comments                           |
| POST        | `/api/submissions/:id/comments`         | Reviewer: `body,line?` (1-based)                      |
| PATCH       | `/api/comments/:id`                     | Comment author: `body`                                |
| DELETE      | `/api/comments/:id`                     | Comment author                                        |
| POST        | `/api/submissions/:id/approve`          | Reviewer: `feedback?`                                 |
| POST        | `/api/submissions/:id/request-changes`  | Reviewer: `feedback?`                                 |
| GET         | `/api/submissions/:id/reviews`          | Review history                                        |
| GET         | `/api/users/:id/notifications`          | Own activity feed                                     |
| GET         | `/api/projects/:id/stats`               | Project analytics                                     |
|-------------|-----------------------------------------|-------------------------------------------------------|

Registration provides the create operation for profile CRUD. PATCH is used for partial updates.

Errors return JSON with `error`; validation errors also include `details`. Statuses: 400 invalid input, 401 missing/expired authentication, 403 forbidden, 404 absent resource, 409 conflict, 413 oversized request, 500 unexpected failure.

## Demonstration walkthrough

1. Register a submitter and a reviewer; log in as each and save both tokens and user IDs.
2. As submitter, create a project. Assign the reviewer using the member endpoint.
3. As submitter, post a submission:

```json
{"projectId":1,"title":"Counter function","code":"function count() {\n  return 1;\n}","filename":"counter.js","language":"javascript"}
```

4. As reviewer, mark it `in_review` and add an inline comment:

```json
{"body":"Could this accept a starting value?","line":2}
```

5. Request changes with `{"feedback":"Accept a starting value"}`. Check review history and the submitter's notifications.
6. As submitter, edit the code and reset status to `pending`. As reviewer, approve it.
7. Inspect project statistics. Try commenting with the submitter token to demonstrate a 403 permission error.
8. Remove the reviewer and demonstrate that project access is revoked.

Replace example IDs with those returned by your requests.

## Review status and analytics

New submissions start `pending`. A reviewer can move pending code to `in_review`. Reviewers can approve/request changes through either decision endpoint or the status endpoint; each decision is inserted into review history in the same transaction as the status change. The author can edit code after changes are requested, then reset it to pending. History is preserved when code changes; reviews refer to the submission, not immutable code revisions.

Stats define approval and changes-requested percentages against all submissions' current status. The brief's "rejected" state is represented by `changes_requested`. Average review time is hours from submission creation to its first decision, excluding unreviewed submissions. Reviewer activity counts decision events by reviewer ID. Most-commented submission counts current comments; ties use the lowest submission ID. An empty project returns zero percentages and null average/most-commented fields.

## WebSocket demonstration

In Postman's WebSocket client, connect to `ws://localhost:3000/ws`. Within five seconds send:

```json
{"type":"auth","token":"YOUR_LOGIN_TOKEN"}
```

Expect `{"type":"authenticated","userId":1}`. Keep the submitter's socket open while the reviewer adds a comment or makes a decision through HTTP. The socket receives:

```json
{"type":"notification","data":{"id":1,"user_id":1,"submission_id":1,"type":"comment","message":"New comment on Counter function","created_at":"..."}}
```

Notifications are stored before publishing and sent to project owners, assigned reviewers, and the submission author, excluding the acting user. Tokens are sent in a message instead of a URL. Sockets close when their JWT expires. Reconnect and use the REST activity feed to retrieve missed events. Delivery is best effort; this assessment uses a single server process. Use HTTPS/WSS when hosted.

## Sprint mapping

1. TypeScript setup, connection pool, relational schema: `src/db.ts`, `sql/001_initial.sql`.
2. Registration/login, JWT and profile CRUD: `src/auth.ts`, `src/app.ts`.
3. Projects and memberships: project routes.
4. Text submissions and status management: submission routes.
5. Inline/general comments and author permissions: comment routes.
6. Transactional review decisions and history: review routes.
7. Stored notifications, authenticated sockets, analytics: `src/server.ts`, feed/stats routes.
8. Central error handling, Zod validation, integration tests: `src/app.ts`, `tests/api.test.ts`.

Import docs/postman_collection.json into Postman for ready-made HTTP requests. Set the collection token variable to the acting user's JWT, and replace example IDs with returned IDs. Registration/login/health require no authentication. Destructive delete requests are placed at the end.
