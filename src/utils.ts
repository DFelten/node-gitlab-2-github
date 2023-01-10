import * as path from 'path';
import settings from '../settings';
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
  gitlabHelper: GitlabHelper
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
    await gitlabHelper.getAttachment(url, `../gitlab-images/images/${settings.gitlab.projectId}/`, basename);

    const attachmentUrl = 'https://github.com/trimexa/gitlab-images/blob/main/images/' + `${settings.gitlab.projectId}/` + basename;
    offsetToAttachment[
      match.index as number
    ] = `[${name}](${attachmentUrl})`;
  }

  return body.replace(
    regexp,
    ({ }, { }, { }, { }, offset, { }) => offsetToAttachment[offset]
  );
};
