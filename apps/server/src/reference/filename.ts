/** Multipart filenames may be decoded as Latin-1 by the upload parser. */
export function decodeUploadFilename(value: string): string {
  if ([...value].some((c) => c.charCodeAt(0) > 255)) return value;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'latin1'));
  } catch {
    return value;
  }
}

/** Only repair persisted names with the control-byte signature of this bug. */
export function referenceDisplayTitle(value: string): string {
  return /[\u0080-\u009f]/u.test(value) ? decodeUploadFilename(value) : value;
}
