'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createJobStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let jobs = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.jobs && typeof parsed.jobs === 'object') jobs = parsed.jobs;
  } catch (_) {}

  function flush() {
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify({ schema: 't8-volc-asset-jobs-v1', jobs }, null, 2)}\n`, 'utf8');
    fs.renameSync(temp, file);
  }

  return {
    list() { return Object.values(clone(jobs)); },
    get(id) { return jobs[id] ? clone(jobs[id]) : null; },
    put(job) { jobs[job.id] = clone(job); flush(); return clone(job); },
    create(input) {
      const job = {
        id: `volcjob-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'submitted',
        ...input,
      };
      return this.put(job);
    },
  };
}

module.exports = { createJobStore };
