/** Minimal multipart/form-data parser for single-file uploads (no dependencies). */

function parseContentType(contentType) {
  const raw = String(contentType || "");
  const parts = raw.split(";").map((part) => part.trim());
  const type = parts[0]?.toLowerCase() || "";
  const params = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let value = part.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    params[key] = value;
  }
  return { type, params };
}

function parseContentDisposition(value) {
  const parts = String(value || "").split(";").map((part) => part.trim());
  const type = parts[0]?.toLowerCase() || "";
  const params = {};
  for (const part of parts.slice(1)) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let paramValue = part.slice(eq + 1).trim();
    if (paramValue.startsWith('"') && paramValue.endsWith('"')) paramValue = paramValue.slice(1, -1);
    params[key] = paramValue;
  }
  return { type, params };
}

function parseMultipartBody(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const closing = Buffer.from(`--${boundary}--`);
  const fields = {};
  const files = [];

  let offset = 0;
  while (offset < buffer.length) {
    const start = buffer.indexOf(delimiter, offset);
    if (start === -1) break;

    let partStart = start + delimiter.length;
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) partStart += 2;
    else if (buffer[partStart] === 10) partStart += 1;

    if (buffer.indexOf(closing, start) === start) break;

    const next = buffer.indexOf(delimiter, partStart);
    const partEnd = next === -1 ? buffer.length : next;
    let bodyEnd = partEnd;
    if (bodyEnd - 2 >= partStart && buffer[bodyEnd - 2] === 13 && buffer[bodyEnd - 1] === 10) bodyEnd -= 2;
    else if (bodyEnd - 1 >= partStart && buffer[bodyEnd - 1] === 10) bodyEnd -= 1;

    const headerEnd = buffer.indexOf("\r\n\r\n", partStart);
    if (headerEnd === -1 || headerEnd > bodyEnd) {
      offset = partEnd;
      continue;
    }

    const headerText = buffer.slice(partStart, headerEnd).toString("utf8");
    const body = buffer.slice(headerEnd + 4, bodyEnd);
    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }

    const disposition = parseContentDisposition(headers["content-disposition"]);
    const name = disposition.params.name || "";
    const filename = disposition.params.filename || "";
    const mime = headers["content-type"] || "application/octet-stream";

    if (filename) {
      files.push({ field: name, filename, mime, buffer: body });
    } else if (name) {
      fields[name] = body.toString("utf8");
    }

    offset = partEnd;
  }

  return { fields, files };
}

function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function parseMultipartRequest(req, { maxBytes = 102 * 1024 * 1024 } = {}) {
  const { type, params } = parseContentType(req.headers["content-type"]);
  if (type !== "multipart/form-data" || !params.boundary) {
    throw new Error("invalid_content_type");
  }

  const buffer = await readRequestBody(req, maxBytes);
  return parseMultipartBody(buffer, params.boundary);
}

module.exports = {
  parseMultipartRequest,
  parseMultipartBody,
  readRequestBody,
};
