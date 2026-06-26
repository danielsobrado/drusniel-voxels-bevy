export class CacheUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheUnavailableError";
  }
}

export class CacheCorruptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheCorruptError";
  }
}

export class CacheDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheDecodeError";
  }
}

export class CacheChecksumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheChecksumError";
  }
}

export class CacheConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CacheConfigError";
  }
}
