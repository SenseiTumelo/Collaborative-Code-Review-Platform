# Assessment checklist

Use this checklist when presenting and explaining the project.

- [ ] PostgreSQL configured, migration executed, health endpoint returns 200.
- [ ] Register two roles; demonstrate login and JWT expiration.
- [ ] Show a password hash in the users table, never a plaintext password.
- [ ] Create/update a profile and demonstrate another user cannot edit it.
- [ ] Create a project and assign/remove a reviewer.
- [ ] Post text code and retrieve it under its project.
- [ ] Show a general comment and an inline comment; demonstrate invalid line rejection.
- [ ] Demonstrate submitters receive 403 when attempting to comment.
- [ ] Demonstrate comments can only be changed/deleted by their reviewer author.
- [ ] Request changes, update code, resubmit and approve.
- [ ] Show the preserved review history.
- [ ] Open a WebSocket client, authenticate and receive a notification from another user's action.
- [ ] Retrieve notifications using HTTP after reconnecting.
- [ ] Show approval percentage, review time, reviewer activity and most-commented submission.
- [ ] Demonstrate outsider access is forbidden and removed membership revokes access.
- [ ] Demonstrate validation errors, invalid credentials and malformed JSON.
- [ ] Run the build and automated tests.

Be ready to explain authentication vs authorization, why passwords are hashed, connection pooling, foreign keys and cascading deletes, parameterized SQL, transactions for decisions, why WebSocket clients must authenticate, and the limits of in-memory database tests.
