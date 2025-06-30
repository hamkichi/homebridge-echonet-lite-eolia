import { createRequire } from 'module';
import { JobResolveReject } from './types.js';

const require = createRequire(import.meta.url);
const queue = require('queue');

type QueueJob = () => Promise<unknown>;

interface Queue {
  push(job: QueueJob): void;
  on(event: 'success', callback: (result: unknown, job: QueueJob) => void): void;
  on(event: 'error', callback: (error: unknown, job: QueueJob) => void): void;
  on(event: 'timeout', callback: (next: () => void, job: QueueJob) => void): void;
}

export class JobQueue {
  private readonly theQueue: Queue;
  private readonly jobResolveRejectMap = new Map<QueueJob, JobResolveReject>();
  private readonly defaultTimeout = 10000;
  private readonly maxRetries = 3;

  constructor() {
    this.theQueue = queue({ concurrency: 1, autostart: true, timeout: this.defaultTimeout });

    this.theQueue.on('success', this.onJobComplete.bind(this));
    this.theQueue.on('error', this.onJobFailed.bind(this));
    this.theQueue.on('timeout', this.onJobTimeout.bind(this));
  }

  async addJob(job: QueueJob, timeout = this.defaultTimeout, retries = this.maxRetries): Promise<unknown> {
    return this.executeWithRetry(job, timeout, retries);
  }

  private async executeWithRetry(job: QueueJob, timeout: number, retries: number): Promise<unknown> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await this.executeJob(job, timeout);
      } catch (error) {
        if (attempt === retries) {
          throw error;
        }
        await this.delay(Math.pow(2, attempt) * 1000);
      }
    }

    // This should never be reached due to the throw above, but TypeScript needs it
    throw new Error('Maximum retries exceeded');
  }

  private async executeJob(job: QueueJob, timeout: number): Promise<unknown> {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Job timeout after ' + timeout + 'ms')), timeout);
    });

    this.theQueue.push(job);
    const jobPromise = new Promise((resolve, reject) => {
      this.jobResolveRejectMap.set(job, { resolve, reject });
    });

    return Promise.race([jobPromise, timeoutPromise]);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private onJobComplete(result: unknown, job: QueueJob): void {
    const resolveReject = this.jobResolveRejectMap.get(job);
    if (resolveReject) {
      const { resolve } = resolveReject;
      this.jobResolveRejectMap.delete(job);
      resolve(result);
    }
  }

  private onJobFailed(error: unknown, job: QueueJob): void {
    const resolveReject = this.jobResolveRejectMap.get(job);
    if (resolveReject) {
      const { reject } = resolveReject;
      this.jobResolveRejectMap.delete(job);
      reject(error);
    }
  }

  private onJobTimeout(next: () => void, job: QueueJob): void {
    const resolveReject = this.jobResolveRejectMap.get(job);
    if (resolveReject) {
      const { reject } = resolveReject;
      this.jobResolveRejectMap.delete(job);
      reject(new Error('Job timeout'));
    }
    next();
  }
}