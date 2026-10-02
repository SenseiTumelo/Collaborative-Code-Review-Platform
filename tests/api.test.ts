import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newDb } from 'pg-mem';
import request from 'supertest';
import { createApp } from '../src/app';
const memory=newDb();
memory.public.none(readFileSync('sql/001_initial.sql','utf8'));
const adapter=memory.adapters.createPg();
const pool=new adapter.Pool();
const events:unknown[]=[];
const app=createApp(pool as any,'test-secret-that-is-long-enough-12345',(_id,n)=>events.push(n));
let submitter:any, reviewer:any, outsider:any, project:any, submission:any, comment:any;
async function account(email:string,role:string) {
 const reg=await request(app).post('/api/auth/register').send({name:role,email,password:'Password123!',role}); assert.equal(reg.status,201);
 const login=await request(app).post('/api/auth/login').send({email,password:'Password123!'}); assert.equal(login.status,200);
 return {...login.body.user,token:login.body.token};
}
const auth=(user:any)=>({Authorization:'Bearer '+user.token});
before(async()=>{submitter=await account('author@example.com','submitter'); reviewer=await account('reviewer@example.com','reviewer'); outsider=await account('outsider@example.com','reviewer');});
after(async()=>{await pool.end();});
test('rejects anonymous access, duplicate emails and invalid login',async()=>{
 assert.equal((await request(app).get('/api/projects')).status,401);
 assert.equal((await request(app).post('/api/auth/register').send({name:'Long',email:'long@example.com',password:'a'.repeat(73)})).status,400);
 assert.equal((await request(app).post('/api/auth/register').send({name:'x',email:'author@example.com',password:'Password123!'})).status,409);
 assert.equal((await request(app).post('/api/auth/login').send({email:'author@example.com',password:'wrong'})).status,401);
});
test('profiles are private and role changes are ignored',async()=>{
 assert.equal((await request(app).get('/api/users/'+submitter.id).set(auth(reviewer))).status,403);
 const result=await request(app).patch('/api/users/'+submitter.id).set(auth(submitter)).send({name:'New name',role:'reviewer'});
 assert.equal(result.status,200); assert.equal(result.body.role,'submitter');
});
test('project owner assigns reviewers and outsiders cannot read submissions',async()=>{
 const p=await request(app).post('/api/projects').set(auth(submitter)).send({name:'Assessment'}); assert.equal(p.status,201); project=p.body;
 assert.equal((await request(app).post(`/api/projects/${project.id}/members`).set(auth(reviewer)).send({userId:outsider.id})).status,403);
 assert.equal((await request(app).post(`/api/projects/${project.id}/members`).set(auth(submitter)).send({userId:reviewer.id})).status,201);
 assert.equal((await request(app).post(`/api/projects/${project.id}/members`).set(auth(submitter)).send({userId:submitter.id})).status,400);
 const s=await request(app).post('/api/submissions').set(auth(submitter)).send({projectId:project.id,title:'Example',code:'const a = 1;\nconsole.log(a);'}); assert.equal(s.status,201); submission=s.body;
 assert.equal((await request(app).get('/api/submissions/'+submission.id).set(auth(outsider))).status,403);
});
test('only reviewers comment; inline positions and comment ownership are checked',async()=>{
 const url=`/api/submissions/${submission.id}/comments`;
 assert.equal((await request(app).post(url).set(auth(submitter)).send({body:'Test'})).status,403);
 assert.equal((await request(app).post(url).set(auth(reviewer)).send({body:'Test',line:3})).status,400);
 const c=await request(app).post(url).set(auth(reviewer)).send({body:'Use a meaningful name',line:1}); assert.equal(c.status,201); comment=c.body;
 assert.equal((await request(app).patch('/api/comments/'+comment.id).set(auth(outsider)).send({body:'Hijack'})).status,403);
 assert.equal((await request(app).patch('/api/comments/'+comment.id).set(auth(reviewer)).send({body:'Use a descriptive name'})).status,200);
});
test('review decisions persist history, allow resubmission, and produce analytics and notifications',async()=>{
 const base='/api/submissions/'+submission.id;
 assert.equal((await request(app).post(base+'/approve').set(auth(submitter)).send({})).status,403);
 assert.equal((await request(app).patch(base+'/status').set(auth(reviewer)).send({status:'in_review'})).status,200);
 assert.equal((await request(app).post(base+'/request-changes').set(auth(reviewer)).send({feedback:'Rename variable'})).status,200);
 assert.equal((await request(app).patch(base).set(auth(submitter)).send({code:'const count = 1;'})).status,200);
 assert.equal((await request(app).patch(base+'/status').set(auth(submitter)).send({status:'pending'})).status,200);
 assert.equal((await request(app).post(base+'/approve').set(auth(reviewer)).send({})).status,200);
 const history=await request(app).get(base+'/reviews').set(auth(submitter)); assert.equal(history.body.length,2);
 const stats=await request(app).get(`/api/projects/${project.id}/stats`).set(auth(submitter)); assert.equal(stats.status,200); assert.equal(stats.body.approvedPercent,100); assert.equal(stats.body.mostCommentedSubmission.commentCount,1);
 const feed=await request(app).get(`/api/users/${submitter.id}/notifications`).set(auth(submitter)); assert.ok(feed.body.length>=3); assert.ok(events.length>=3);
 assert.equal((await request(app).get(`/api/users/${submitter.id}/notifications`).set(auth(reviewer))).status,403);
});
test('membership removal immediately revokes access',async()=>{
 assert.equal((await request(app).delete(`/api/projects/${project.id}/members/${reviewer.id}`).set(auth(submitter))).status,204);
 assert.equal((await request(app).get('/api/submissions/'+submission.id).set(auth(reviewer))).status,403);
});
test('malformed JSON and invalid input return structured errors',async()=>{
 assert.equal((await request(app).post('/api/projects').set(auth(submitter)).send({name:''})).status,400);
 assert.equal((await request(app).post('/api/projects').set(auth(submitter)).set('Content-Type','application/json').send('{')).status,400);
});

