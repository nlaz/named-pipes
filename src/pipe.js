import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { Transform } from 'stream';

export class NamedPipe extends Transform {
  constructor(options = {}) {
    super({
      highWaterMark: options.highWaterMark,
      defaultEncoding: options.defaultEncoding || 'utf8',
      ...options
    });

    if (options.pipePath) {
      this.pipePath = options.pipePath;
    } else {
      const tmpDir = options.tmpDir || path.join(process.cwd(), 'tmp');
      const pipeName = options.pipeName || `pipe_${Math.random().toString(36).substr(2, 9)}`;
      this.pipePath = path.join(tmpDir, pipeName);
    }

    this.created = false;
    this.writeStream = null;
    this.readStream = null;
    this.closed = false;

    process.on('SIGINT', () => this.cleanup());
    process.on('SIGTERM', () => this.cleanup());
  }

  async ensureTmpDir() {
    const dir = path.dirname(this.pipePath);
    if (!fs.existsSync(dir)) {
      await fs.promises.mkdir(dir, { recursive: true });
    }
  }

  async create() {
    if (this.created) return;

    try {
      await this.ensureTmpDir();
      if (!fs.existsSync(this.pipePath)) {
        execSync(`mkfifo ${this.pipePath}`);
        this.created = true;
      }

      this.writeStream = fs.createWriteStream(this.pipePath);
      this.readStream = fs.createReadStream(this.pipePath);

      this.writeStream.on('error', (err) => this.emit('error', err));
      this.readStream.on('error', (err) => this.emit('error', err));

      this.readStream.on('data', (chunk) => {
        this.push(chunk);
      });

      this.readStream.on('end', () => {
        this.push(null);
      });

    } catch (error) {
      throw new Error(`Failed to create named pipe at ${this.pipePath}: ${error.message}`);
    }
  }

  _transform(chunk, encoding, callback) {
    if (!this.created || !this.writeStream) {
      return callback(new Error('Pipe must be created before writing'));
    }

    this.writeStream.write(chunk, encoding, (error) => {
      if (error) {
        callback(error);
      } else {
        callback();
      }
    });
  }

  _flush(callback) {
    if (this.writeStream) {
      this.writeStream.end(() => {
        this.readStream.once('end', () => {
          callback();
        });
      });
    } else {
      callback();
    }
  }

  _final(callback) {
    this.cleanup();
    callback();
  }

  _destroy(error, callback) {
    this.cleanup();
    callback(error);
  }

  pipe(destination, options) {
    if (!this.created) {
      throw new Error('Pipe must be created before piping');
    }

    return super.pipe(destination, options);
  }

  get() {
    return this.pipePath;
  }

  cleanup() {
    if (this.closed) return;
    this.closed = true;

    try {
      if (this.writeStream) {
        this.writeStream.end();
        this.writeStream = null;
      }
      if (this.readStream) {
        this.readStream.destroy();
        this.readStream = null;
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
