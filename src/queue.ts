import { callZedgi } from './client.js';
import type { ZedgiClientOptions, QueueClient } from './types.js';

/**
 * BullMQ queue client. BullMQ rides on your existing Redis service — there is no
 * separate service to register. Each op is sent as the redis service's
 * `bull:<method>`, with the queue name carried in `payload.target`, and is
 * executed by the backend's BullMQ-intent layer (default `bull` key prefix, so
 * jobs interoperate with your own workers).
 *
 *   const queue = zedgi.queue('emails');
 *   await queue.add('send', { to: 'dev@example.com' }, { attempts: 3 });
 *   await queue.getJobCounts();
 */
export const createQueueClient = (options: ZedgiClientOptions, name: string): QueueClient => {
  const call = <T>(op: string, args: unknown[] = []): Promise<T> =>
    callZedgi<T>(options, 'redis', `bull:${op}`, { target: name, args });

  const client: QueueClient = {
    add: (jobName, data, opts) => call('add', [jobName, data, opts]),
    getJob: (id) => call('getJob', [id]),
    getJobs: (states, start, end, asc) => call('getJobs', [states, start, end, asc]),
    getJobCounts: (...types) => call('getJobCounts', types),
    count: () => call('count'),
    pause: () => call('pause'),
    resume: () => call('resume'),
    drain: (delayed) => call('drain', [delayed]),
    clean: (grace, limit, type) => call('clean', [grace, limit, type]),
    removeJob: (id) => call('removeJob', [id]),
    retryJob: (id) => call('retryJob', [id]),
    promoteJob: (id) => call('promoteJob', [id]),
    obliterate: (opts) => call('obliterate', [opts]),
    closeQueue: () => call('closeQueue'),
    getSnapshot: () => call('getSnapshot'),
    getEvents: () => call('getEvents'),
    getRecentJobsForQueue: (limit) => call('getRecentJobsForQueue', [limit]),
  };

  return Object.freeze(client);
};
