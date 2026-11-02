// Windows Chrome + WSL MCP: validate against MCP roots before converting hosts.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {open} from 'node:fs/promises';
import path from 'node:path';
const exec = promisify(execFile);
export async function browserFilePaths(paths, context) {
  const result=[];
  for (const input of paths) {
    if (!input || input.includes('\0')) throw new Error('UPLOAD_INVALID_PATH');
    const windows=path.win32.isAbsolute(input) && !path.posix.isAbsolute(input);
    const local=windows ? (await exec('wslpath',['-u',input])).stdout.trim() : input;
    const canonical=await context.validatePath(local);
    const file=await open(canonical,'r');
    try {
      if (!(await file.stat()).isFile()) throw new Error('UPLOAD_NOT_A_FILE');
      await file.read(Buffer.alloc(1),0,1,0);
    } finally { await file.close(); }
    result.push((await exec('wslpath',['-w',canonical])).stdout.trim());
  }
  return result;
}
