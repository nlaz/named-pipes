import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export class NamedPipe {
  constructor(options = {}) {
    if (options.pipePath) {
      this.pipePath = options.pipePath;
    } else {
      const tmpDir = options.tmpDir || path.join(process.cwd(), 'tmp');
      const pipeName = options.pipeName || `pipe_${Math.random().toString(36).substr(2, 9)}`;
      this.pipePath = path.join(tmpDir, pipeName);
    }

    this.created = false;
    this.writeStream = null;

    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
  }

  async ensureTmpDir() {
    const dir = path.dirname(this.pipePath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
  }

  static async create() {
    const pipe = new NamedPipe();
    await pipe.initialize();
    return pipe;
  }

  async initialize() {
    if (this.created) return this;

    try {
      await this.ensureTmpDir();

      if (!fs.existsSync(this.pipePath)) {
        execSync(`mkfifo ${this.pipePath}`);
        this.created = true;
      }
      return this;
    } catch (error) {
      throw new Error(`Failed to create named pipe at ${this.pipePath}: ${error.message}`);
    }
  }

  createWriteStream() {
    if (!this.created) {
      throw new Error('Pipe must be created before creating a write stream');
    }

    this.writeStream = fs.createWriteStream(this.pipePath);
    return this.writeStream;
  }

  handlePipe(inputStream) {
    if (!inputStream?.readable) {
      throw new Error('Input must be a readable stream');
    }

    const writeStream = this.createWriteStream();
    inputStream.pipe(writeStream);

    inputStream.on('error', (error) => {
      console.error(`Input stream error: ${error.message}`);
      this.cleanup();
    });

    return writeStream;
  }

  get() {
    return this.pipePath;
  }

  cleanup() {
    try {
      if (this.writeStream) {
        this.writeStream.end();
        this.writeStream = null;
      }

      if (this.created && fs.existsSync(this.pipePath)) {
        fs.unlinkSync(this.pipePath);
        this.created = false;
      }
    } catch (error) {
      console.error(`Cleanup error for pipe ${this.pipePath}:`, error);
    }
  }
}
