import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const queue = require('queue');

interface JobResolveReject {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

export class JobQueue {
  private theQueue: any;
  private jobResolveRejectMap = new Map<any, JobResolveReject>();
  private readonly defaultTimeout = 10000;
  private readonly maxRetries = 3;

  constructor() {
    this.theQueue = queue({ concurrency: 1, autostart: true, timeout: this.defaultTimeout });

    this.theQueue.on('success', this.onJobComplete.bind(this));
    this.theQueue.on('error', this.onJobFailed.bind(this));
    this.theQueue.on('timeout', this.onJobTimeout.bind(this));
  }

  async addJob(job: () => Promise<any>, timeout = this.defaultTimeout, retries = this.maxRetries): Promise<any> {
    return this.executeWithRetry(job, timeout, retries);
  }

  private async executeWithRetry(job: () => Promise<any>, timeout: number, retries: number): Promise<any> {
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
  }

  private async executeJob(job: () => Promise<any>, timeout: number): Promise<any> {
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

  onJobComplete(result: any, job: () => Promise<any>) {
    const resolveReject = this.jobResolveRejectMap.get(job);
    if (resolveReject) {
      const { resolve } = resolveReject;
      this.jobResolveRejectMap.delete(job);
      resolve(result);
    }
  }

  onJobFailed(error: any, job: () => Promise<any>) {
    const resolveReject = this.jobResolveRejectMap.get(job);
    if (resolveReject) {
      const { reject } = resolveReject;
      this.jobResolveRejectMap.delete(job);
      reject(error);
    }
  }

  onJobTimeout(next: () => void, job: () => Promise<any>) {
    const resolveReject = this.jobResolveRejectMap.get(job);
    if (resolveReject) {
      const { reject } = resolveReject;
      this.jobResolveRejectMap.delete(job);
      reject(new Error('Job timeout'));
    }
    next();
  }
}