CREATE TABLE IF NOT EXISTS users (
 id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('reviewer','submitter')),
 display_picture TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS projects (
 id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS project_members (
 project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
 user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY(project_id,user_id)
);
CREATE TABLE IF NOT EXISTS submissions (
 id SERIAL PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL, code TEXT NOT NULL, filename TEXT, language TEXT NOT NULL DEFAULT 'text',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_review','approved','changes_requested')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS comments (
 id SERIAL PRIMARY KEY, submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL,
 line INTEGER CHECK(line > 0), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS reviews (
 id SERIAL PRIMARY KEY, submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
 reviewer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 decision TEXT NOT NULL CHECK(decision IN ('approved','changes_requested')), feedback TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS notifications (
 id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 submission_id INTEGER REFERENCES submissions(id) ON DELETE CASCADE,
 type TEXT NOT NULL, message TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS submissions_project_idx ON submissions(project_id);
CREATE INDEX IF NOT EXISTS comments_submission_idx ON comments(submission_id);
CREATE INDEX IF NOT EXISTS reviews_submission_idx ON reviews(submission_id);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id);
