/** Tagged Drive error so lib/errors.ts can map it without loading Google SDKs. */
export class DriveError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 502, code = "drive_error") {
    super(message);
    this.name = "DriveError";
    this.status = status;
    this.code = code;
  }
}
