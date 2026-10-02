import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { attachWebSockets } from '../src/sockets';
import { newDb } from 'pg-mem';
const secret='socket-test-secret-at-least-32-characters';
test('WebSocket authenticates, isolates recipients, publishes and rejects invalid JWT',async()=>{
 const db=newDb(); db.public.none('CREATE TABLE users(id integer PRIMARY KEY); INSERT INTO users VALUES(1),(2);');
 const pool=new (db.adapters.createPg().Pool)();
 const server=createServer(); const live=attachWebSockets(server,pool as any,secret);
 server.listen(0,'127.0.0.1'); await once(server,'listening');
 const port=(server.address() as any).port;
 const clients:WebSocket[]=[];
 try {
  const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`); clients.push(ws); await once(ws,'open');
  const ack=once(ws,'message'); ws.send(JSON.stringify({type:'auth',token:jwt.sign({id:1,role:'submitter'},secret,{expiresIn:'1h'})}));
  assert.equal(JSON.parse((await ack)[0].toString()).type,'authenticated');
  const message=once(ws,'message'); live.publish(2,{message:'private'}); live.publish(1,{message:'your feedback'});
  assert.equal(JSON.parse((await message)[0].toString()).data.message,'your feedback');
  const bad=new WebSocket(`ws://127.0.0.1:${port}/ws`); clients.push(bad); await once(bad,'open'); const closed=once(bad,'close'); bad.send(JSON.stringify({type:'auth',token:'invalid'})); assert.equal((await closed)[0],1008);
 } finally { for(const ws of clients) ws.terminate(); live.close(); await new Promise<void>(resolve=>server.close(()=>resolve())); await pool.end(); }
});
