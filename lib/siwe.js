// Strict SIWE with shared single-use challenges and revocable sessions.
'use strict';
const crypto = require('crypto');
const { verifyMessage, getAddress } = require('ethers');
const { isAddr } = require('./util');
const TTL = 300, SESSION_TTL = 7200;
const STATEMENT = 'Sign in to OGT Portal. This verifies your address only and does not authorize transactions or asset transfers.';
function secret() {
  const value = process.env.SESSION_SECRET || '';
  if (value !== value.trim() || Buffer.byteLength(value) < 32 || value === 'dev-insecure-secret-change-me') throw new Error('Sign-in is not configured.');
  return value;
}
function origin() {
  const value = process.env.APP_ORIGIN || '';
  let u; try { u = new URL(value); } catch (_) { throw new Error('Sign-in is not configured.'); }
  const local = process.env.NODE_ENV === 'development' && ['localhost','127.0.0.1'].includes(u.hostname);
  if ((!local && u.protocol !== 'https:') || u.username || u.password || u.pathname !== '/' || u.search || u.hash || value !== u.origin) throw new Error('Sign-in is not configured.');
  return u.origin;
}
function configured() { try { secret(); origin(); const u = new URL(process.env.KV_REST_API_URL || ''); return u.protocol === 'https:' && !u.username && !u.password && !!process.env.KV_REST_API_TOKEN; } catch (_) { return false; } }
function b64u(value) { return Buffer.from(value).toString('base64url'); }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function hmac(value) { return crypto.createHmac('sha256', secret()).update(value).digest('base64url'); }
function makeToken(payload, ttl = SESSION_TTL) {
  const body = b64u(JSON.stringify({ ...payload, v: 2, exp: Math.floor(Date.now()/1000) + ttl }));
  return body + '.' + hmac(body);
}
function readToken(value,allowExpired=false) {
  if (typeof value !== 'string' || value.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const [body, sig] = value.split('.'), a = Buffer.from(hmac(body)), b = Buffer.from(sig);
    if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) return null;
    const payload = JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if (payload.v !== 2 || !Number.isSafeInteger(payload.exp) || (!allowExpired && payload.exp <= Math.floor(Date.now()/1000))) return null;
    return payload;
  } catch (_) { return null; }
}
function randomNonce() { return crypto.randomBytes(24).toString('hex'); }
function requestAllowed(req, method, json = false) {
  if (!configured() || req.method !== method) return false;
  const expected = origin();
  if (req.headers.origin !== expected || req.headers.host !== new URL(expected).host) return false;
  if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return false;
  return !json || /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '');
}
async function command(args) {
  if (!configured()) throw new Error('Sign-in is not configured.');
  const response = await fetch(process.env.KV_REST_API_URL, {
    method:'POST', redirect:'error', signal:AbortSignal.timeout(5000),
    headers:{'Authorization':'Bearer '+process.env.KV_REST_API_TOKEN,'Content-Type':'application/json'}, body:JSON.stringify(args)
  });
  if (!response.ok) throw new Error('Sign-in storage is unavailable.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Invalid sign-in storage response.');
  const chunks=[]; let size=0;
  try {
    while (true) {
      const {done,value}=await reader.read(); if(done)break;
      size+=value.byteLength;
      if(size>16384){await reader.cancel().catch(()=>{});throw new Error('Invalid sign-in storage response.');}
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const text=Buffer.concat(chunks,size).toString('utf8');
  let body; try { body = JSON.parse(text); } catch (_) { throw new Error('Invalid sign-in storage response.'); }
  if (body.error) throw new Error('Sign-in storage is unavailable.');
  return body.result;
}
function key(type,id) { return 'ogt-auth-v2:'+digest(origin())+':'+type+':'+digest(id); }
function messageFor(address, nonce, issued, expires) {
  const u = new URL(origin());
  return u.host+' wants you to sign in with your Ethereum account:\n'+getAddress(address)+'\n\n'+STATEMENT+'\n\nURI: '+u.origin+'\nVersion: 1\nChain ID: 1\nNonce: '+nonce+'\nIssued At: '+issued+'\nExpiration Time: '+expires;
}
function parseMessage(message) {
  if (typeof message !== 'string' || message.length > 2048) return null;
  const m = message.match(/^([^\s]+) wants you to sign in with your Ethereum account:\n(0x[0-9a-fA-F]{40})\n\n([^\n]+)\n\nURI: ([^\s]+)\nVersion: (1)\nChain ID: (1)\nNonce: ([a-f0-9]{48})\nIssued At: ([^\n]+)\nExpiration Time: ([^\n]+)$/);
  if (!m) return null;
  return {domain:m[1],address:m[2].toLowerCase(),statement:m[3],uri:m[4],version:m[5],chainId:1,nonce:m[7],issued:m[8],expires:m[9]};
}
function recover(message,signature) { try { return verifyMessage(message,signature).toLowerCase(); } catch (_) { return null; } }
async function createChallenge(address) {
  if (!configured() || !isAddr(address)) throw new Error('Sign-in is unavailable or the address is invalid.');
  address = address.toLowerCase();
  const nonce = randomNonce(), now = Date.now(), issued = new Date(now).toISOString(), expires = new Date(now + TTL*1000).toISOString();
  const message = messageFor(address,nonce,issued,expires);
  const saved = await command(['SET',key('challenge',nonce),digest(message),'EX',TTL,'NX']);
  if (saved !== 'OK') throw new Error('Could not create sign-in challenge.');
  return {message,nonce,expires,cancelToken:makeToken({kind:'cancel',nonce,origin:origin()},TTL+SESSION_TTL),cookie:makeToken({kind:'challenge',nonce,address,issued,expires,origin:origin()},TTL)};
}
async function verifyChallenge(cookie,message,signature) {
  const t = readToken(cookie), p = parseMessage(message), now = Date.now();
  if (!t || t.kind !== 'challenge' || !p || t.origin !== origin() || t.address !== p.address || t.nonce !== p.nonce || t.issued !== p.issued || t.expires !== p.expires || p.uri !== origin() || p.domain !== new URL(origin()).host || p.statement !== STATEMENT) return null;
  if (!Number.isFinite(Date.parse(p.issued)) || !Number.isFinite(Date.parse(p.expires)) || Date.parse(p.issued) > now+30000 || Date.parse(p.expires) <= now || Date.parse(p.expires)-Date.parse(p.issued) !== TTL*1000 || message !== messageFor(p.address,p.nonce,p.issued,p.expires)) return null;
  if (recover(message,signature) !== p.address || await cancelled(p.nonce)) return null;
  // Shared atomic GETDEL, after signature validation. Concurrent/replayed verification has one winner.
  const stored = await command(['GETDEL',key('challenge',p.nonce)]);
  if (stored !== digest(message) || Date.parse(p.expires) <= Date.now() || await cancelled(p.nonce)) return null;
  return p.address;
}
async function createSession(address,nonce,challengeExpires) {
  const deadline=Date.parse(challengeExpires);
  if(!Number.isFinite(deadline)||deadline<=Date.now())throw new Error('Sign-in challenge expired.');
  if(!/^[a-f0-9]{48}$/.test(nonce || '') || await cancelled(nonce)) throw new Error('Sign-in was cancelled.');
  if(deadline<=Date.now())throw new Error('Sign-in challenge expired.');
  const sid=randomNonce(),expires=Math.min(Math.floor(Date.now()/1000)+SESSION_TTL,Math.floor(deadline/1000)+SESSION_TTL);
  const payload = {addr:address,linked:[],expires,nonce};
  if (await command(['SET',key('session',sid),JSON.stringify(payload),'EX',SESSION_TTL,'NX']) !== 'OK') throw new Error('Could not create sign-in session.');
  if(await cancelled(nonce)||deadline<=Date.now()){await command(['DEL',key('session',sid)]);throw new Error('Sign-in was cancelled or expired.');}
  return makeToken({kind:'session',sid},SESSION_TTL);
}
async function readSession(token) {
  const t = readToken(token); if (!configured() || !t || t.kind !== 'session' || !/^[a-f0-9]{48}$/.test(t.sid || '')) return null;
  const raw = await command(['GET',key('session',t.sid)]); if (typeof raw !== 'string') return null;
  let s; try { s = JSON.parse(raw); } catch (_) { return null; }
  if (!s || !isAddr(s.addr) || !Number.isSafeInteger(s.expires) || s.expires <= Math.floor(Date.now()/1000) || !Array.isArray(s.linked) || s.linked.length > 5 || s.linked.some(a=>!isAddr(a))) return null;
  if(!/^[a-f0-9]{48}$/.test(s.nonce || '') || await cancelled(s.nonce)) return null;
  return {...s,sid:t.sid};
}
async function updateLinked(session,linked) {
  const ttl = session.expires-Math.floor(Date.now()/1000); if (ttl <= 0 || linked.length > 5 || await cancelled(session.nonce)) return false;
  return await command(['SET',key('session',session.sid),JSON.stringify({addr:session.addr,linked,expires:session.expires,nonce:session.nonce}),'EX',ttl,'XX']) === 'OK';
}
async function cancelled(nonce) { return await command(['GET',key('cancelled',nonce)]) !== null; }
async function cancelNonce(nonce) {
  if(!/^[a-f0-9]{48}$/.test(nonce || ''))return false;
  // Retained longer than any session that can be issued from this challenge.
  await command(['SET',key('cancelled',nonce),'1','EX',TTL+SESSION_TTL+30]);
  await command(['DEL',key('challenge',nonce)]);return true;
}
async function cancelChallenge(token) {
  // Expired cancel-only tokens are harmless once every possible session has expired.
  // Authentication paths never opt out of normal expiry validation.
  const t=readToken(token,true);
  if(!t || !['challenge','cancel'].includes(t.kind) || t.origin!==origin())return false;
  if(t.exp<=Math.floor(Date.now()/1000))return t.kind==='cancel';
  return cancelNonce(t.nonce);
}
async function logout(token) {
  const t=readToken(token);if(t?.kind!=='session' || !/^[a-f0-9]{48}$/.test(t.sid || '') || !configured())return;
  const session=await readSession(token);if(session)await cancelNonce(session.nonce);
  await command(['DEL',key('session',t.sid)]);
}
module.exports = { configured,origin,requestAllowed,makeToken,readToken,randomNonce,parseMessage,recover,createChallenge,verifyChallenge,createSession,readSession,updateLinked,logout,cancelChallenge,SESSION_TTL,hasEthers:()=>true };