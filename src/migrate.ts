import { readFileSync } from 'node:fs';
import { pool } from './db';
async function main() {
 try { await pool.query(readFileSync('sql/001_initial.sql', 'utf8')); console.log('Database schema ready.'); }
 finally { await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
