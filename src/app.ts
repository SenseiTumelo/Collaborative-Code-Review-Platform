import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { Pool } from 'pg';
import { Identity, verifyToken } from './auth';

declare global { namespace Express { interface Request { user?: Identity } } }
class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
const idSchema = z.coerce.number().int().positive();
const text = z.string().trim().min(1).max(10000);
const profile = z.object({ name: z.string().trim().min(1).max(100), email: z.email().max(254), display_picture: z.url().max(2048).nullable().optional() });
export function createApp(db: Pool, secret: string, publish: (userId: number, notification: unknown) => void = () => {}) {
 const app = express();
 app.use(helmet(), cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' }), express.json({ limit: '1mb' }));
 const q = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows;
 const one = async (sql: string, args: unknown[] = []) => { const row = (await q(sql,args))[0]; if (!row) throw new ApiError(404,'Resource not found'); return row; };
 const id = (req: Request, key = 'id') => idSchema.parse(req.params[key]);
 const uid = (req: Request) => req.user!.id;
 const reviewer = (req: Request) => { if(req.user!.role !== 'reviewer') throw new ApiError(403,'Only reviewers may perform this action'); };
 const member = async (req: Request, projectId: number) => {
  const project = await one('SELECT * FROM projects WHERE id=$1',[projectId]);
  if(project.owner_id !== uid(req) && !(await q('SELECT user_id FROM project_members WHERE project_id=$1 AND user_id=$2',[projectId,uid(req)])).length) throw new ApiError(403,'Project access denied');
  return project;
 };
 const owner = async (req: Request, projectId: number) => { const project = await member(req,projectId); if(project.owner_id !== uid(req)) throw new ApiError(403,'Only the project owner may manage this project'); return project; };
 const submission = async (req: Request) => { const s = await one('SELECT * FROM submissions WHERE id=$1',[id(req)]); await member(req,s.project_id); return s; };
 const page = (req: Request) => { const v = z.object({ limit:z.coerce.number().int().min(1).max(100).default(50), offset:z.coerce.number().int().min(0).default(0) }).parse(req.query); return [v.limit,v.offset]; };
 const notify = async (req: Request, s: any, type: string, message: string) => {
  const recipients = await q('SELECT owner_id AS id FROM projects WHERE id=$1 UNION SELECT user_id AS id FROM project_members WHERE project_id=$1 UNION SELECT author_id AS id FROM submissions WHERE id=$2',[s.project_id,s.id]);
  for(const recipient of recipients) if(recipient.id !== uid(req)) {
   const n = (await q('INSERT INTO notifications(user_id,submission_id,type,message) VALUES($1,$2,$3,$4) RETURNING *',[recipient.id,s.id,type,message]))[0];
   try { publish(recipient.id,n); } catch { /* Stored feed remains available if a socket disconnects. */ }
  }
 };
 app.get('/api/health',async (_req,res) => { await db.query('SELECT 1'); res.json({status:'ok'}); });
 app.use('/api/auth',rateLimit({ windowMs:15*60*1000,limit:100,standardHeaders:true,legacyHeaders:false }));
 app.post('/api/auth/register',async (req,res) => {
  const data = profile.extend({ password:z.string().min(8).max(128).refine(v => Buffer.byteLength(v,'utf8') <= 72,'Password must fit within 72 UTF-8 bytes'), role:z.enum(['reviewer','submitter']).default('submitter') }).parse(req.body);
  const hash = await bcrypt.hash(data.password,12);
  const user = (await q('INSERT INTO users(name,email,password_hash,role,display_picture) VALUES($1,$2,$3,$4,$5) RETURNING id,name,email,role,display_picture',[data.name,data.email.toLowerCase(),hash,data.role,data.display_picture ?? null]))[0];
  res.status(201).json(user);
 });
 app.post('/api/auth/login',async (req,res) => {
  const data = z.object({email:z.email(),password:z.string().max(128)}).parse(req.body);
  const user = (await q('SELECT * FROM users WHERE email=$1',[data.email.toLowerCase()]))[0];
  if(!user || !await bcrypt.compare(data.password,user.password_hash)) throw new ApiError(401,'Invalid email or password');
  res.json({token:jwt.sign({id:user.id,role:user.role},secret,{expiresIn:'1h',algorithm:'HS256'}),user:{id:user.id,name:user.name,email:user.email,role:user.role}});
 });
 app.use('/api',async (req,res,next) => {
  try {
   const header = req.headers.authorization;
   if(!header?.startsWith('Bearer ')) throw new ApiError(401,'Bearer token required');
   let identity: Identity;
   try { identity = verifyToken(header.slice(7),secret); } catch { throw new ApiError(401,'Invalid or expired token'); }
   const user = (await q('SELECT id,role FROM users WHERE id=$1',[identity.id]))[0];
   if(!user) throw new ApiError(401,'User no longer exists');
   req.user = user; next();
  } catch(error) { next(error); }
 });
 const self = (req: Request) => { if(id(req) !== uid(req)) throw new ApiError(403,'Only your own profile is accessible'); };
 app.get('/api/users/:id',async (req,res) => { self(req); res.json(await one('SELECT id,name,email,role,display_picture,created_at FROM users WHERE id=$1',[id(req)])); });
 app.patch('/api/users/:id',async (req,res) => {
  self(req); const d = profile.partial().refine(v => Object.keys(v).length > 0,'Provide at least one field').parse(req.body);
  const old = await one('SELECT * FROM users WHERE id=$1',[id(req)]);
  res.json((await q('UPDATE users SET name=$1,email=$2,display_picture=$3 WHERE id=$4 RETURNING id,name,email,role,display_picture',[d.name ?? old.name,d.email?.toLowerCase() ?? old.email,d.display_picture === undefined ? old.display_picture : d.display_picture,id(req)]))[0]);
 });
 app.delete('/api/users/:id',async (req,res) => { self(req); await q('DELETE FROM users WHERE id=$1',[id(req)]); res.sendStatus(204); });
 app.post('/api/projects',async (req,res) => {
  const d = z.object({name:z.string().trim().min(1).max(150),description:z.string().max(10000).default('')}).parse(req.body);
  res.status(201).json((await q('INSERT INTO projects(name,description,owner_id) VALUES($1,$2,$3) RETURNING *',[d.name,d.description,uid(req)]))[0]);
 });
 app.get('/api/projects',async (req,res) => { const [limit,offset] = page(req); res.json(await q('SELECT DISTINCT p.* FROM projects p LEFT JOIN project_members m ON m.project_id=p.id WHERE p.owner_id=$1 OR m.user_id=$1 ORDER BY p.id DESC LIMIT $2 OFFSET $3',[uid(req),limit,offset])); });
 app.get('/api/projects/:id',async (req,res) => res.json(await member(req,id(req))));
 app.patch('/api/projects/:id',async (req,res) => { const old = await owner(req,id(req)); const d = z.object({name:z.string().trim().min(1).max(150).optional(),description:z.string().max(10000).optional()}).parse(req.body); res.json((await q('UPDATE projects SET name=$1,description=$2 WHERE id=$3 RETURNING *',[d.name ?? old.name,d.description ?? old.description,id(req)]))[0]); });
 app.delete('/api/projects/:id',async (req,res) => { await owner(req,id(req)); await q('DELETE FROM projects WHERE id=$1',[id(req)]); res.sendStatus(204); });
 app.get('/api/projects/:id/members',async (req,res) => { await member(req,id(req)); res.json(await q('SELECT u.id,u.name,u.role FROM users u JOIN project_members m ON m.user_id=u.id WHERE m.project_id=$1',[id(req)])); });
 app.post('/api/projects/:id/members',async (req,res) => {
  await owner(req,id(req)); const d = z.object({userId:idSchema}).parse(req.body); const user = await one('SELECT id,role FROM users WHERE id=$1',[d.userId]);
  if(user.role !== 'reviewer') throw new ApiError(400,'Project members must be reviewers');
  await q('INSERT INTO project_members(project_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id(req),d.userId]); res.status(201).json({projectId:id(req),userId:d.userId});
 });
 app.delete('/api/projects/:id/members/:userId',async (req,res) => { await owner(req,id(req)); await q('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',[id(req),id(req,'userId')]); res.sendStatus(204); });
 app.post('/api/submissions',async (req,res) => {
  const d = z.object({projectId:idSchema,title:z.string().trim().min(1).max(200),code:z.string().min(1).max(500000).refine(v => !v.includes('\u0000'),'Only text is allowed'),filename:z.string().min(1).max(255).optional(),language:z.string().min(1).max(50).default('text')}).parse(req.body);
  await member(req,d.projectId);
  const s = (await q('INSERT INTO submissions(project_id,author_id,title,code,filename,language) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[d.projectId,uid(req),d.title,d.code,d.filename ?? null,d.language]))[0];
  await notify(req,s,'submission','New submission: '+s.title); res.status(201).json(s);
 });
 app.get('/api/projects/:id/submissions',async (req,res) => { await member(req,id(req)); const [limit,offset]=page(req); res.json(await q('SELECT * FROM submissions WHERE project_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',[id(req),limit,offset])); });
 app.get('/api/submissions/:id',async (req,res) => res.json(await submission(req)));
 app.delete('/api/submissions/:id',async (req,res) => { const s = await submission(req); if(s.author_id !== uid(req)) throw new ApiError(403,'Only the author may delete a submission'); await q('DELETE FROM submissions WHERE id=$1',[s.id]); res.sendStatus(204); });
 async function decision(req: Request, res: Response, status: 'approved'|'changes_requested') {
  reviewer(req); const s = await submission(req); if(s.author_id === uid(req)) throw new ApiError(403,'You cannot review your own submission');
  const d = z.object({feedback:z.string().max(10000).default('')}).parse(req.body ?? {});
  const client = await db.connect(); let review;
  try { await client.query('BEGIN'); await client.query('UPDATE submissions SET status=$1,updated_at=NOW() WHERE id=$2',[status,s.id]); review = (await client.query('INSERT INTO reviews(submission_id,reviewer_id,decision,feedback) VALUES($1,$2,$3,$4) RETURNING *',[s.id,uid(req),status,d.feedback])).rows[0]; await client.query('COMMIT'); }
  catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  await notify(req,s,'review','Submission '+s.title+': '+status); res.json(review);
 }
 app.patch('/api/submissions/:id/status',async (req,res) => {
  const d = z.object({status:z.enum(['pending','in_review','approved','changes_requested']),feedback:z.string().max(10000).optional()}).parse(req.body);
  if(d.status === 'approved' || d.status === 'changes_requested') { await decision(req,res,d.status); return; }
  const s = await submission(req);
  if(d.status === 'in_review') { reviewer(req); if(s.author_id === uid(req)) throw new ApiError(403,'You cannot review your own submission'); if(s.status !== 'pending') throw new ApiError(409,'Only pending submissions can enter review'); }
  else { if(s.author_id !== uid(req)) throw new ApiError(403,'Only the author can resubmit'); if(s.status !== 'changes_requested') throw new ApiError(409,'Only changes_requested submissions can return to pending'); }
  const updated = (await q('UPDATE submissions SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[d.status,s.id]))[0]; await notify(req,s,'status','Submission '+s.title+': '+d.status); res.json(updated);
 });
 app.patch('/api/submissions/:id',async (req,res) => {
  const s = await submission(req); if(s.author_id !== uid(req)) throw new ApiError(403,'Only the author can edit code'); if(!['pending','changes_requested'].includes(s.status)) throw new ApiError(409,'Code can only be edited when pending or changes are requested');
  const d=z.object({code:z.string().min(1).max(500000).refine(v=>!v.includes('\u0000')),title:z.string().trim().min(1).max(200).optional()}).parse(req.body);
  res.json((await q('UPDATE submissions SET code=$1,title=$2,updated_at=NOW() WHERE id=$3 RETURNING *',[d.code,d.title ?? s.title,s.id]))[0]);
 });
 app.post('/api/submissions/:id/approve',async (req,res) => decision(req,res,'approved'));
 app.post('/api/submissions/:id/request-changes',async (req,res) => decision(req,res,'changes_requested'));
 app.get('/api/submissions/:id/reviews',async (req,res) => { const s=await submission(req); const [limit,offset]=page(req); res.json(await q('SELECT * FROM reviews WHERE submission_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',[s.id,limit,offset])); });
 app.get('/api/submissions/:id/comments',async (req,res) => { const s=await submission(req); const [limit,offset]=page(req); res.json(await q('SELECT * FROM comments WHERE submission_id=$1 ORDER BY id LIMIT $2 OFFSET $3',[s.id,limit,offset])); });
 app.post('/api/submissions/:id/comments',async (req,res) => {
  reviewer(req); const s=await submission(req); const d=z.object({body:text,line:idSchema.nullable().optional()}).parse(req.body);
  if(d.line && d.line > s.code.split('\n').length) throw new ApiError(400,'Line exceeds code length');
  const comment=(await q('INSERT INTO comments(submission_id,author_id,body,line) VALUES($1,$2,$3,$4) RETURNING *',[s.id,uid(req),d.body,d.line ?? null]))[0]; await notify(req,s,'comment','New comment on '+s.title); res.status(201).json(comment);
 });
 for(const method of ['patch','delete'] as const) app[method]('/api/comments/:id',async (req,res) => {
  reviewer(req); const c=await one('SELECT * FROM comments WHERE id=$1',[id(req)]); const s=await one('SELECT * FROM submissions WHERE id=$1',[c.submission_id]); await member(req,s.project_id);
  if(c.author_id !== uid(req)) throw new ApiError(403,'Only the comment author can edit or delete it');
  if(method==='delete') { await q('DELETE FROM comments WHERE id=$1',[c.id]); res.sendStatus(204); }
  else { const d=z.object({body:text}).parse(req.body); res.json((await q('UPDATE comments SET body=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[d.body,c.id]))[0]); }
 });
 app.get('/api/users/:id/notifications',async (req,res) => { self(req); const [limit,offset]=page(req); res.json(await q('SELECT * FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT $2 OFFSET $3',[uid(req),limit,offset])); });
 app.get('/api/projects/:id/stats',async (req,res) => {
  await member(req,id(req)); const submissions=await q('SELECT * FROM submissions WHERE project_id=$1',[id(req)]);
  const reviews=await q('SELECT r.*,s.created_at AS submitted_at FROM reviews r JOIN submissions s ON s.id=r.submission_id WHERE s.project_id=$1 ORDER BY r.id',[id(req)]);
  const counts=await q('SELECT c.submission_id,COUNT(*) AS count FROM comments c JOIN submissions s ON s.id=c.submission_id WHERE s.project_id=$1 GROUP BY c.submission_id',[id(req)]);
  const approved=submissions.filter(s=>s.status==='approved').length, changes=submissions.filter(s=>s.status==='changes_requested').length;
  const first=new Map<number,number>(); const activity:Record<string,number>={};
  for(const r of reviews) { if(!first.has(r.submission_id)) first.set(r.submission_id,(new Date(r.created_at).getTime()-new Date(r.submitted_at).getTime())/3600000); activity[r.reviewer_id]=(activity[r.reviewer_id]||0)+1; }
  counts.sort((a,b)=>Number(b.count)-Number(a.count)||a.submission_id-b.submission_id);
  res.json({totalSubmissions:submissions.length,approved,changesRequested:changes,approvedPercent:submissions.length?approved/submissions.length*100:0,changesRequestedPercent:submissions.length?changes/submissions.length*100:0,averageFirstReviewHours:first.size?[...first.values()].reduce((a,b)=>a+b,0)/first.size:null,reviewerActivity:activity,mostCommentedSubmission:counts[0]?{submissionId:counts[0].submission_id,commentCount:Number(counts[0].count)}:null});
 });
 app.use((_req,res)=>res.status(404).json({error:'Endpoint not found'}));
 app.use((error: any,_req: Request,res: Response,_next: NextFunction) => {
  if(error instanceof z.ZodError) { res.status(400).json({error:'Validation failed',details:error.issues}); return; }
  if(error.code==='23505') { res.status(409).json({error:'Email already registered'}); return; }
  if(error.type==='entity.parse.failed') { res.status(400).json({error:'Invalid JSON'}); return; }
  if(error.type==='entity.too.large') { res.status(413).json({error:'Request is too large'}); return; }
  if(!(error instanceof ApiError)) console.error('Request failed:',error.message);
  res.status(error instanceof ApiError?error.status:500).json({error:error instanceof ApiError?error.message:'Internal server error'});
 });
 return app;
}

