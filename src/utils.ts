import { exec } from 'child_process';
import * as path from 'path';
import { projectSettings } from '../settings';
import { GitlabHelper } from './gitlabHelper';
import { S3Settings } from './settings';

export const sleep = (milliseconds: number) => {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
};

// Creates new attachments and replaces old links
export const migrateAttachments = async (
  body: string,
  githubRepoId: number | undefined,
  s3: S3Settings | undefined,
  gitlabHelper: GitlabHelper,
) => {
  const regexp = /(!?)\[([^\]]+)\]\((\/uploads[^)]+)\)/g;

  // Maps link offset to a new name in S3
  const offsetToAttachment: {
    [key: number]: string;
  } = {};

  // Find all local links
  const matches = body.matchAll(regexp);

  for (const match of matches) {
    const name = match[2];
    const url = match[3];

    const basename = path.basename(url);
    await gitlabHelper.getAttachment(url, `../gitlab-images/images/${projectSettings.gitLabId}/`, basename);

    const attachmentUrl = 'https://github.com/trimexa/gitlab-images/blob/main/images/' + `${projectSettings.gitLabId}/` + basename;
    offsetToAttachment[
      match.index as number
    ] = `[${name}](${attachmentUrl})`;
  }

  return body.replace(
    regexp,
    ({ }, { }, { }, { }, offset, { }) => offsetToAttachment[offset]
  );
};

export async function shellStuff(command: string, next?: Function, ignoreError = false) {
  console.log(command);

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.log(`error: ${error.message}`);

      if (!ignoreError) {
        return;
      }
    }
    if (stderr) {
      console.log(`stderr: ${stderr}`);
    }
    console.log(`stdout: ${stdout}`);

    next?.();
  });
}
