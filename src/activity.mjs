import { appendFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Append-only events survive dashboard restarts; metadata is replaced atomically. */
export function createActivity(directory, metadata) {
  const file = path.join(directory, 'activity.json');
  const run = { ...metadata, pid: process.pid, status: 'running' };
  const save = () => {
    run.updatedAt = new Date().toISOString();
    writeFileSync(`${file}.tmp`, JSON.stringify(run));
    renameSync(`${file}.tmp`, file);
  };
  save();
  const heartbeat = setInterval(save, 5000);
  heartbeat.unref();
  return {
    event(side, activity, state = 'start') {
      appendFileSync(path.join(directory, 'activity.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), side, activity, state })}\n`);
      save();
    },
    finish(status, error) {
      clearInterval(heartbeat);
      Object.assign(run, { status, error, finishedAt: new Date().toISOString() });
      save();
    },
  };
}
