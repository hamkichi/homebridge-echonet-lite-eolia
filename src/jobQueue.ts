import queue from 'queue';

export class JobQueue {
  private theQueue;
  private jobResolveRejectMap = new Map();

  constructor() {
    this.theQueue = queue({ concurrency: 2, autostart: true });

    this.theQueue.on('success', this.onJobComplete.bind(this));
    this.theQueue.on('error', this.onJobFailed.bind(this));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async addJob(job): Promise<any> {
    this.theQueue.push(job);
    return new Promise((resolve, reject) => {
      this.jobResolveRejectMap.set(job, { resolve, reject });
    });
  }

  onJobComplete(result, job) {
    const { resolve } = this.jobResolveRejectMap.get(job);
    this.jobResolveRejectMap.delete(job);
    resolve(result);
  }

  onJobFailed(error, job) {
    const { reject } = this.jobResolveRejectMap.get(job);
    this.jobResolveRejectMap.delete(job);
    reject(error);
  }
}